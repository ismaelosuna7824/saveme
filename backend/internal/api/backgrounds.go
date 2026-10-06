package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/ismaelosuna/saveme/backend/internal/config"
)

// MaxBackgroundBytes es el tamaño máximo de una imagen de fondo. Es generoso a
// propósito —una foto de cámara cabe— porque la interfaz la decodifica una vez y
// la reduce a 1920 px; lo que no se admite es cualquier cosa que pase por aquí.
const MaxBackgroundBytes = 64 << 20

// backgroundTypes son los formatos admitidos, con su extensión y su tipo MIME.
var backgroundTypes = map[string]string{
	"png":  "image/png",
	"jpg":  "image/jpeg",
	"gif":  "image/gif",
	"webp": "image/webp",
	"avif": "image/avif",
}

// sniffImage reconoce el formato por los primeros bytes, no por el nombre ni por
// lo que diga el cliente: es lo único que no puede mentir.
func sniffImage(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "png"
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return "jpg"
	case bytes.HasPrefix(data, []byte("GIF87a")), bytes.HasPrefix(data, []byte("GIF89a")):
		return "gif"
	case len(data) >= 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp" &&
		(string(data[8:12]) == "avif" || string(data[8:12]) == "avis"):
		return "avif"
	}
	return ""
}

// handleUploadBackground guarda una imagen de fondo y devuelve su nombre.
//
// El cuerpo es la imagen tal cual. Se guarda con un nombre derivado de su
// contenido (`<16 hex del sha256>.<ext>`), así que subir la misma imagen dos
// veces no la duplica y el nombre sirve de caché eterna. La escritura es atómica:
// un temporal en la misma carpeta y un `rename`.
//
// Esto no cambia la configuración: solo deja la imagen disponible. Usarla como
// fondo es un `PUT /config` aparte, igual que cualquier otra preferencia.
func (s *Server) handleUploadBackground(w http.ResponseWriter, r *http.Request) {
	data, err := io.ReadAll(io.LimitReader(r.Body, MaxBackgroundBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid_image", "no pude leer la imagen: "+err.Error())
		return
	}
	if len(data) == 0 {
		writeErr(w, http.StatusBadRequest, "invalid_image", "la imagen está vacía")
		return
	}
	if len(data) > MaxBackgroundBytes {
		writeErr(w, http.StatusRequestEntityTooLarge, "image_too_large", "la imagen pasa de 64 MB")
		return
	}
	ext := sniffImage(data)
	if ext == "" {
		writeErr(w, http.StatusBadRequest, "invalid_image",
			"el archivo no es una imagen PNG, JPEG, GIF, WebP ni AVIF")
		return
	}

	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:])[:16] + "." + ext
	dir := s.cfg.BackgroundsDir()
	target := filepath.Join(dir, name)

	// Mismo contenido, mismo nombre: si ya está y mide lo mismo, no se reescribe.
	if info, err := os.Stat(target); err == nil && info.Size() == int64(len(data)) {
		writeJSON(w, http.StatusOK, map[string]any{"image": name})
		return
	}
	if err := writeAtomically(dir, name, data); err != nil {
		s.fail(w, r, "image_save_failed", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"image": name})
}

func writeAtomically(dir, name string, data []byte) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("crear %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, "."+name+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, filepath.Join(dir, name))
}

// handleGetBackground sirve una imagen de fondo importada.
//
// El nombre se valida contra la forma exacta que escribe el import antes de
// tocar el disco: sin eso, `{name}` sería una puerta a leer cualquier archivo.
// Como el nombre sale del contenido, la respuesta no cambia nunca y se puede
// cachear para siempre.
func (s *Server) handleGetBackground(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !config.ValidBackgroundImage(name) {
		writeErr(w, http.StatusNotFound, "background_not_found", "no existe esa imagen de fondo")
		return
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.BackgroundsDir(), name))
	if errors.Is(err, fs.ErrNotExist) {
		writeErr(w, http.StatusNotFound, "background_not_found", "no existe esa imagen de fondo")
		return
	}
	if err != nil {
		s.fail(w, r, "background_read_failed", err)
		return
	}
	w.Header().Set("Content-Type", backgroundTypes[filepath.Ext(name)[1:]])
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(data)
}

// backgroundExists dice si la imagen de un fondo está en la carpeta. Se comprueba
// al guardar la configuración: un fondo que apunta a un archivo que no existe se
// vería como un fallo en cada pantalla.
func (s *Server) backgroundExists(name string) bool {
	info, err := os.Stat(filepath.Join(s.cfg.BackgroundsDir(), name))
	return err == nil && info.Mode().IsRegular()
}

// parseBackground lee un fondo de un `PUT /config`. `null` es quitarlo (devuelve
// nil sin problema); un objeto se completa con el aspecto por defecto en lo que
// no traiga, se normaliza y su imagen tiene que existir.
func (s *Server) parseBackground(raw json.RawMessage) (*config.Background, string) {
	if string(bytes.TrimSpace(raw)) == "null" {
		return nil, ""
	}
	background := config.Background{
		Effect:             config.DefaultBackgroundEffect,
		ShowOn:             config.DefaultBackgroundShowOn,
		EmptyVisibility:    config.DefaultEmptyVisibility,
		DocumentVisibility: config.DefaultDocumentVisibility,
	}
	if err := json.Unmarshal(raw, &background); err != nil {
		return nil, "el fondo no tiene una forma válida: " + err.Error()
	}
	normalized, ok := config.NormalizeBackground(background)
	if !ok {
		return nil, "la imagen de fondo tiene que ser una importada con POST /api/backgrounds"
	}
	if !s.backgroundExists(normalized.Image) {
		return nil, "no existe la imagen de fondo " + normalized.Image
	}
	return &normalized, ""
}

// projectBackgrounds devuelve el mapa listo para JSON: vacío en vez de nil, para
// que la interfaz reciba siempre un objeto.
func projectBackgrounds(m map[string]config.Background) map[string]config.Background {
	if m == nil {
		return map[string]config.Background{}
	}
	return m
}

package service

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// EditVersionWindow agrupa las ediciones desde la app en una sola versión.
//
// El editor guarda solo cada ~1 s mientras escribes; una versión por guardado
// llenaría el historial de estados a mitad de frase y escondería los que
// importan. Con la ventana, la primera edición de una sesión guarda lo que había
// antes de empezar, y una sesión larga deja una versión cada diez minutos.
// Las actualizaciones del agente y las restauraciones no se agrupan nunca: cada
// una reemplaza el texto de golpe, y lo de antes tiene que poder recuperarse.
const EditVersionWindow = 10 * time.Minute

// keepVersion guarda en el historial el contenido que está a punto de
// reemplazarse.
func (s *Service) keepVersion(id string, previous []byte, reason workspace.VersionReason) error {
	now := time.Now()
	if reason == workspace.VersionEdit {
		latest, ok, err := s.ws.LatestVersion(id)
		if err != nil {
			return err
		}
		if ok && latest.Reason == workspace.VersionEdit && now.Sub(latest.ReplacedAt) < EditVersionWindow {
			return nil
		}
	}
	if _, err := s.ws.SaveVersion(id, previous, reason, now); err != nil {
		return fmt.Errorf("guardar la versión anterior en el historial: %w", err)
	}
	return nil
}

// Versions lista las versiones anteriores de un resumen, la más reciente primero.
func (s *Service) Versions(ctx context.Context, id string) ([]workspace.VersionEntry, error) {
	if err := s.requireSummary(ctx, id); err != nil {
		return nil, err
	}
	return s.ws.Versions(id)
}

// VersionContent devuelve una versión anterior de un resumen, entera, y lo que
// hay ahora en disco. Las dos van juntas porque es lo que se compara: una
// versión sola no dice qué cambiaría al restaurarla.
func (s *Service) VersionContent(ctx context.Context, id, version string) (entry workspace.VersionEntry, content, current string, err error) {
	if err := s.requireSummary(ctx, id); err != nil {
		return entry, "", "", err
	}
	entry, data, err := s.readVersion(id, version)
	if err != nil {
		return entry, "", "", err
	}
	_, raw, err := s.ReadRaw(ctx, id)
	if err != nil {
		return entry, "", "", err
	}
	return entry, string(data), raw, nil
}

// RestoreVersion vuelve a poner una versión anterior como contenido del resumen.
//
// Pasa por el mismo camino que guardar desde el editor —hash base incluido—, así
// que no pisa un archivo que cambió por debajo, y lo que había antes de restaurar
// queda a su vez en el historial: restaurar también se puede deshacer.
func (s *Service) RestoreVersion(ctx context.Context, id, version, baseHash string) (*SaveResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.requireSummary(ctx, id); err != nil {
		return nil, err
	}
	_, data, err := s.readVersion(id, version)
	if err != nil {
		return nil, err
	}
	return s.saveLocked(ctx, id, string(data), baseHash, workspace.VersionRestore)
}

func (s *Service) requireSummary(ctx context.Context, id string) error {
	_, err := s.st.GetSummary(ctx, id)
	if errors.Is(err, store.ErrNotFound) {
		return fmt.Errorf("%w: el resumen %q no existe", ErrNotFound, id)
	}
	return err
}

func (s *Service) readVersion(id, version string) (workspace.VersionEntry, []byte, error) {
	entry, data, err := s.ws.ReadVersion(id, version)
	switch {
	case errors.Is(err, workspace.ErrInvalidVersion):
		return entry, nil, fmt.Errorf("%w: %v", ErrInvalid, err)
	case errors.Is(err, fs.ErrNotExist):
		return entry, nil, fmt.Errorf("%w: el resumen %q no tiene la versión %q", ErrNotFound, id, version)
	case err != nil:
		return entry, nil, err
	}
	return entry, data, nil
}

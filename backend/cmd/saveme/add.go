package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/service"
)

// runAdd escribe un resumen desde la terminal.
//
// Hasta ahora solo escribían los agentes: el MCP era la única puerta, y una
// persona que quisiera apuntar algo tenía que abrir la app y pasar por el editor.
// Esto cierra ese hueco sin inventar reglas nuevas — pasa por las **mismas dos
// fases** que el MCP (proponer y confirmar), así que hereda la deduplicación, la
// inferencia de categoría, el hash de contenido y el conflicto de edición. Un
// camino distinto para humanos sería un segundo juego de reglas que mantener y
// que podría divergir.
func runAdd(args []string) int {
	fs := flag.NewFlagSet("add", flag.ExitOnError)
	root := fs.String("root", "", "raíz del workspace")
	project := fs.String("project", "", "proyecto donde guardarlo (obligatorio)")
	title := fs.String("title", "", "título del resumen (obligatorio)")
	category := fs.String("category", "", "categoría; si se omite, se infiere del texto")
	body := fs.String("body", "", "cuerpo en markdown; si se omite, se lee de la entrada estándar")
	summary := fs.String("summary", "", "línea de resumen para el frontmatter")
	files := fs.String("files", "", "archivos tocados, separados por comas")
	tags := fs.String("tags", "", "etiquetas, separadas por comas")
	commit := fs.String("commit", "", "commit al que corresponde (si no, se lee de git)")
	_ = fs.Parse(args)

	log := newLogger(false)

	if strings.TrimSpace(*project) == "" || strings.TrimSpace(*title) == "" {
		fmt.Fprintln(os.Stderr, "hacen falta --project y --title")
		fmt.Fprintln(os.Stderr, "por ejemplo:  saveme add --project mi-app --title \"Arreglo el watcher\" --body \"...\"")
		return 2
	}

	texto := *body
	if texto == "" {
		leido, err := readStdin()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		texto = leido
	}
	if strings.TrimSpace(texto) == "" {
		fmt.Fprintln(os.Stderr, "el cuerpo está vacío: pasa --body o escribe el texto por la entrada estándar")
		return 2
	}

	rt, err := open(*root, log)
	if err != nil {
		log.Error("no pude abrir el workspace", "err", err)
		return 1
	}
	defer rt.Close()

	ctx := context.Background()
	prep, err := rt.svc.Propose(ctx, domain.CreateRequest{
		Project:      *project,
		Title:        *title,
		Body:         texto,
		Category:     *category,
		Summary:      *summary,
		Tags:         splitList(*tags),
		FilesTouched: splitList(*files),
		Commit:       *commit,
		// El autor y el agente distinguen lo que escribió una persona de lo que
		// escribió una máquina. Es la diferencia entre «esto lo decidí yo» y «esto
		// me lo propuso un agente», y dentro de un año importa.
		Author: "humano",
		Agent:  "cli",
	})
	if err != nil {
		log.Error("no pude preparar el resumen", "err", err)
		return 1
	}

	if prep.AlreadySaved != nil {
		fmt.Printf("ya estaba guardado: %s\n", prep.AlreadySaved.RelPath)
		return 0
	}

	// Se confirma en el mismo paso. La espera de las dos fases existe para que un
	// agente no escriba sin permiso; aquí el permiso es haber escrito el comando.
	res, err := rt.svc.Confirm(ctx, prep.Proposal.Token, service.Decision{
		Accepted: true,
		Via:      domain.ResolvedViaCLI,
	})
	if err != nil {
		log.Error("no pude escribir el resumen", "err", err)
		return 1
	}

	fmt.Printf("%s\n", res.RelPath)
	return 0
}

// readStdin lee el cuerpo de la entrada estándar, y avisa si es una terminal.
//
// Sin la comprobación, `saveme add --title x` se quedaría esperando en silencio a
// que alguien escriba y pulse Ctrl-D, que parece que se ha colgado.
func readStdin() (string, error) {
	if info, err := os.Stdin.Stat(); err == nil && info.Mode()&os.ModeCharDevice != 0 {
		return "", fmt.Errorf("no hay cuerpo: pasa --body \"...\" o escribe el texto por una tubería")
	}
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("no pude leer la entrada estándar: %w", err)
	}
	return string(data), nil
}

// splitList parte una lista separada por comas, sin dejar huecos vacíos.
func splitList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	out := make([]string, 0, 4)
	for _, parte := range strings.Split(s, ",") {
		if limpio := strings.TrimSpace(parte); limpio != "" {
			out = append(out, limpio)
		}
	}
	return out
}

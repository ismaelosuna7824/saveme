package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/service"
)

// runChangelog saca las notas de versión de un proyecto a partir del diario.
//
// El markdown se monta aquí y no en el núcleo a propósito: los títulos de sección
// son texto que lee una persona, y el idioma solo lo conoce la interfaz. Este
// programa no tiene idioma de interfaz al que preguntar, así que escribe en el
// suyo —el mismo en el que escribe su ayuda—, y la aplicación monta el suyo
// traducido desde los mismos datos. Lo que **no** se duplica es la decisión de qué
// entra y en qué orden: eso es `ChangelogProject`, y es el mismo para los dos.
func runChangelog(args []string) int {
	fs := flag.NewFlagSet("changelog", flag.ExitOnError)
	root := fs.String("root", "", "raíz del workspace")
	project := fs.String("project", "", "proyecto del que sacar los cambios (obligatorio)")
	since := fs.String("since", "", "desde esta fecha, AAAA-MM-DD (por defecto: hace 30 días)")
	until := fs.String("until", "", "hasta esta fecha, AAAA-MM-DD, incluido el día (por defecto: hoy)")
	asJSON := fs.Bool("json", false, "sacar los datos en JSON en vez del markdown")
	_ = fs.Parse(args)

	log := newLogger(false)

	if strings.TrimSpace(*project) == "" {
		fmt.Fprintln(os.Stderr, "hace falta --project")
		fmt.Fprintln(os.Stderr, `por ejemplo:  saveme changelog --project mi-app --since 2026-02-01`)
		return 2
	}

	desde, err := parseFechaInicio(*since)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	hasta, err := parseFechaFin(*until)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}

	rt, err := open(*root, log)
	if err != nil {
		log.Error("no pude abrir el workspace", "err", err)
		return 1
	}
	defer rt.Close()

	out, err := rt.svc.ChangelogProject(context.Background(), *project, desde, hasta)
	if err != nil {
		log.Error("no pude sacar el changelog", "err", err)
		return 1
	}

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(out); err != nil {
			log.Error("no pude escribir el JSON", "err", err)
			return 1
		}
		return 0
	}

	fmt.Print(renderChangelog(out))
	return 0
}

// parseFechaInicio lee el principio de un rango: AAAA-MM-DD, o cero para «lo que
// corresponda».
//
// Se pide la fecha sin hora porque es lo que se escribe en una orden y lo que se
// pega de una nota de versión. Se interpreta en la zona local, que es la del día
// que el usuario tenía delante cuando la escribió.
func parseFechaInicio(valor string) (time.Time, error) {
	valor = strings.TrimSpace(valor)
	if valor == "" {
		return time.Time{}, nil
	}
	fecha, err := time.ParseInLocation("2006-01-02", valor, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("fecha ilegible %q: se espera AAAA-MM-DD", valor)
	}
	return fecha, nil
}

// parseFechaFin lee el final de un rango y lo lleva al **último instante de ese
// día**.
//
// Sin esto, `--until 2026-02-14` cortaría a medianoche del día 14 y dejaría fuera
// todo lo escrito ese mismo día, que es justo lo que cualquiera espera que entre
// al pedir «hasta el 14». El salto lo hace el núcleo y no una copia local, para
// que la CLI y la API no puedan divergir en esto.
func parseFechaFin(valor string) (time.Time, error) {
	fecha, err := parseFechaInicio(valor)
	if err != nil {
		return fecha, err
	}
	return service.EndOfDay(fecha), nil
}

// renderChangelog monta el documento markdown.
func renderChangelog(c *service.Changelog) string {
	var b strings.Builder

	fmt.Fprintf(&b, "# %s — cambios del %s al %s\n\n",
		c.Project, c.From.Format("2006-01-02"), c.To.Format("2006-01-02"))

	if c.Count == 0 {
		b.WriteString("Sin cambios apuntados en este rango.\n")
		return b.String()
	}

	etiquetas := etiquetasDeCategoria()
	for _, seccion := range c.Sections {
		// El nombre lo pone la taxonomía canónica, que es la misma que enseña la
		// interfaz. Una lista propia aquí sería una segunda fuente de verdad que se
		// desincroniza en cuanto se añada una categoría.
		nombre := seccion.Category
		if etiqueta, ok := etiquetas[seccion.Category]; ok {
			nombre = etiqueta
		}
		fmt.Fprintf(&b, "## %s\n\n", nombre)

		for _, entrada := range seccion.Entries {
			fmt.Fprintf(&b, "- **%s** · %s", entrada.Title, entrada.CreatedAt.Format("2006-01-02"))
			if entrada.CommitSHA != "" {
				fmt.Fprintf(&b, " · %s", shaCorto(entrada.CommitSHA))
			}
			fmt.Fprintf(&b, " · `%s`\n", entrada.RelPath)
			if linea := strings.TrimSpace(entrada.SummaryLine); linea != "" {
				fmt.Fprintf(&b, "  %s\n", linea)
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

// etiquetasDeCategoria es el nombre legible de cada categoría canónica.
func etiquetasDeCategoria() map[string]string {
	categorias := domain.Categories()
	out := make(map[string]string, len(categorias))
	for _, categoria := range categorias {
		out[categoria.Key] = categoria.Label
	}
	return out
}

// shaCorto recorta el hash a lo que se lee de un vistazo. El hash entero no cabe
// en una línea de changelog y no aporta nada más.
func shaCorto(sha string) string {
	const largo = 7
	if len(sha) > largo {
		return sha[:largo]
	}
	return sha
}

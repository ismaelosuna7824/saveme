//go:build !windows

package mcpconfig

// installedAppNames solo tiene sentido en Windows, donde las apps se apuntan en
// el registro. En macOS se detectan por su `.app` y en Linux por el PATH.
func installedAppNames() []string { return nil }

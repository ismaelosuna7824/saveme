package domain

import (
	"strings"
	"testing"
)

// Los secretos de prueba se montan por partes: escritos de una pieza, el escáner
// de secretos del propio GitHub bloquearía el push de este archivo.
func fake(parts ...string) string { return strings.Join(parts, "") }

func TestScanSecretsEncuentraLosFormatosConocidos(t *testing.T) {
	cases := []struct {
		kind, line string
	}{
		{"private_key", "-----BEGIN RSA " + "PRIVATE KEY-----"},
		{"private_key", "-----BEGIN " + "PRIVATE KEY-----"},
		{"aws_access_key", "la clave era " + fake("AK", "IA", "Q3EGRIZ2ZK7XWPLM")},
		{"github_token", "export GH=" + fake("gh", "p_", strings.Repeat("a1B2", 9))},
		{"slack_token", fake("xo", "xb-", "1234567890-abcdefghij")},
		{"stripe_key", fake("sk", "_live_", strings.Repeat("Ab3", 8))},
		{"google_api_key", fake("AI", "za", strings.Repeat("x9", 17), "Z")},
		{"anthropic_key", fake("sk-", "ant-", strings.Repeat("q7", 20))},
		{"openai_key", fake("sk-", "proj-", strings.Repeat("Zz9", 12))},
		{"jwt", fake("ey", "JhbGciOiJIUzI1NiJ9", ".ey", "JzdWIiOiIxMjM0NTY3ODkwIn0", ".SflKxwRJSMeKKF2QT4fw")},
		{"url_credentials", "DATABASE_URL=postgres://app:" + fake("s3cr", "3tPass") + "@db.internal:5432/app"},
		{"assignment", "password: " + fake("hun", "ter2!")},
		{"assignment", "API_KEY=" + fake("9f8e7d6c", "5b4a3210ff")},
	}
	for _, c := range cases {
		got := ScanSecrets([2]string{"body", "primera línea\n" + c.line})
		if len(got) != 1 {
			t.Errorf("%q: esperaba 1 hallazgo, hay %+v", c.line, got)
			continue
		}
		if got[0].Kind != c.kind {
			t.Errorf("%q: kind = %q, esperaba %q", c.line, got[0].Kind, c.kind)
		}
		if got[0].Line != 2 || got[0].Field != "body" {
			t.Errorf("%q: dónde = %s:%d, esperaba body:2", c.line, got[0].Field, got[0].Line)
		}
	}
}

// Un aviso que salta en cada resumen técnico se aprende a ignorar. La prosa que
// habla de tokens y contraseñas, y los marcadores de la documentación, no son
// secretos.
func TestScanSecretsNoSaltaConProsaNiMarcadores(t *testing.T) {
	for _, line := range []string{
		"El `token` de un solo uso vale 15 minutos.",
		"token: el que devuelve saveme_summary_propose",
		"api_key = string",
		"password: <tu contraseña>",
		"API_KEY=${API_KEY}",
		"SECRET=process.env.SECRET",
		"secret: os.Getenv(\"SECRET\")",
		"postgres://user:password@localhost:5432/db",
		"postgres://app:${DB_PASS}@db/app",
		"token: xxxxxxxxxxxxxxxxxxxx",
		"password: ********",
		"Usamos JWT firmados con HS256 y una api key por cliente.",
		"El hash es sha256 y el id sm_01m4bwzp6vj966cgg84br3p1wz.",
	} {
		if got := ScanSecrets([2]string{"body", line}); len(got) != 0 {
			t.Errorf("%q no es un secreto, pero dio %+v", line, got)
		}
	}
}

// El aviso viaja al agente, al inbox y a los logs: nunca puede llevar el secreto.
func TestScanSecretsNoDevuelveElSecreto(t *testing.T) {
	secret := fake("gh", "p_", strings.Repeat("Q8w", 12))
	got := ScanSecrets([2]string{"body", "token=" + secret})
	if len(got) != 1 {
		t.Fatalf("esperaba 1 hallazgo (sin contar la asignación aparte), hay %+v", got)
	}
	if got[0].Kind != "github_token" {
		t.Errorf("kind = %q: el formato concreto tiene que ganar a la asignación", got[0].Kind)
	}
	if strings.Contains(got[0].Hint, secret[4:]) {
		t.Errorf("la pista deja ver el secreto: %q", got[0].Hint)
	}
}

// @ts-check
import { defineConfig } from 'astro/config'
import { loadEnv } from 'vite'

// El config se evalúa antes de que Astro cargue `.env`; así lo recomienda su
// documentación para leerlo aquí.
const { SITE_URL } = loadEnv(process.env.NODE_ENV ?? 'production', process.cwd(), '')

// `SITE_URL` es la URL pública donde se despliega la landing. Sirve para las
// URLs absolutas de `canonical`, `hreflang` y Open Graph; sin ella esas etiquetas
// salen relativas, que los buscadores y las redes no siempre aceptan.
export default defineConfig({
  site: SITE_URL || undefined,
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
})

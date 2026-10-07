import { ShieldAlert } from 'lucide-react'

import type { SecretFinding } from '@/api/types'
import { useT, type TranslationKey } from '@/i18n'

// Mapas y no claves montadas con plantillas: así el compilador comprueba que
// cada tipo que conoce el core tiene su texto, y uno nuevo sin traducir se ve
// con su clave en vez de con una clave de diccionario rota.
const KIND_KEYS: Record<string, TranslationKey> = {
  private_key: 'common.secrets.kind.private_key',
  aws_access_key: 'common.secrets.kind.aws_access_key',
  github_token: 'common.secrets.kind.github_token',
  slack_token: 'common.secrets.kind.slack_token',
  stripe_key: 'common.secrets.kind.stripe_key',
  google_api_key: 'common.secrets.kind.google_api_key',
  anthropic_key: 'common.secrets.kind.anthropic_key',
  openai_key: 'common.secrets.kind.openai_key',
  jwt: 'common.secrets.kind.jwt',
  url_credentials: 'common.secrets.kind.url_credentials',
  assignment: 'common.secrets.kind.assignment',
}

const FIELD_KEYS: Record<string, TranslationKey> = {
  title: 'common.secrets.field.title',
  summary: 'common.secrets.field.summary',
  body: 'common.secrets.field.body',
}

/**
 * Aviso de posibles credenciales en un resumen.
 *
 * Solo avisa: aprobar o compartir siguen siendo decisión de la persona. Dice qué
 * parece, dónde está y cómo empieza —enmascarado—, que es lo justo para ir a
 * buscarlo sin volver a enseñar el secreto.
 */
export function SecretWarning({ findings, hint }: { findings: SecretFinding[]; hint: string }) {
  const t = useT()
  if (findings.length === 0) return null

  return (
    <div role="alert" className="border border-destructive/60 bg-destructive/10 px-2 py-1.5 text-2xs">
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <ShieldAlert className="size-3 shrink-0" />
        {t('common.secrets.title')}
      </p>
      <ul className="mt-1 space-y-0.5 text-foreground">
        {findings.map((f, index) => (
          <li key={index}>
            {t('common.secrets.where', {
              kind: KIND_KEYS[f.kind] ? t(KIND_KEYS[f.kind]) : f.kind,
              field: FIELD_KEYS[f.field] ? t(FIELD_KEYS[f.field]) : f.field,
              line: f.line,
              hint: f.hint,
            })}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-muted-foreground">{hint}</p>
    </div>
  )
}

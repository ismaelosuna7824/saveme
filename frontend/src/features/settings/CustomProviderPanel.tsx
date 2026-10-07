import { useState } from 'react'
import { Eye, Plug, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { errorMessage } from '@/api/client'
import { useConfigureMCP, useMCPCustomSnippet, useUnconfigureMCP } from '@/api/queries'
import type { MCPCustomDef } from '@/api/types'
import { ErrorPanel } from '@/components/common/ErrorPanel'
import { SectionHeader } from '@/components/common/SectionHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CopyField } from '@/features/onboarding/CopyField'
import { useT } from '@/i18n'
import { mcpNoticeText, providerName, snippetWarnings } from '@/lib/labels'

/**
 * Configurar un cliente que no está en la lista.
 *
 * El usuario dice dónde guarda su cliente los servidores MCP y qué forma tiene la
 * entrada; el core la escribe con las mismas garantías que en los conocidos
 * (`mcpconfig.Custom`). No se guarda la definición en ningún sitio: es una
 * operación, como «configurar los marcados», no un cliente nuevo de la lista.
 */
export function CustomProviderPanel() {
  const t = useT()
  const configure = useConfigureMCP()
  const unconfigure = useUnconfigureMCP()
  const [path, setPath] = useState('')
  const [serversKey, setServersKey] = useState('mcpServers')
  const [entryType, setEntryType] = useState('')
  const [envKey, setEnvKey] = useState('env')
  const [commandArray, setCommandArray] = useState(false)
  // Lo que se enseña es lo que se pidió ver, no lo que se está escribiendo: si
  // el bloque siguiera al teclado, se pediría uno por pulsación.
  const [previewed, setPreviewed] = useState<MCPCustomDef | null>(null)
  const snippet = useMCPCustomSnippet(previewed)

  const definition = (): MCPCustomDef | null => {
    if (path.trim().length === 0) {
      toast.error(t('settings.agents.custom.needPath'))
      return null
    }
    return {
      path: path.trim(),
      servers_key: serversKey.trim(),
      entry_type: entryType.trim(),
      command_array: commandArray,
      env_key: envKey.trim(),
    }
  }

  const run = () => {
    const custom = definition()
    if (custom === null) return
    configure.mutate(
      { providers: ['custom'], custom },
      {
        onSuccess: (data) => {
          const result = data.results[0]
          switch (result?.action) {
            case 'created':
            case 'merged':
            case 'updated':
              toast.success(t('settings.agents.custom.done', { path: result.path ?? custom.path }), {
                description: result.backup,
              })
              break
            case 'already-configured':
              toast.info(t('settings.agents.custom.present'), { description: mcpNoticeText(t, result) || undefined })
              break
            case 'manual':
              toast.warning(t('settings.agents.custom.manual'), { description: mcpNoticeText(t, result) || undefined })
              setPreviewed(custom)
              break
            default:
              toast.error(t('settings.agents.custom.failed'), { description: mcpNoticeText(t, result) || undefined })
          }
        },
        onError: (error) =>
          toast.error(t('settings.agents.custom.failed'), { description: errorMessage(error) }),
      },
    )
  }

  const remove = () => {
    const custom = definition()
    if (custom === null) return
    unconfigure.mutate(
      { providers: ['custom'], custom },
      {
        onSuccess: (data) => {
          const result = data.results[0]
          const description = mcpNoticeText(t, result) || undefined
          const name = t('settings.agents.custom.title')
          switch (result?.action) {
            case 'removed':
              toast.success(t('settings.agents.removed', { name }), { description })
              break
            case 'not-configured':
              toast.info(t('settings.agents.notConfigured', { name }), { description })
              break
            default:
              toast.warning(t('settings.agents.removeManual'), { description })
          }
        },
        onError: (error) =>
          toast.error(t('settings.agents.removeFailed'), { description: errorMessage(error) }),
      },
    )
  }

  const busy = configure.isPending || unconfigure.isPending

  return (
    <section className="space-y-2">
      <SectionHeader
        title={t('settings.agents.custom.title')}
        hint={t('settings.agents.custom.hint')}
      />
      <p className="text-2xs text-muted-foreground">{t('settings.agents.custom.lead')}</p>

      <div className="space-y-2 border border-dashed border-border bg-panel px-2 py-2">
        <div className="space-y-1">
          <Label htmlFor="custom-mcp-path">{t('settings.agents.custom.path')}</Label>
          <Input
            id="custom-mcp-path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder={t('settings.agents.custom.pathPlaceholder')}
            spellCheck={false}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="custom-mcp-key">{t('settings.agents.custom.serversKey')}</Label>
            <Input
              id="custom-mcp-key"
              value={serversKey}
              onChange={(event) => setServersKey(event.target.value)}
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="custom-mcp-type">{t('settings.agents.custom.entryType')}</Label>
            <Input
              id="custom-mcp-type"
              value={entryType}
              onChange={(event) => setEntryType(event.target.value)}
              placeholder={t('settings.agents.custom.entryTypePlaceholder')}
              spellCheck={false}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="custom-mcp-env">{t('settings.agents.custom.envKey')}</Label>
            <Input
              id="custom-mcp-env"
              value={envKey}
              onChange={(event) => setEnvKey(event.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-2xs text-muted-foreground">
          <Checkbox
            checked={commandArray}
            onChange={(event) => setCommandArray(event.target.checked)}
          />
          {t('settings.agents.custom.commandArray')}
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={run} disabled={busy}>
            <Plug className="size-3" />
            {t('settings.agents.custom.configure')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const custom = definition()
              if (custom !== null) setPreviewed(custom)
            }}
          >
            <Eye className="size-3" />
            {t('settings.agents.custom.preview')}
          </Button>
          <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
            <Trash2 className="size-3" />
            {t('settings.agents.custom.remove')}
          </Button>
        </div>

        {previewed !== null && snippet.error ? (
          <ErrorPanel error={snippet.error} title={t('onboarding.apply.snippetError')} />
        ) : null}
        {previewed !== null && snippet.data ? (
          <div className="space-y-1.5">
            <CopyField
              label={t('onboarding.apply.snippet', {
                name: providerName(t, snippet.data.provider, snippet.data.name),
              })}
              value={snippet.data.body}
              maxLines={12}
            />
            {snippetWarnings(t, snippet.data).map((warning) => (
              <p key={warning} className="text-2xs text-primary/85">
                {warning}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

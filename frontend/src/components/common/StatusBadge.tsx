import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { statusLabel } from '@/lib/labels'

const VARIANT_BY_STATUS: Record<string, 'secondary' | 'default' | 'outline'> = {
  confirmed: 'secondary',
  draft: 'default',
  unmanaged: 'outline',
}

/** Estado de un resumen: confirmado / borrador / sin gestionar. */
export function StatusBadge({ status }: { status: string }) {
  const t = useT()
  return (
    <Badge variant={VARIANT_BY_STATUS[status] ?? 'outline'} title={`status: ${status}`}>
      {statusLabel(t, status)}
    </Badge>
  )
}

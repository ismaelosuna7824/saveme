import { Columns2, Eye, FileCode2, PenLine } from 'lucide-react'

import type { PreviewMode } from '@/api/types'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MODE_HINT_KEY, MODE_LABEL_KEY, PREVIEW_MODES, isPreviewMode } from '@/features/editor/mode'
import { useT } from '@/i18n'

const ICONS: Record<PreviewMode, typeof Eye> = {
  live: PenLine,
  source: FileCode2,
  split: Columns2,
  preview: Eye,
}

interface ModeSwitchProps {
  mode: PreviewMode
  onChange: (mode: PreviewMode) => void
}

/** Control segmentado live | source | split | preview. */
export function ModeSwitch({ mode, onChange }: ModeSwitchProps) {
  const t = useT()

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (isPreviewMode(value)) onChange(value)
      }}
    >
      <TabsList className="border-b-0 pb-0">
        {PREVIEW_MODES.map((value) => {
          const Icon = ICONS[value]
          return (
            <TabsTrigger key={value} value={value} title={`${t(MODE_HINT_KEY[value])} (⌘E)`}>
              <Icon className="size-3" />
              {t(MODE_LABEL_KEY[value])}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}

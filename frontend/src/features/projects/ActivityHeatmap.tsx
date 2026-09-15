import { useMemo } from 'react'

import type { ActivityMap, ActivityDay } from '@/api/types'
import { formatMonthShort } from '@/lib/format'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** Nombres cortos de los días, empezando en lunes. */
const DIAS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/** Cuántos niveles de intensidad hay, sin contar el día vacío. */
const NIVELES = 4

/**
 * Intensidad de un día, de 0 (nada) a `NIVELES`.
 *
 * Se reparte sobre el día más cargado de la ventana y no sobre un número fijo: en
 * un proyecto de tres entradas al mes, escalar contra un 10 inventado dejaría el
 * mapa entero del color más flojo y no se vería nada. El `max` lo calcula el
 * núcleo, así que aquí no hay que recorrer los días otra vez.
 */
function nivel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  const proporcion = count / max
  // `ceil` y no `round`: con redondeo, el día más flojo de un mapa con un pico
  // alto caería a cero y desaparecería, que es justo lo contrario de lo que se
  // quiere enseñar.
  return Math.min(NIVELES, Math.max(1, Math.ceil(proporcion * NIVELES)))
}

const FONDO: Record<number, string> = {
  0: 'bg-border/60',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary',
}

interface Props {
  data: ActivityMap
}

/**
 * Mapa de actividad, al estilo del calendario de contribuciones.
 *
 * Se pintan las semanas en columnas y los días en filas, con el lunes arriba. El
 * array que llega trae **todos** los días de la ventana y en orden, así que lo
 * único que hay que calcular aquí es por qué día de la semana empieza: el resto es
 * trocear de siete en siete. Nada de aritmética de fechas más allá de eso, que es
 * donde se cuelan los errores de mes y de huso.
 */
export function ActivityHeatmap({ data }: Props) {
  const t = useT()

  const { semanas, meses } = useMemo(() => {
    const celdas: (ActivityDay | null)[] = []

    // Hueco del principio: si el primer día de la ventana es un jueves, la primera
    // columna empieza con tres huecos para que las filas sean días de la semana de
    // verdad.
    const primero = data.entries[0]
    if (primero !== undefined) {
      const fecha = new Date(`${primero.date}T00:00:00`)
      // `getDay()` da 0 para domingo; se pasa a «lunes primero».
      const hueco = Number.isNaN(fecha.getTime()) ? 0 : (fecha.getDay() + 6) % 7
      for (let i = 0; i < hueco; i += 1) celdas.push(null)
    }

    for (const entrada of data.entries) celdas.push(entrada)

    // Y hueco al final hasta completar la última semana.
    while (celdas.length % 7 !== 0) celdas.push(null)

    const agrupadas: (ActivityDay | null)[][] = []
    for (let i = 0; i < celdas.length; i += 7) {
      agrupadas.push(celdas.slice(i, i + 7))
    }

    // Etiqueta de mes en la primera columna que estrena mes: sin esto, un mapa de
    // un año es una cuadrícula sin referencia temporal.
    const etiquetas: (string | null)[] = []
    let mesAnterior = ''
    for (const semana of agrupadas) {
      const primerDia = semana.find((celda): celda is ActivityDay => celda !== null)
      if (primerDia === undefined) {
        etiquetas.push(null)
        continue
      }
      const mes = primerDia.date.slice(0, 7)
      if (mes !== mesAnterior) {
        mesAnterior = mes
        etiquetas.push(mes)
      } else {
        etiquetas.push(null)
      }
    }

    return { semanas: agrupadas, meses: etiquetas }
  }, [data.entries])

  if (data.entries.length === 0) {
    return <p className="text-2xs text-muted-foreground">{t('projects.activity.empty')}</p>
  }

  /** Texto de una celda: la fecha y cuánto, que es lo que se quiere al pasar por encima. */
  const tituloDe = (dia: ActivityDay): string =>
    dia.count === 0
      ? t('projects.activity.dayEmpty', { date: dia.date })
      : t('projects.activity.day', { count: dia.count, date: dia.date })

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {/* Columna de nombres de día: solo tres, o el mapa se llena de letras. */}
        <div className="flex shrink-0 flex-col gap-[2px] pt-[14px] text-[9px] leading-none text-muted-foreground">
          {DIAS.map((dia, indice) => (
            <span key={dia} className="flex h-2.5 items-center">
              {indice % 2 === 0 ? t(`projects.activity.weekday.${dia}`) : ''}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          {/* Etiquetas de mes, alineadas con las columnas de abajo. */}
          <div className="flex gap-[2px] text-[9px] leading-none text-muted-foreground">
            {meses.map((mes, indice) => (
              <span key={indice} className="flex h-3 w-2.5 shrink-0 items-center">
                {mes === null ? '' : formatMonthShort(mes)}
              </span>
            ))}
          </div>

          <div
            className="flex gap-[2px]"
            role="img"
            aria-label={t('projects.activity.summary', {
              count: data.total,
              active: data.active,
              days: data.days,
            })}
          >
            {semanas.map((semana, indiceSemana) => (
              <div key={indiceSemana} className="flex shrink-0 flex-col gap-[2px]">
                {semana.map((dia, indiceDia) =>
                  dia === null ? (
                    <span key={indiceDia} className="size-2.5" />
                  ) : (
                    <span
                      key={dia.date}
                      title={tituloDe(dia)}
                      className={cn('size-2.5 rounded-[2px]', FONDO[nivel(dia.count, data.max)])}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leyenda: sin ella, los tonos no significan nada para quien no conoce el
          gráfico. */}
      <div className="flex items-center gap-1.5 pl-[18px] text-[9px] text-muted-foreground">
        <span>{t('projects.activity.less')}</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} className={cn('size-2.5 rounded-[2px]', FONDO[n])} />
        ))}
        <span>{t('projects.activity.more')}</span>
      </div>
    </div>
  )
}

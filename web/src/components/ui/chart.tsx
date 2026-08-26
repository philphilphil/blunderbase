import { createContext, useContext, useId, useMemo, type ComponentProps, type ReactNode } from 'react'
import { Legend, ResponsiveContainer, Tooltip } from 'recharts'

import { cn } from '@/lib/utils'

/**
 * The shadcn/ui chart shell over Recharts, cut down to what Blunderbase draws (area,
 * line and bar charts on a dark ground). Series colours come from the chart config and
 * are published as `--color-<key>` CSS variables scoped to the chart, so a Recharts prop
 * can reference `var(--color-eval)` and the palette stays in one place.
 */
export type ChartConfig = Record<
  string,
  { label?: ReactNode; icon?: React.ComponentType; color?: string }
>

interface ChartContextValue {
  config: ChartConfig
}

const ChartContext = createContext<ChartContextValue | null>(null)

export function useChart(): ChartContextValue {
  const context = useContext(ChartContext)
  if (!context) throw new Error('useChart must be used inside <ChartContainer>')
  return context
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ComponentProps<'div'> & {
  config: ChartConfig
  children: ComponentProps<typeof ResponsiveContainer>['children']
}) {
  const uniqueId = useId()
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`
  const value = useMemo(() => ({ config }), [config])

  return (
    <ChartContext.Provider value={value}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center overflow-hidden text-[0.6875rem] [&_.recharts-cartesian-axis-tick_text]:fill-dim [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-hairline [&_.recharts-curve.recharts-tooltip-cursor]:stroke-edge [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, item]) => item.color)
  if (entries.length === 0) return null
  return (
    <style
      // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${entries
          .map(([key, item]) => `  --color-${key}: ${item.color};`)
          .join('\n')}\n}`,
      }}
    />
  )
}

export const ChartTooltip = Tooltip
export const ChartLegend = Legend

interface TooltipItem {
  name?: string | number
  dataKey?: string | number
  value?: unknown
  color?: string
  payload?: Record<string, unknown>
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel = false,
  hideIndicator = false,
  className,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: unknown
  labelFormatter?: (label: unknown, payload: TooltipItem[]) => ReactNode
  formatter?: (value: unknown, name: string, item: TooltipItem) => ReactNode
  hideLabel?: boolean
  hideIndicator?: boolean
  className?: string
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        'min-w-[8rem] rounded-md border border-edge bg-elevated px-2.5 py-2 text-[0.6875rem] shadow-xl',
        className,
      )}
    >
      {!hideLabel && label !== undefined && (
        <div className="mb-1 font-mono text-[0.625rem] text-dim">
          {labelFormatter ? labelFormatter(label, payload) : String(label)}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index)
          const entry = config[key]
          return (
            <div key={key} className="flex items-center gap-2">
              {!hideIndicator && (
                <span
                  className="size-2 shrink-0 rounded-[0.125rem]"
                  style={{ background: entry?.color ?? item.color ?? 'var(--bb-accent)' }}
                />
              )}
              <span className="flex-1 text-soft">{entry?.label ?? item.name ?? key}</span>
              <span className="font-mono text-ink tabular">
                {formatter
                  ? formatter(item.value, key, item)
                  : typeof item.value === 'number'
                    ? item.value.toLocaleString()
                    : String(item.value ?? '')}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ChartLegendContent({
  payload,
  className,
}: {
  payload?: { value?: string; dataKey?: string | number; color?: string }[]
  className?: string
}) {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-3 pt-2', className)}>
      {payload.map((item, index) => {
        const key = String(item.dataKey ?? item.value ?? index)
        const entry = config[key]
        return (
          <div key={key} className="flex items-center gap-1.5 text-[0.6875rem] text-soft">
            <span
              className="size-2 rounded-[0.125rem]"
              style={{ background: entry?.color ?? item.color ?? 'var(--bb-accent)' }}
            />
            {entry?.label ?? item.value ?? key}
          </div>
        )
      })}
    </div>
  )
}

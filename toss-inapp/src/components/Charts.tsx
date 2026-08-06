type GaugeBand = {
  to: number
  color: string
}

type GaugeChartProps = {
  value: number
  label: string
  bands?: GaugeBand[]
  valueSuffix?: string
}

type BarDatum = {
  label: string
  value: number
  formattedValue: string
}

type HorizontalBarChartProps = {
  data: BarDatum[]
  ariaLabel: string
}

type LineSeries = {
  label: string
  color: string
  points: Array<{
    date: string
    value: number
  }>
}

type LineChartProps = {
  series: LineSeries[]
  ariaLabel: string
  formatValue: (value: number) => string
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function pointOnArc(centerX: number, centerY: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(radians),
    y: centerY + radius * Math.sin(radians),
  }
}

function arcPath(startPercent: number, endPercent: number) {
  const centerX = 120
  const centerY = 112
  const radius = 86
  const start = pointOnArc(centerX, centerY, radius, 180 + startPercent * 1.8)
  const end = pointOnArc(centerX, centerY, radius, 180 + endPercent * 1.8)

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`
}

export function GaugeChart({
  value,
  label,
  bands = [
    { to: 40, color: '#f04452' },
    { to: 60, color: '#f59f00' },
    { to: 100, color: '#20a66a' },
  ],
  valueSuffix = '점',
}: GaugeChartProps) {
  const normalizedValue = clamp(Number.isFinite(value) ? value : 0, 0, 100)
  const marker = pointOnArc(120, 112, 86, 180 + normalizedValue * 1.8)
  let bandStart = 0

  return (
    <div className="chart-shell chart-shell--gauge">
      <svg
        className="chart-svg chart-svg--gauge"
        viewBox="0 0 240 148"
        role="img"
        aria-label={`${label} ${Math.round(normalizedValue)}${valueSuffix}`}
      >
        {bands.map((band) => {
          const start = bandStart
          const end = clamp(band.to, start, 100)
          bandStart = end
          return (
            <path
              key={`${start}-${end}`}
              d={arcPath(start, end)}
              fill="none"
              stroke={band.color}
              strokeWidth="16"
              strokeLinecap="butt"
            />
          )
        })}
        <circle cx={marker.x} cy={marker.y} r="7" fill="#ffffff" stroke="#191f28" strokeWidth="4">
          <title>{`${Math.round(normalizedValue)}${valueSuffix}`}</title>
        </circle>
        <text x="120" y="94" textAnchor="middle" className="chart-gauge__value">
          {Math.round(normalizedValue)}
        </text>
        <text x="120" y="115" textAnchor="middle" className="chart-gauge__label">
          {label}
        </text>
        <text x="25" y="137" textAnchor="middle" className="chart-axis__label">0</text>
        <text x="120" y="28" textAnchor="middle" className="chart-axis__label">50</text>
        <text x="215" y="137" textAnchor="middle" className="chart-axis__label">100</text>
      </svg>
    </div>
  )
}

export function HorizontalBarChart({ data, ariaLabel }: HorizontalBarChartProps) {
  if (data.length === 0) {
    return null
  }

  const width = 360
  const rowHeight = 38
  const top = 22
  const bottom = 20
  const left = 84
  const right = 44
  const chartWidth = width - left - right
  const height = top + data.length * rowHeight + bottom
  const values = data.map((item) => item.value)
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(0, ...values)
  const span = Math.max(maximum - minimum, 1)
  const paddedMinimum = minimum - span * 0.08
  const paddedMaximum = maximum + span * 0.08
  const paddedSpan = paddedMaximum - paddedMinimum
  const xForValue = (value: number) => left + ((value - paddedMinimum) / paddedSpan) * chartWidth
  const zeroX = xForValue(0)

  return (
    <div className="chart-shell chart-shell--bars">
      <svg
        className="chart-svg chart-svg--bars"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={zeroX}
          y1={top - 9}
          x2={zeroX}
          y2={height - bottom + 2}
          className="chart-grid__zero"
        />
        {data.map((item, index) => {
          const y = top + index * rowHeight
          const valueX = xForValue(item.value)
          const barX = Math.min(zeroX, valueX)
          const barWidth = Math.max(Math.abs(valueX - zeroX), 2)
          const isPositive = item.value >= 0
          const valueLabelX = isPositive
            ? Math.min(valueX + 5, width - right + 4)
            : Math.max(valueX - 5, left - 4)

          return (
            <g key={`${item.label}-${index}`}>
              <title>{`${item.label} ${item.formattedValue}`}</title>
              <text x={left - 8} y={y + 16} textAnchor="end" className="chart-bar__label">
                {item.label}
              </text>
              <rect
                x={barX}
                y={y + 4}
                width={barWidth}
                height="18"
                rx="6"
                className={isPositive ? 'chart-bar chart-bar--positive' : 'chart-bar chart-bar--negative'}
              />
              <text
                x={valueLabelX}
                y={y + 17}
                textAnchor={isPositive ? 'start' : 'end'}
                className="chart-bar__value"
              >
                {item.formattedValue}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function linePath(
  points: LineSeries['points'],
  xForIndex: (index: number, count: number) => number,
  yForValue: (value: number) => number,
) {
  return points
    .map((point, index) => {
      const x = xForIndex(index, points.length)
      const y = yForValue(point.value)
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')
}

function shortDate(value?: string) {
  if (!value) {
    return '-'
  }
  const datePart = value.split('T', 1)[0]
  const [, month, day] = datePart.split('-')
  return month && day ? `${month}.${day}` : datePart
}

export function LineChart({ series, ariaLabel, formatValue }: LineChartProps) {
  const visibleSeries = series.filter((item) => item.points.length > 0)
  if (visibleSeries.length === 0) {
    return null
  }

  const width = 360
  const height = 238
  const left = 56
  const right = 12
  const top = 38
  const bottom = 30
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const values = visibleSeries.flatMap((item) => item.points.map((point) => point.value))
  const rawMinimum = Math.min(...values)
  const rawMaximum = Math.max(...values)
  const rawSpan = Math.max(rawMaximum - rawMinimum, Math.abs(rawMaximum) * 0.01, 1)
  const minimum = rawMinimum - rawSpan * 0.08
  const maximum = rawMaximum + rawSpan * 0.08
  const span = maximum - minimum
  const yForValue = (value: number) => top + ((maximum - value) / span) * chartHeight
  const xForIndex = (index: number, count: number) => (
    left + (count <= 1 ? chartWidth / 2 : (index / (count - 1)) * chartWidth)
  )
  const firstSeries = visibleSeries[0]
  const gridLines = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3
    return {
      y: top + ratio * chartHeight,
      value: maximum - ratio * span,
    }
  })

  return (
    <div className="chart-shell chart-shell--line">
      <svg
        className="chart-svg chart-svg--line"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
      >
        {visibleSeries.map((item, index) => (
          <g key={item.label} transform={`translate(${left + index * 92} 14)`}>
            <line x1="0" y1="0" x2="20" y2="0" stroke={item.color} strokeWidth="3" strokeLinecap="round" />
            <text x="27" y="4" className="chart-legend__label">{item.label}</text>
          </g>
        ))}
        {gridLines.map((line, index) => (
          <g key={index}>
            <line x1={left} y1={line.y} x2={width - right} y2={line.y} className="chart-grid__line" />
            <text x={left - 7} y={line.y + 4} textAnchor="end" className="chart-axis__label">
              {formatValue(line.value)}
            </text>
          </g>
        ))}
        {visibleSeries.map((item) => (
          <path
            key={item.label}
            d={linePath(item.points, xForIndex, yForValue)}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <title>{item.label}</title>
          </path>
        ))}
        {visibleSeries.map((item) => {
          const lastIndex = item.points.length - 1
          const lastPoint = item.points[lastIndex]
          return (
            <circle
              key={`${item.label}-last`}
              cx={xForIndex(lastIndex, item.points.length)}
              cy={yForValue(lastPoint.value)}
              r="4"
              fill="#ffffff"
              stroke={item.color}
              strokeWidth="3"
            >
              <title>{`${item.label} ${formatValue(lastPoint.value)}`}</title>
            </circle>
          )
        })}
        <text x={left} y={height - 8} textAnchor="start" className="chart-axis__label">
          {shortDate(firstSeries.points[0]?.date)}
        </text>
        <text x={width - right} y={height - 8} textAnchor="end" className="chart-axis__label">
          {shortDate(firstSeries.points[firstSeries.points.length - 1]?.date)}
        </text>
      </svg>
    </div>
  )
}

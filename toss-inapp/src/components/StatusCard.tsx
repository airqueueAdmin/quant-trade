type StatusCardProps = {
  title: string
  description: string
  tag: string
  tone?: 'neutral' | 'positive' | 'warning'
  meta?: string
}

export function StatusCard({
  title,
  description,
  tag,
  tone = 'neutral',
  meta,
}: StatusCardProps) {
  return (
    <article className={`status-card status-card--${tone}`}>
      <div className="status-card__tag">{tag}</div>
      <h2 className="status-card__title">{title}</h2>
      <p className="status-card__description">{description}</p>
      {meta ? <p className="status-card__meta">{meta}</p> : null}
    </article>
  )
}

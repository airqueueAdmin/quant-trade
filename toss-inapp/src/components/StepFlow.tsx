import { Children, type ReactNode } from 'react'

export interface StepDefinition {
  label: string
  title: string
  description: string
}

interface StepFlowProps {
  steps: readonly StepDefinition[]
  currentStep: number
  onStepChange: (step: number) => void
  children: ReactNode
  nextDisabled?: boolean
  nextLabel?: string
  renderActiveChild?: boolean
  pageTitle?: string
}

export function StepFlow({
  steps,
  currentStep,
  onStepChange,
  children,
  nextDisabled = false,
  nextLabel = '다음',
  renderActiveChild = true,
  pageTitle,
}: StepFlowProps) {
  const stepContents = Children.toArray(children)
  const safeStep = Math.min(Math.max(currentStep, 0), steps.length - 1)
  const activeStep = steps[safeStep]
  const isFirstStep = safeStep === 0
  const isLastStep = safeStep === steps.length - 1

  return (
    <div className="step-flow">
      <section className="step-flow__header" aria-label="진행 단계">
        <div className="step-flow__progress-row">
          <span className="step-flow__count">
            {safeStep + 1} / {steps.length}
          </span>
          <div
            className="step-flow__progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={safeStep + 1}
          >
            <span style={{ width: `${((safeStep + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        <div className="step-flow__step-list" aria-label="단계 바로가기">
          {steps.map((step, index) => (
            <button
              key={step.label}
              type="button"
              className={index === safeStep ? 'step-flow__step step-flow__step--active' : 'step-flow__step'}
              onClick={() => onStepChange(index)}
              aria-current={index === safeStep ? 'step' : undefined}
            >
              {step.label}
            </button>
          ))}
        </div>

        <p className="step-flow__eyebrow">
          {pageTitle ? `${pageTitle} · ` : ''}지금 할 일
        </p>
        <h2 className="step-flow__title">{activeStep.title}</h2>
        <p className="step-flow__description">{activeStep.description}</p>
      </section>

      <div className="step-flow__content" key={safeStep}>
        {renderActiveChild ? stepContents[safeStep] : children}
      </div>

      <nav className="step-flow__actions" aria-label="단계 이동">
        {!isFirstStep ? (
          <button
            type="button"
            className="secondary-action step-flow__action"
            onClick={() => onStepChange(safeStep - 1)}
          >
            이전
          </button>
        ) : (
          <span />
        )}
        {!isLastStep ? (
          <button
            type="button"
            className="primary-action step-flow__action"
            onClick={() => onStepChange(safeStep + 1)}
            disabled={nextDisabled}
          >
            {nextLabel}
          </button>
        ) : null}
      </nav>
    </div>
  )
}

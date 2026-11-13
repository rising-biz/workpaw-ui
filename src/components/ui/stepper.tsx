import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "../../lib/utils"
import { Badge } from "./badge"
import { Button } from "./button"
import { useUIText } from "./ui-text"

/**
 * One step of a Stepper. `panelId` (optional) wires the step control to the
 * panel it reveals via aria-controls — pass the real panel element id.
 */
export interface StepperItem {
  label: string
  /** id of the panel this step controls (aria-controls); omit when none. */
  panelId?: string
  completed?: boolean
  disabled?: boolean
}

export type StepperStepState = "current" | "complete" | "upcoming"

export interface StepperStepProps {
  /** Zero-based position; drives the aria label and the fallback badge number. */
  index: number
  item: StepperItem
  state: StepperStepState
  /** Called with the step index when the step control is activated. */
  onSelect?: (index: number) => void
  /** Disables every step (e.g. while a request is in flight). */
  disabled?: boolean
  className?: string
}

/**
 * A single step control (`<li>` + Button + numbered Badge). Rendered by
 * `Stepper`; also exported for fully custom step layouts. Accessibility:
 * `aria-current="step"` on the active step, `aria-controls` to its panel,
 * `aria-disabled` when not selectable.
 */
function StepperStep({
  index,
  item,
  state,
  onSelect,
  disabled = false,
  className,
}: StepperStepProps) {
  const t = useUIText()
  // {step}/{label} template from the copy dictionary, substituted here —
  // the library ships no i18n runtime (README: UITextProvider).
  const stepAria = t.stepper.stepLabel
    .replace("{step}", String(index + 1))
    .replace("{label}", item.label)
  const notSelectable = disabled || item.disabled

  return (
    <li className={cn("min-w-0 flex-1", className)} data-slot="stepper-step" data-state={state}>
      <Button
        type="button"
        variant={state === "current" ? "secondary" : "ghost"}
        aria-label={stepAria}
        aria-current={state === "current" ? "step" : undefined}
        aria-controls={item.panelId}
        disabled={notSelectable}
        onClick={() => onSelect?.(index)}
        className="h-auto w-full flex-col gap-2 px-1 py-2 sm:flex-row sm:px-2.5"
      >
        <Badge
          variant={state === "current" ? "default" : "outline"}
          aria-hidden="true"
        >
          {item.completed || state === "complete" ? <Check /> : index + 1}
        </Badge>
        <span className="min-w-0 whitespace-normal text-center">{item.label}</span>
      </Button>
    </li>
  )
}

export interface StepperProps extends React.ComponentProps<"nav"> {
  steps: StepperItem[]
  /** Zero-based index of the active step. */
  currentStep: number
  /** Called with the clicked step index (omit for a read-only stepper). */
  onStepChange?: (step: number) => void
  /** Accessible nav label; defaults to the dictionary ("步骤导航"). */
  label?: string
  /** Disables every step (e.g. while a request is in flight). */
  disabled?: boolean
}

/**
 * Step navigation composed from Button + Badge (functional baseline:
 * admin console's stepper, including `aria-current="step"`). Clickable steps
 * move through `onStepChange`; the current step is announced by screen readers
 * and marked visually with the secondary variant + filled badge.
 */
function Stepper({
  steps,
  currentStep,
  onStepChange,
  label,
  disabled = false,
  className,
  ...props
}: StepperProps) {
  const t = useUIText()
  return (
    <nav
      aria-label={label ?? t.stepper.label}
      data-slot="stepper"
      className={className}
      {...props}
    >
      <ol className="flex items-start gap-2">
        {steps.map((item, index) => (
          <StepperStep
            key={item.panelId ?? item.label}
            index={index}
            item={item}
            state={
              index === currentStep
                ? "current"
                : index < currentStep || item.completed
                  ? "complete"
                  : "upcoming"
            }
            onSelect={onStepChange}
            disabled={disabled}
          />
        ))}
      </ol>
    </nav>
  )
}

export { Stepper, StepperStep }

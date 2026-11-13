import * as React from "react"
import { Check, Copy, X } from "lucide-react"

import { cn } from "../../lib/utils"
import { Button } from "./button"
import { useUIText } from "./ui-text"

type CopyStatus = "idle" | "copied" | "failed"

/** Clipboard write with the same behavior as the market's CopyButton:
    async Clipboard API first, hidden-textarea `execCommand` fallback for
    non-secure contexts / denied permission. Returns whether the copy worked. */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the execCommand fallback
    }
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "true")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch {
    return false
  }
}

export interface CopyButtonProps extends React.ComponentProps<typeof Button> {
  /** The text placed on the clipboard. */
  value: string
  /** Accessible label describing WHAT gets copied; defaults to "复制". */
  label?: string
  /** Feedback (icon + live announcement) reset delay in ms; default 2000. */
  resetDelay?: number
  /** Called with the outcome of every attempt (e.g. to raise a toast). */
  onCopyResult?: (ok: boolean) => void
}

/**
 * Icon button that copies `value` to the clipboard. Success flips the icon to
 * a check; failure is never silent (an X + a live announcement). The outcome
 * is announced through a `role="status"` (polite) sr-only region — swapping
 * `aria-label` would not be announced by screen readers and would thrash the
 * accessible name; the label stays the stable action description. Feedback
 * resets after `resetDelay` ms and the timer is cleared on unmount.
 */
function CopyButton({
  value,
  label,
  resetDelay = 2000,
  onCopyResult,
  variant = "ghost",
  size = "icon",
  className,
  onClick,
  ...props
}: CopyButtonProps) {
  const t = useUIText()
  const [status, setStatus] = React.useState<CopyStatus>("idle")
  const timerRef = React.useRef<number | undefined>(undefined)

  React.useEffect(() => () => window.clearTimeout(timerRef.current), [])

  async function handleCopy() {
    const ok = await copyText(value)
    window.clearTimeout(timerRef.current)
    setStatus(ok ? "copied" : "failed")
    timerRef.current = window.setTimeout(() => setStatus("idle"), resetDelay)
    onCopyResult?.(ok)
  }

  const copyLabel = label ?? t.clipboard.copy
  const feedback = status === "copied" ? t.clipboard.copied : status === "failed" ? t.clipboard.copyFailed : copyLabel

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        data-slot="copy-button"
        data-status={status}
        aria-label={copyLabel}
        title={feedback}
        onClick={(event) => {
          onClick?.(event)
          void handleCopy()
        }}
        className={cn("[&_svg]:size-3.5", className)}
        {...props}
      >
        {status === "copied" ? (
          <Check />
        ) : status === "failed" ? (
          <X className="text-destructive" />
        ) : (
          <Copy />
        )}
      </Button>
      <span role="status" className="sr-only">
        {status === "copied"
          ? t.clipboard.copiedLive
          : status === "failed"
            ? t.clipboard.copyFailedLive
            : ""}
      </span>
    </>
  )
}

export { CopyButton }

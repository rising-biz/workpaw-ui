import { Loader2Icon } from "lucide-react"

import { cn } from "../../lib/utils"
import { useUIText } from "./ui-text"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  // Default label from the shared copy dictionary; `aria-label` may still be
  // passed for a per-instance override (it spreads after the default).
  const { loading } = useUIText()
  return (
    <Loader2Icon
      role="status"
      aria-label={loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }

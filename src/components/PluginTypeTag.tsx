import { cn } from "../lib/utils";
import type { PluginType } from "../types/plugin";
import { useUIText } from "./ui/ui-text";

export function PluginTypeTag({ type, className }: { type: PluginType; className?: string }) {
  // 标签走 UIText 词典（I18N-01）：默认值与原 TYPE_LABEL 一致，未知类型回退 general。
  const t = useUIText();
  const label = t.pluginType[type] ?? t.pluginType.general;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

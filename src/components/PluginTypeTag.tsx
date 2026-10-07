import { cn } from "../lib/utils";
import type { PluginType } from "../types/plugin";

const TYPE_LABEL: Record<string, string> = {
  tool: "工具",
  provider: "模型接入",
  hook: "Hook",
  command: "命令",
  frontend: "UI 扩展",
  app: "应用",
  channel: "通道",
  memory: "记忆",
  general: "通用",
};

export function PluginTypeTag({ type, className }: { type: PluginType; className?: string }) {
  const label = TYPE_LABEL[type] ?? TYPE_LABEL.general;
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

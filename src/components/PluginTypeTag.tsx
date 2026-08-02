import { cn } from "../lib/utils";
import type { PluginType } from "../types/plugin";

const TYPE_META: Record<string, { label: string; className: string }> = {
  tool:      { label: "工具",     className: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  provider:  { label: "模型接入", className: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  hook:      { label: "Hook",     className: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  command:   { label: "命令",     className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" },
  frontend:  { label: "UI 扩展",  className: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400" },
  app:       { label: "应用",     className: "border-blue-600/30 bg-blue-600/10 text-blue-700 dark:text-blue-500" },
  channel:   { label: "通道",     className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  general:   { label: "通用",     className: "border-zinc-400/30 bg-zinc-400/10 text-zinc-600 dark:text-zinc-400" },
};

export function PluginTypeTag({ type, className }: { type: PluginType; className?: string }) {
  const meta = TYPE_META[type] ?? TYPE_META.general;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        meta.className,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

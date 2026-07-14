import { useTheme } from "./ThemeProvider";
import { useThemeVariantStore } from "./variantStore";
import { THEME_VARIANTS } from "./variants";
import { cn } from "../lib/utils";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

/**
 * ThemeSettings — shared appearance picker (self-contained: no workpaw-ui
 * component imports, so it survives source-consumption without the `@/` path
 * collision). Renders theme-variant cards (from the variants.ts registry) + a
 * light/dark/system mode control + a live swatch strip of the active tokens.
 *
 * v1 is Chinese-only (PRODUCT.md); strings live in the registry, not here. When
 * i18n is wired across all 3 apps, swap the registry's name/desc to a t() key.
 *
 * Mode (light/dark/system) → next-themes `useTheme`. Variant → `useThemeVariantStore`.
 */

const MODES = [
  { id: "light" as const, name: "浅色", Icon: Sun },
  { id: "dark" as const, name: "深色", Icon: Moon },
  { id: "system" as const, name: "跟随系统", Icon: Monitor },
];

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-10 w-full rounded-md border border-border"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="text-[0.625rem] text-muted-foreground">{label}</span>
    </div>
  );
}

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const variant = useThemeVariantStore((s) => s.variant);
  const setVariant = useThemeVariantStore((s) => s.setVariant);
  const activeMode = theme ?? "system";

  return (
    <div className="space-y-8">
      {/* Theme variant */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">主题</h2>
          <p className="text-xs text-muted-foreground">选择界面配色风格。三套主题共享相同的界面布局，各有独立的强调色与底色。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {THEME_VARIANTS.map((v) => {
            const selected = variant === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setVariant(v.id)}
                className={cn(
                  "group relative flex flex-col gap-3 rounded-xl border p-3 text-left",
                  "transition-[transform,background-color,border-color,box-shadow] duration-200 ease-[var(--ease-out-quart)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "active:scale-[0.99]",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:-translate-y-0.5 hover:bg-muted/50",
                )}
              >
                {/* Mini preview mock */}
                <div
                  className="flex h-16 items-center gap-2 rounded-md border p-2"
                  style={{
                    backgroundColor: v.preview.bg,
                    borderColor: v.preview.border,
                  }}
                >
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: v.preview.primary }}
                  />
                  <div
                    className="h-1.5 flex-1 rounded-sm"
                    style={{ backgroundColor: v.preview.fg, opacity: 0.8 }}
                  />
                  <div
                    className="h-1.5 w-6 rounded-sm"
                    style={{ backgroundColor: v.preview.fg, opacity: 0.4 }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{v.name}</span>
                  <AnimatePresence mode="wait" initial={false}>
                    {selected && (
                      <motion.span
                        key="check"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="text-primary"
                      >
                        <Check className="h-4 w-4" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <p className="text-xs text-muted-foreground">{v.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Mode (light / dark / system) */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">模式</h2>
          <p className="text-xs text-muted-foreground">跟随系统会按操作系统的深浅设置自动切换。</p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
          {MODES.map(({ id, name, Icon }) => {
            const selected = activeMode === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => setTheme(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Live token swatches — reads the ACTIVE tokens (reflects current choice) */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">当前色板</h2>
          <p className="text-xs text-muted-foreground">实时反映上方选择。</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Swatch label="背景" color="var(--background)" />
          <Swatch label="前景" color="var(--foreground)" />
          <Swatch label="主色" color="var(--primary)" />
          <Swatch label="次要文字" color="var(--muted-foreground)" />
          <Swatch label="边框" color="var(--border)" />
        </div>
      </section>
    </div>
  );
}

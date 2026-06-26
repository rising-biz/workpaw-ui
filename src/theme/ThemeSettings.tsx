import { useTheme } from "./ThemeProvider";
import {
  useThemeVariantStore,
  type ThemeVariant,
} from "./variantStore";
import { cn } from "../lib/utils";
import { Sun, Moon, Monitor, Check } from "lucide-react";

/**
 * ThemeSettings — shared appearance picker (self-contained: no workpaw-ui
 * component imports, so it survives source-consumption without the `@/` path
 * collision). Renders 3 theme-variant cards + a light/dark/system mode control
 * + a live swatch strip of the active tokens.
 *
 * v1 is Chinese-only (PRODUCT.md); strings are hardcoded here. When i18n is
 * wired across all 3 apps, swap to a prop/t() interface.
 *
 * Mode (light/dark/system) → next-themes `useTheme`. Variant → `useThemeVariantStore`.
 */

type VariantDef = {
  id: ThemeVariant;
  name: string;
  desc: string;
  /** Light-mode preview swatches (oklch) so the card previews the variant
   * regardless of the currently active theme. */
  preview: { bg: string; fg: string; primary: string; border: string };
};

const VARIANTS: VariantDef[] = [
  {
    id: "standard",
    name: "标准",
    desc: "默认精密控制台,纯白底与墨黑字,克制中性。",
    preview: {
      bg: "oklch(1 0 0)",
      fg: "oklch(0.145 0 0)",
      primary: "oklch(0.715 0.183 49.77)",
      border: "oklch(0.922 0 0)",
    },
  },
  {
    id: "ember",
    name: "暮光琥珀",
    desc: "暖焦糖炭底,橙色融成余烬,深夜暖灯沉浸感。",
    preview: {
      bg: "oklch(0.22 0.038 55)",
      fg: "oklch(0.94 0.022 65)",
      primary: "oklch(0.715 0.183 49.77)",
      border: "oklch(0.95 0.022 60 / 14%)",
    },
  },
  {
    id: "abyss",
    name: "墨青深渊",
    desc: "深墨青冷底,橙成信号灯,午夜深海精密感。",
    preview: {
      bg: "oklch(0.19 0.042 238)",
      fg: "oklch(0.94 0.016 225)",
      primary: "oklch(0.715 0.183 49.77)",
      border: "oklch(0.95 0.016 225 / 14%)",
    },
  },
  {
    id: "verdant",
    name: "翡翠",
    desc: "深翡翠绿底,橙成秋叶点睛,沉静深林不疲劳。",
    preview: {
      bg: "oklch(0.20 0.042 158)",
      fg: "oklch(0.94 0.020 155)",
      primary: "oklch(0.715 0.183 49.77)",
      border: "oklch(0.95 0.020 155 / 14%)",
    },
  },
];

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
          <p className="text-xs text-muted-foreground">选择界面配色,每套主题有独立的色温与氛围。橙色品牌色贯穿所有主题。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {VARIANTS.map((v) => {
            const selected = variant === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setVariant(v.id)}
                className={cn(
                  "group relative flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:bg-muted/50",
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
                  {selected && <Check className="h-4 w-4 text-primary" />}
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

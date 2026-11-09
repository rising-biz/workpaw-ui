import { useRef, type CSSProperties, type KeyboardEvent, type RefCallback } from "react";
import { useTheme } from "./ThemeProvider";
import { useThemeVariantStore } from "./variantStore";
import { THEME_VARIANTS } from "./variants";
import { cn } from "../lib/utils";
import { useUIText } from "../components/ui/ui-text";
import { Sun, Moon, Monitor, Check } from "lucide-react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";

/**
 * ThemeSettings — shared appearance picker (self-contained: no workpaw-ui
 * component imports beyond the dependency-free UIText dictionary, so it
 * survives source-consumption without the `@/` path collision). Renders
 * theme-variant cards (from the variants.ts registry) + a light/dark/system
 * mode control + a live swatch strip of the active tokens.
 *
 * v1 is Chinese-only (PRODUCT.md); chrome copy lives in the UIText dictionary
 * (`defaultUIText.themeSettings`, I18N-01), variant name/desc remain registry
 * data. When i18n is wired across all 3 apps, swap the registry's name/desc to
 * a t() key.
 *
 * Mode (light/dark/system) → next-themes `useTheme`. Variant → `useThemeVariantStore`.
 *
 * A11Y-06 动效偏好门控：本组件顶层包 `<MotionConfig reducedMotion="user">`，
 * prefers-reduced-motion 用户自动跳过内部 spring 动画。消费端应用建议在自己的
 * 组件根同样包一层，覆盖其余 motion 动效。
 */

const MODES = [
  { id: "light" as const, labelKey: "modeLight" as const, Icon: Sun },
  { id: "dark" as const, labelKey: "modeDark" as const, Icon: Moon },
  { id: "system" as const, labelKey: "modeSystem" as const, Icon: Monitor },
];

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-10 w-full rounded-md border border-border bg-(--swatch)"
        style={{ "--swatch": color } as CSSProperties}
        aria-hidden
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * WAI-ARIA radio group keyboard pattern for the two single-select groups:
 * roving tabindex (only the checked item is tabbable) + Arrow/Home/End moving
 * both selection and focus — selection follows focus, as with native radios.
 */
function useRadioGroup(activeIndex: number, onSelectIndex: (index: number) => void) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = itemRefs.current.length;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (activeIndex + 1) % count;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (activeIndex - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelectIndex(next);
    itemRefs.current[next]?.focus();
  };
  const setItemRef = (index: number): RefCallback<HTMLButtonElement> => (node) => {
    itemRefs.current[index] = node;
  };
  return { onKeyDown, setItemRef };
}

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();
  const variant = useThemeVariantStore((s) => s.variant);
  const setVariant = useThemeVariantStore((s) => s.setVariant);
  const ts = useUIText().themeSettings;
  const activeMode = theme ?? "system";

  const activeVariantIndex = Math.max(
    0,
    THEME_VARIANTS.findIndex((v) => v.id === variant),
  );
  const variantRadio = useRadioGroup(activeVariantIndex, (i) => {
    const next = THEME_VARIANTS[i];
    if (next) setVariant(next.id);
  });
  const activeModeIndex = Math.max(0, MODES.findIndex((m) => m.id === activeMode));
  const modeRadio = useRadioGroup(activeModeIndex, (i) => {
    const next = MODES[i];
    if (next) setTheme(next.id);
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-8">
        {/* Theme variant */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{ts.variantTitle}</h2>
            <p className="text-xs text-muted-foreground">{ts.variantDescription}</p>
          </div>
          {/* 单选语义（P3-4）：role=radiogroup + aria-checked，读屏上报「第 x / 共 5 项
              已选中」，而不是五个独立开关；网格 5 张卡在 lg 一行、sm 两列，不再
              出现末行 2 张孤卡。 */}
          <div
            role="radiogroup"
            aria-label={ts.variantGroupLabel}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
            onKeyDown={variantRadio.onKeyDown}
          >
          {THEME_VARIANTS.map((v, i) => {
            const selected = variant === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                ref={variantRadio.setItemRef(i)}
                onClick={() => setVariant(v.id)}
                className={cn(
                  "group relative flex flex-col gap-3 rounded-xl border p-3 text-left",
                  "transition duration-200 ease-(--ease-out-quart)",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "active:scale-[0.99]",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:-translate-y-0.5 hover:bg-muted/50",
                )}
              >
                {/* Mini preview mock */}
                <div
                  className="flex h-16 items-center gap-2 rounded-md border border-(--preview-border) bg-(--preview-bg) p-2"
                  style={
                    {
                      "--preview-bg": v.preview.bg,
                      "--preview-border": v.preview.border,
                      "--preview-primary": v.preview.primary,
                      "--preview-fg": v.preview.fg,
                    } as CSSProperties
                  }
                >
                  <div className="h-2.5 w-2.5 rounded-sm bg-(--preview-primary)" />
                  <div className="h-1.5 flex-1 rounded-sm bg-(--preview-fg) opacity-80" />
                  <div className="h-1.5 w-6 rounded-sm bg-(--preview-fg) opacity-40" />
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
          <h2 className="text-sm font-semibold text-foreground">{ts.modeTitle}</h2>
          <p className="text-xs text-muted-foreground">{ts.modeDescription}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={ts.modeGroupLabel}
          className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
          onKeyDown={modeRadio.onKeyDown}
        >
          {MODES.map(({ id, labelKey, Icon }, i) => {
            const selected = activeMode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                ref={modeRadio.setItemRef(i)}
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
                {ts[labelKey]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Live token swatches — reads the ACTIVE tokens (reflects current choice) */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{ts.paletteTitle}</h2>
          <p className="text-xs text-muted-foreground">{ts.paletteDescription}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Swatch label={ts.swatchBackground} color="var(--background)" />
          <Swatch label={ts.swatchForeground} color="var(--foreground)" />
          <Swatch label={ts.swatchPrimary} color="var(--primary)" />
          <Swatch label={ts.swatchMutedForeground} color="var(--muted-foreground)" />
          <Swatch label={ts.swatchBorder} color="var(--border)" />
        </div>
      </section>
      </div>
    </MotionConfig>
  );
}

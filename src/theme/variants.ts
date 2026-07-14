/**
 * Theme variant registry — the SINGLE source of truth for which theme
 * variants exist. To add a theme:
 *   1. Add its id to the `ThemeVariant` union and a `VariantMeta` entry below.
 *   2. Add its token block to `workpaw-ui/src/styles/theme.css` under
 *      `:root[data-theme="<id>"]` (+ `.dark` counterpart).
 *   3. Add its id to the no-flash guard in each app's `index.html`.
 *
 * Everything else (the variant store, the picker UIs, the type checks) derives
 * from this file. Do not enumerate variant ids anywhere else.
 *
 * Four themes migrated from HiOps Design System:
 *   Verdant (翠微, default), Indigo (夜靛), Amber (墨金), Amethyst (紫微).
 * Each is a complete light + dark system. Verdant green carries ~25% of
 * interactive surface — committed strategy, not scarcity.
 */

export type ThemeVariant = "verdant" | "indigo" | "amber" | "amethyst";

export interface VariantMeta {
  id: ThemeVariant;
  /** Display name shown in pickers. v1 is Chinese-only (PRODUCT.md). */
  name: string;
  /** One-line description of the variant's personality. */
  desc: string;
  /** Static preview swatches so the picker card previews the variant
   * regardless of the currently active mode. These mirror theme.css values. */
  preview: { bg: string; fg: string; primary: string; border: string };
}

/**
 * The default variant applied when no valid choice is persisted. Verdant is
 * the out-of-the-box theme; the no-flash inline script in each app's index.html
 * MUST default to the same value to avoid a flash on reload.
 */
export const DEFAULT_THEME_VARIANT: ThemeVariant = "verdant";

export const THEME_VARIANTS: readonly VariantMeta[] = [
  {
    id: "verdant",
    name: "翠微",
    desc: "深翠绿强调 + 微绿中性色。品牌默认，自然、信赖、专业，控制塔级精密质感。",
    preview: {
      bg: "oklch(0.985 0.004 155)",
      fg: "oklch(0.12 0.02 155)",
      primary: "oklch(0.50 0.22 158)",
      border: "oklch(0.88 0.012 155)",
    },
  },
  {
    id: "indigo",
    name: "夜靛",
    desc: "深邃靛蓝 + 冷调中性色。冷静、权威、如精密仪器，适合专注操作场景。",
    preview: {
      bg: "oklch(0.985 0.005 260)",
      fg: "oklch(0.13 0.03 262)",
      primary: "oklch(0.48 0.24 262)",
      border: "oklch(0.88 0.012 262)",
    },
  },
  {
    id: "amber",
    name: "墨金",
    desc: "温暖琥珀金 + 暖调中性色。独特、珍贵、一眼可辨，最温暖的运维配色。",
    preview: {
      bg: "oklch(0.985 0.005 85)",
      fg: "oklch(0.13 0.02 85)",
      primary: "oklch(0.54 0.22 62)",
      border: "oklch(0.88 0.012 85)",
    },
  },
  {
    id: "amethyst",
    name: "紫微",
    desc: "紫罗兰强调 + 微紫中性色。创意、能量、大胆，为数据密集视图注入活力。",
    preview: {
      bg: "oklch(0.985 0.006 290)",
      fg: "oklch(0.13 0.03 290)",
      primary: "oklch(0.50 0.24 290)",
      border: "oklch(0.88 0.014 290)",
    },
  },
];

/** Derive the valid id list from the registry; never hardcode it elsewhere. */
export const THEME_VARIANT_IDS: readonly ThemeVariant[] = THEME_VARIANTS.map(
  (v) => v.id,
);

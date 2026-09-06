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
 * Five themes: Indigo (夜靛, default), Verdant (翠微), Amber (墨金),
 * Amethyst (紫微), WorkBuddy (墨白).
 * Each is a complete light + dark system. Indigo is the brand anchor
 * (PRODUCT.md / DESIGN.md); the primary color carries ~20-25% of interactive
 * surface — committed strategy, not scarcity.
 */

export type ThemeVariant = "verdant" | "indigo" | "amber" | "amethyst" | "workbuddy";

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
 * The default variant applied when no valid choice is persisted. Indigo (夜靛)
 * is the out-of-the-box theme — the brand anchor per PRODUCT.md / DESIGN.md.
 * The no-flash inline script in each app's index.html MUST default to the same
 * value to avoid a flash on reload.
 *
 * NOTE: indigo is applied via `data-theme="indigo"`; only "verdant" maps to the
 * bare `:root` (no attribute). ThemeApplier + the no-flash scripts handle this.
 */
export const DEFAULT_THEME_VARIANT: ThemeVariant = "indigo";

export const THEME_VARIANTS: readonly VariantMeta[] = [
  {
    id: "indigo",
    name: "夜靛",
    desc: "电光靛蓝 + 冷峻层次。精准、权威、专注，在高密度工作流中保持清晰锋芒。",
    preview: {
      bg: "oklch(0.965 0.012 265)",
      fg: "oklch(0.20 0.035 265)",
      primary: "oklch(0.52 0.27 264)",
      border: "oklch(0.840 0.030 265)",
    },
  },
  {
    id: "verdant",
    name: "翠微",
    desc: "青翠翡翠 + 清透中性色。可信、敏捷、生命力充沛，并与成功状态保持明确区分。",
    preview: {
      bg: "oklch(0.965 0.012 160)",
      fg: "oklch(0.20 0.030 160)",
      primary: "oklch(0.50 0.20 165)",
      border: "oklch(0.840 0.026 160)",
    },
  },
  {
    id: "amber",
    name: "墨金",
    desc: "矿物金 + 温润墨色。高级、稳健、辨识度强，以金色品牌感避开橙色警告语义。",
    preview: {
      bg: "oklch(0.970 0.016 82)",
      fg: "oklch(0.20 0.025 78)",
      primary: "oklch(0.56 0.15 72)",
      border: "oklch(0.850 0.032 80)",
    },
  },
  {
    id: "amethyst",
    name: "紫微",
    desc: "高能紫晶 + 冷调层次。大胆、创造、富有未来感，让数据密集界面鲜亮而不躁。",
    preview: {
      bg: "oklch(0.965 0.014 294)",
      fg: "oklch(0.20 0.040 294)",
      primary: "oklch(0.54 0.27 296)",
      border: "oklch(0.840 0.032 294)",
    },
  },
  {
    id: "workbuddy",
    name: "墨白",
    desc: "墨色主按钮 + 纯白纸面。克制、干净、办公感，界面不靠彩色品牌色说话。",
    preview: {
      bg: "oklch(0.985 0 0)",
      fg: "oklch(0.18 0 0)",
      primary: "oklch(0.22 0 0)",
      border: "oklch(0.860 0 0)",
    },
  },
];

/** Derive the valid id list from the registry; never hardcode it elsewhere. */
export const THEME_VARIANT_IDS: readonly ThemeVariant[] = THEME_VARIANTS.map(
  (v) => v.id,
);

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
 * `--primary` (brand green) is constant across all variants and lives on the
 * base `:root` in theme.css — variants here only describe the neutral/surface
 * personality, never the primary. Mode (light/dark/system) is a separate axis
 * owned by next-themes, not represented here.
 */

export type ThemeVariant = "standard" | "supabase";

export interface VariantMeta {
  id: ThemeVariant;
  /** Display name shown in pickers. v1 is Chinese-only (PRODUCT.md). */
  name: string;
  /** One-line description of the variant's personality. */
  desc: string;
  /** Static preview swatches (dark-mode oklch tokens) so the picker card
   * previews the variant regardless of the currently active mode. These mirror
   * theme.css values; update both together. */
  preview: { bg: string; fg: string; primary: string; border: string };
}

/**
 * The default variant applied when no valid choice is persisted. Supabase is
 * the out-of-the-box theme; the no-flash inline script in each app's index.html
 * MUST default to the same value to avoid a flash on reload.
 */
export const DEFAULT_THEME_VARIANT: ThemeVariant = "supabase";

export const THEME_VARIANTS: readonly VariantMeta[] = [
  {
    id: "supabase",
    name: "Supabase",
    desc: "默认主题。标志性炭灰底配品牌绿,冷调开发者工具观感。",
    preview: {
      bg: "oklch(0.21 0.004 264)",
      fg: "oklch(0.93 0.004 264)",
      primary: "oklch(0.78 0.16 162)",
      border: "oklch(0.93 0.004 264 / 12%)",
    },
  },
  {
    id: "standard",
    name: "标准",
    desc: "纯白底配品牌绿,克制中性,精密控制台本色。",
    preview: {
      bg: "oklch(1 0 0)",
      fg: "oklch(0.145 0 0)",
      primary: "oklch(0.78 0.16 162)",
      border: "oklch(0.922 0 0)",
    },
  },
];

/** Derive the valid id list from the registry; never hardcode it elsewhere. */
export const THEME_VARIANT_IDS: readonly ThemeVariant[] = THEME_VARIANTS.map(
  (v) => v.id,
);

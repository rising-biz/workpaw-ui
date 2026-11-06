/*
 * WorkPaw no-flash theme guard — the SINGLE source for the inline script that
 * pre-applies the persisted theme (variant + light/dark mode) before first
 * paint. Consumers should use THIS script instead of hand-rolling one per app:
 *
 *   - Inline it at build time (read the file, embed it in index.html <head>),
 *     or serve it and reference it synchronously via the standard script tag
 *     pointing at "workpaw-ui/theme-init.js" (see package.json exports).
 *
 * NEVER write a literal closing-script tag anywhere in this file, even inside
 * comments: apps inline the file verbatim into a script block in index.html,
 * and the HTML parser ends the block at the first closing tag it sees.
 *
 * Contract (mirrors src/theme/variants.ts + src/styles/theme.css):
 *   - DEFAULT variant = bare `:root` (NO data-theme attribute).
 *   - Every other variant = `data-theme="<id>"` on <html>.
 *   - Mode: next-themes' `theme` key → `.dark` class (light/dark/system).
 * When adding a theme variant: register it in variants.ts + theme.css AND
 * append it to the ALLOWLIST below (scripts/check-theme-contracts.mjs fails
 * lint if the two lists drift).
 */
(function () {
  try {
    // Keep in sync with THEME_VARIANT_IDS / DEFAULT_THEME_VARIANT in
    // workpaw-ui/src/theme/variants.ts.
    var ALLOWLIST = ["verdant", "indigo", "amber", "amethyst", "workbuddy"];
    var DEFAULT_VARIANT = "indigo";
    var STORAGE_KEY = "workpaw-theme-variant";

    var mode = localStorage.getItem("theme");
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (mode === "dark" || ((!mode || mode === "system") && systemDark)) {
      document.documentElement.classList.add("dark");
    }

    var variant = localStorage.getItem(STORAGE_KEY);
    if (ALLOWLIST.indexOf(variant) === -1) variant = DEFAULT_VARIANT;
    if (variant !== DEFAULT_VARIANT) {
      document.documentElement.setAttribute("data-theme", variant);
    }
  } catch {
    // Storage may be unavailable in hardened browser contexts; use defaults.
  }
})();

/*
 * Theme contract check — keeps the duplicated knowledge about theme variants
 * in sync across the surfaces that must agree:
 *
 *   1. src/theme/variants.ts        registry (THEME_VARIANT_IDS + DEFAULT)
 *   2. src/theme-init.js            no-flash guard allowlist + default
 *   3. src/styles/theme.css         one token block per non-default variant;
 *                                   the DEFAULT variant IS the bare `:root`
 *   4. DESIGN.md                    documents every variant id
 *
 * If any of these drift (e.g. a new theme added to the registry but not to the
 * no-flash guard), first paint falls back to the wrong palette or a variant
 * renders with missing tokens. Run via `pnpm lint`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL  ${msg}`);
};
const ok = (msg) => console.log(`ok    ${msg}`);

// --- registry --------------------------------------------------------------
const variantsTs = read("src/theme/variants.ts");
const unionMatch = variantsTs.match(
  /export type ThemeVariant =([\s\S]*?);/
);
const registered = unionMatch
  ? [...unionMatch[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1])
  : [];
if (registered.length === 0) fail("could not parse ThemeVariant union in src/theme/variants.ts");
else ok(`registry variants: ${registered.join(", ")}`);

const defaultMatch = variantsTs.match(
  /export const DEFAULT_THEME_VARIANT: ThemeVariant = "([a-z-]+)"/
);
if (!defaultMatch) fail("could not parse DEFAULT_THEME_VARIANT in src/theme/variants.ts");
const defaultVariant = defaultMatch?.[1];
if (defaultVariant && !registered.includes(defaultVariant)) {
  fail(`DEFAULT_THEME_VARIANT "${defaultVariant}" is not in the ThemeVariant union`);
} else if (defaultVariant) {
  ok(`default variant: ${defaultVariant}`);
}

// --- no-flash guard --------------------------------------------------------
const guard = read("src/theme-init.js");
const allowMatch = guard.match(/var ALLOWLIST = \[([^\]]*)\]/);
const allowlist = allowMatch
  ? [...allowMatch[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1])
  : [];
if (allowlist.length === 0) fail("could not parse ALLOWLIST in src/theme-init.js");

const guardDefault = guard.match(/var DEFAULT_VARIANT = "([a-z-]+)"/)?.[1];
if (!guardDefault) fail("could not parse DEFAULT_VARIANT in src/theme-init.js");

const sameSet =
  allowlist.length === registered.length &&
  registered.every((id) => allowlist.includes(id));
if (!sameSet) {
  fail(
    `theme-init.js ALLOWLIST [${allowlist.join(", ")}] != registry [${registered.join(", ")}]`
  );
} else ok("theme-init.js ALLOWLIST matches the registry");

if (guardDefault !== defaultVariant) {
  fail(`theme-init.js DEFAULT_VARIANT "${guardDefault}" != DEFAULT_THEME_VARIANT "${defaultVariant}"`);
} else ok("theme-init.js DEFAULT_VARIANT matches the registry");

// --- theme.css token blocks ------------------------------------------------
const css = read("src/styles/theme.css").replace(/\/\*[\s\S]*?\*\//g, "");
for (const id of registered) {
  const hasBlock = css.includes(`:root[data-theme="${id}"]`);
  if (id === defaultVariant) {
    // The default variant IS the bare :root — ThemeApplier removes the
    // attribute for it, so an explicit block would be dead code (and the
    // P1-2 contract: first paint needs no attribute at all).
    if (hasBlock) fail(`default variant "${id}" must NOT have an explicit data-theme block`);
    else ok(`default variant "${id}" uses the bare :root (no data-theme block)`);
  } else if (!hasBlock) {
    fail(`missing theme.css block for variant "${id}"`);
  } else {
    ok(`theme.css block present for "${id}"`);
  }
}

// --- documentation ---------------------------------------------------------
const design = read("DESIGN.md");
for (const id of registered) {
  if (!design.includes(id)) fail(`DESIGN.md does not document variant "${id}"`);
  else ok(`DESIGN.md documents "${id}"`);
}

// --- inline-safety --------------------------------------------------------
// theme-init.js is inlined verbatim into index.html script blocks by the
// consuming apps' vite plugins. A literal closing-script tag ANYWHERE in the
// file (even inside a comment) ends the HTML script block early: the guard
// silently never runs and the rest leaks as visible page text.
const themeInit = read("src/theme-init.js");
if (themeInit.includes("</script>")) {
  fail("theme-init.js contains a literal closing script tag — it would truncate the inlined guard in index.html");
} else {
  ok("theme-init.js is safe to inline (no literal closing script tag)");
}

if (failures > 0) {
  console.error(`\ncheck-theme-contracts: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-theme-contracts: all contracts hold");

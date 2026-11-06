/*
 * Empirical Tailwind v4 contract check for src/styles/theme.css.
 *
 * The library owns a Tailwind "preset-lite" mapping layer inside theme.css
 * (@source "../", @custom-variant dark, @theme inline). Consumers get it by
 * importing "workpaw-ui/theme.css" — but Tailwind only honors those directives
 * inside imported files if the whole chain compiles correctly. This script
 * COMPILES the real theme.css with the real Tailwind v4 compiler
 * (@tailwindcss/node, same engine as @tailwindcss/vite) and asserts the
 * emitted CSS: utilities resolve to the right tokens, the dark variant works,
 * and library component classes are scanned via @source.
 *
 * This is the guard against regressions like "mapping added to theme.css but
 * the utility never renders in consumers" (the dead-token class of bug fixed
 * in the 2026-11 code review for --overlay / --skeleton-* / state-*).
 *
 * Run via `pnpm lint` (or directly: node scripts/check-tailwind-preset.mjs).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const themeCssPath = path.join(root, "src/styles/theme.css");

let failures = 0;
function check(name, re, css) {
  if (!re.test(css)) {
    failures += 1;
    console.error(`FAIL  ${name}`);
  } else {
    console.log(`ok    ${name}`);
  }
}
function checkIncludes(name, needle, css) {
  if (!css.includes(needle)) {
    failures += 1;
    console.error(`FAIL  ${name}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Compile the real theme.css (with tailwindcss imported ahead of it, the
//    same order consumers use). Base = the css file's dir so @source "../"
//    resolves exactly as in production.
// ---------------------------------------------------------------------------
const harnessCss = '@import "tailwindcss";\n' + readFileSync(themeCssPath, "utf8");
const base = pathToFileURL(path.join(root, "src/styles/"));
const compiler = await compile(harnessCss, {
  base,
  onDependency: () => {},
  async loadStylesheet(id, stylesheetBase) {
    if (id === "tailwindcss") {
      const p = path.join(root, "node_modules/tailwindcss/tailwind.css");
      return { content: readFileSync(p, "utf8"), base: pathToFileURL(path.dirname(p)) };
    }
    const p = new URL(id, stylesheetBase);
    return { content: readFileSync(p, "utf8"), base: p };
  },
});

// ---------------------------------------------------------------------------
// 2. Scan candidates EXACTLY like @tailwindcss/vite does: the compiler derives
//    the scan roots from the css itself (default root + every @source), so
//    theme.css's `@source "../"` must show up here — that is the mechanism
//    that makes library component classes render inside consumers.
// ---------------------------------------------------------------------------
const asEntry = (entry, fallbackBase) =>
  entry === null
    ? { base: fallbackBase, pattern: "**/*", negated: false }
    : {
        base: entry.base instanceof URL ? fileURLToPath(entry.base) : entry.base,
        pattern: entry.pattern,
        negated: false,
      };
const defaultRoot =
  compiler.root === "none"
    ? []
    : [asEntry(compiler.root, path.join(root, "src/styles"))];
const scanner = new Scanner({
  sources: defaultRoot.concat(
    (compiler.sources ?? []).map((e) => asEntry(e, path.join(root, "src/styles")))
  ),
});
const candidates = [...new Set(scanner.scan())];
if (candidates.length === 0) {
  console.error("FAIL  candidate scan returned zero candidates");
  process.exit(1);
}
const sourceResolves = (compiler.sources ?? []).some((e) => {
  const b = e.base instanceof URL ? fileURLToPath(e.base) : e.base;
  return path.resolve(b, e.pattern ?? "./") === path.join(root, "src");
});
if (!sourceResolves) {
  failures += 1;
  console.error('FAIL  @source "../" registered the library source dir (src/)');
} else {
  console.log('ok    @source "../" registered the library source dir (src/)');
}
// These literals appear in src/components/ui/* — prove the scan covers them.
for (const c of ["bg-primary", "bg-(--overlay)", "bg-(--skeleton-base)", "bg-state-success-surface"]) {
  if (!candidates.includes(c)) {
    failures += 1;
    console.error(`FAIL  candidate scanned from library source: ${c}`);
  } else {
    console.log(`ok    candidate scanned from library source: ${c}`);
  }
}

const css = compiler.build(candidates);

// ---------------------------------------------------------------------------
// 3. Assert the emitted contract. Note @theme inline INLINES the var reference
//    into each utility (`.bg-primary` → `var(--primary)`, no intermediate
//    `--color-primary` variable) — that is what makes per-theme :root values
//    cascade correctly.
// ---------------------------------------------------------------------------
check("@theme inline color map present (.bg-primary → var(--primary))", /\.bg-primary\s*\{[^}]*background-color:\s*var\(--primary\)/, css);
check(".text-muted-foreground → var(--muted-foreground)", /\.text-muted-foreground\s*\{[^}]*color:\s*var\(--muted-foreground\)/, css);

// state-* tokens (Badge/Alert success|warning|info variants)
check(".bg-state-success-surface → var(--state-success-surface)", /\.bg-state-success-surface\s*\{[^}]*background-color:\s*var\(--state-success-surface\)/, css);
check(".border-state-warning-border → var(--state-warning-border)", /\.border-state-warning-border\s*\{[^}]*border-color:\s*var\(--state-warning-border\)/, css);

// radius: shadcn v4 upstream additive formula around --radius
check(".rounded-sm → calc(var(--radius) - 4px)", /\.rounded-sm\s*\{[^}]*border-radius:\s*calc\(var\(--radius\)\s*-\s*4px\)/, css);
check(".rounded-xl → calc(var(--radius) + 4px)", /\.rounded-xl\s*\{[^}]*border-radius:\s*calc\(var\(--radius\)\s*\+\s*4px\)/, css);

// elevation: our @theme inline shadow mapping (NOT tailwind's static default)
check("@theme shadow map emitted (--shadow-sm: var(--shadow-sm))", /--shadow-sm:\s*var\(--shadow-sm\)/, css);
check(".shadow-sm utility → var(--shadow-sm)", /\.shadow-sm\s*\{[^}]*--tw-shadow:\s*var\(--shadow-sm\)/, css);
check(".shadow-lg utility → var(--shadow-lg)", /\.shadow-lg\s*\{[^}]*--tw-shadow:\s*var\(--shadow-lg\)/, css);

// dark variant declared inside an imported file still works
checkIncludes(
  "dark: variant emitted (.dark\\:bg-input/30:is(.dark *))",
  ".dark\\:bg-input\\/30:is(.dark *)",
  css
);

// arbitrary-value utilities referencing runtime tokens (overlay / skeleton)
checkIncludes(".bg-\\(--overlay\\) emitted", ".bg-\\(--overlay\\) {", css);
check(
  ".bg-\\(--overlay\\) → background-color: var(--overlay)",
  /\.bg-\\\(--overlay\\\)\s*\{[^}]*background-color:\s*var\(--overlay\)/,
  css
);
checkIncludes(".bg-\\(--skeleton-base\\) emitted", ".bg-\\(--skeleton-base\\) {", css);
check(
  ".bg-\\(--skeleton-base\\) → background-color: var(--skeleton-base)",
  /\.bg-\\\(--skeleton-base\\\)\s*\{[^}]*background-color:\s*var\(--skeleton-base\)/,
  css
);

// unlayered :root keeps winning over any @layer theme emission of the same
// name (the pattern that makes `--shadow-sm: var(--shadow-sm)` safe)
check(":root constants survive unlayered (outside @layer)", /--overlay:\s*oklch\(0 0 0 \/ 0\.5\)/, css);

if (failures > 0) {
  console.error(`\ncheck-tailwind-preset: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-tailwind-preset: all assertions passed");

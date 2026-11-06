#!/usr/bin/env node
/**
 * WCAG 2.1 AA contrast regression gate for the WorkPaw theme token matrix.
 *
 * Parses src/styles/theme.css (token values) + src/theme/variants.ts (variant
 * registry / default) directly, resolves var() and color-mix(in oklch, …)
 * derivations, converts OKLCH → linear sRGB → relative luminance and checks a
 * fixed matrix of foreground/background pairs per theme × mode.
 *
 * Matrix contract (fails lint on any pair < 4.5:1):
 *   - foreground / card-foreground / muted-foreground / sidebar-foreground /
 *     secondary-foreground / accent-foreground  on their own surfaces
 *   - muted-foreground on background, card, secondary, sidebar  (P1-1: card is
 *     BRIGHTER than background in dark mode — background-only checks lie)
 *   - primary-foreground on primary + primary-hover (button labels)
 *   - destructive-foreground on destructive
 *   - success / warning / info / destructive as text on background, card
 *     (P2-5: --warning must stay readable as `text-warning`)
 *   - state-{success,warning,destructive,info}-foreground on their
 *     color-mix'd surfaces (Alert/Badge state variants)
 *
 * Usage: node scripts/check-contrast.mjs   (wired into `pnpm lint`)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THEME_CSS = join(ROOT, "src/styles/theme.css");
const VARIANTS_TS = join(ROOT, "src/theme/variants.ts");

/* ---------------------------------------------------------------- OKLCH math */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

const oklchToLinearSrgb = (L, C, hDeg) => {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const parseOklch = (str) => {
  const m = str.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/,
  );
  if (!m) return null;
  const pct = (v) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
  const alpha =
    m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { L: pct(m[1]), C: pct(m[2]), h: parseFloat(m[3]), alpha };
};

const TRANSPARENT = { L: 0, C: 0, h: 0, alpha: 0 };

/** CSS color-mix(in oklch, A w1, B w2) with shortest-hue interpolation. */
const mixOklch = (c1, w1, c2, w2) => {
  const total = w1 + w2 || 1;
  const lerp = (x, y) => (x * w1 + y * w2) / total;
  let delta = Math.abs(c1.h - c2.h) % 360;
  const sign = delta > 180 ? -1 : 1;
  if (delta > 180) delta = 360 - delta;
  const base = c1.h <= c2.h ? c1.h : c2.h;
  return {
    L: lerp(c1.L, c2.L),
    C: lerp(c1.C, c2.C),
    h: (base + (sign * delta * Math.min(w1, w2)) / total + 360) % 360,
    alpha: lerp(c1.alpha, c2.alpha),
  };
};

const luminance = (c) => {
  const [r, g, b] = oklchToLinearSrgb(c.L, c.C, c.h).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio; translucent fg is composited over the bg first. */
const contrast = (fg, bg) => {
  const top =
    fg.alpha >= 1 ? fg : mixOklch(fg, fg.alpha, bg, 1 - fg.alpha);
  const l1 = luminance(top);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};

const hexOf = (c) => {
  if (!c) return "—";
  const enc = (v) => {
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(clamp01(s) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  const [r, g, b] = oklchToLinearSrgb(c.L, c.C, c.h).map(clamp01);
  return `#${enc(r)}${enc(g)}${enc(b)}`;
};

/* ------------------------------------------------- converter self-test ---- */

// Anchor the OKLCH→sRGB conversion against hand-verified exact conversions
// (CSS named colors; the oklch sources below were derived from the sRGB hex
// via the CSS Color 4 pipeline and round-trip), so a regression in the math
// cannot silently re-rank the matrix.
const SELF_TEST_ANCHORS = [
  ["oklch(1 0 0)", "#ffffff"],
  ["oklch(0 0 0)", "#000000"],
  ["oklch(0.5999 0 0)", "#808080"], // achromatic: Y = L³
  ["oklch(0.63682 0.20778 25.31)", "#ef4444"], // red-500 hex, exact round-trip
  ["oklch(0.62787 0.25778 29.23)", "#ff0000"], // pure red
];
for (const [source, expected] of SELF_TEST_ANCHORS) {
  const actual = hexOf(parseOklch(source));
  const a = actual.slice(1).match(/../g).map((h) => parseInt(h, 16));
  const e = expected.slice(1).match(/../g).map((h) => parseInt(h, 16));
  const drift = Math.max(...a.map((v, i) => Math.abs(v - e[i])));
  if (drift > 2) {
    console.error(
      `check-contrast: converter self-test FAILED — ${source} → ${actual}, expected ${expected}`,
    );
    process.exit(2);
  }
}

/* ------------------------------------------------------- theme.css ingestion */

const css = readFileSync(THEME_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const variantsTs = readFileSync(VARIANTS_TS, "utf8");

const DEFAULT_VARIANT = variantsTs.match(
  /DEFAULT_THEME_VARIANT: ThemeVariant = "([a-z-]+)"/,
)?.[1];
const VARIANTS = [...variantsTs.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);

if (!DEFAULT_VARIANT || VARIANTS.length === 0) {
  console.error("check-contrast: cannot parse the variant registry");
  process.exit(2);
}

/** Parse `selector { --token: value; … }` blocks (flat custom props only). */
const parseBlocks = (text) => {
  const blocks = [];
  const re = /(^|\n)\s*([^{}\n@][^{}]*?)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const selector = m[2].trim().replace(/\s+/g, " ");
    const tokens = {};
    const tokenRe = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let t;
    while ((t = tokenRe.exec(m[3]))) tokens[t[1]] = t[2].trim();
    if (Object.keys(tokens).length) blocks.push({ selector, tokens });
  }
  return blocks;
};

const allBlocks = parseBlocks(css);

/**
 * Effective token map for one variant × mode. Non-default variants layer
 * `:root[data-theme="<id>"]` on top of the shared `:root` constants; the
 * default variant IS the bare `:root` palette (attribute may also be set
 * explicitly, which resolves to the same values).
 */
const tokensFor = (variant, dark) => {
  const suffix = dark ? ".dark" : "";
  const merged = {};
  const take = (match) => {
    for (const b of allBlocks) if (match(b.selector)) Object.assign(merged, b.tokens);
  };
  // 1. shared constants (incl. @supports color-mix derivations)
  take((s) => s === ":root");
  // 2. mode-specific shared overrides (`.dark` never applies in light mode)
  if (dark) take((s) => s === ":root.dark");
  // 3. explicit palette block for this variant, if theme.css declares one
  take((s) => s === `:root[data-theme="${variant}"]${suffix}`);
  return merged;
};

/** Evaluate a raw token value into an OKLCH color (var() + color-mix aware). */
const evalValue = (map, raw, depth = 0) => {
  if (raw == null || depth > 8) return undefined;
  raw = raw.trim();
  if (raw === "transparent") return TRANSPARENT;
  const chain = raw.match(/^var\(\s*--([a-z0-9-]+)\s*\)$/);
  if (chain) return evalValue(map, map[chain[1]], depth + 1);
  const mix = raw.match(
    /^color-mix\(\s*in\s+oklch\s*,\s*(.+?)\s+(\d+(?:\.\d+)?%)\s*,\s*(.+?)\s*(?:\s+(\d+(?:\.\d+)?%|transparent))?\)$/,
  );
  if (mix) {
    const c1 = evalValue(map, mix[1], depth + 1);
    const c2 = evalValue(map, mix[3], depth + 1);
    if (!c1 || !c2) return undefined;
    const w1 = parseFloat(mix[2]) / 100;
    // CSS: an omitted second percentage takes the remainder (100% - w1).
    const w2 =
      mix[4] == null || mix[4] === "transparent" ? 1 - w1 : parseFloat(mix[4]) / 100;
    return mixOklch(c1, w1, c2, w2);
  }
  return parseOklch(raw);
};

const tokenColor = (map, name) => evalValue(map, map[name]);

/* --------------------------------------------------------------- matrix run */

const AA = 4.5;
const pairs = [
  // [fg token, bg token, note]
  ["foreground", "background", "body text"],
  ["foreground", "card", "body text on card"],
  ["foreground", "secondary", "body text on secondary"],
  ["card-foreground", "card", "card body"],
  ["muted-foreground", "background", "secondary text"],
  ["muted-foreground", "card", "P1-1: secondary text on card/popover"],
  ["muted-foreground", "secondary", "secondary text on secondary"],
  ["muted-foreground", "sidebar", "secondary text on sidebar"],
  ["secondary-foreground", "secondary", "secondary surface text"],
  ["accent-foreground", "accent", "accent surface text"],
  ["sidebar-foreground", "sidebar", "sidebar text"],
  ["primary-foreground", "primary", "primary fill label"],
  ["primary-foreground", "primary-hover", "primary hover label"],
  ["destructive-foreground", "destructive", "destructive fill label"],
  ["success", "background", "success as text"],
  ["success", "card", "success as text on card"],
  ["warning", "background", "P2-5: warning as text"],
  ["warning", "card", "warning as text on card"],
  ["info", "background", "info as text"],
  ["info", "card", "info as text on card"],
  ["destructive", "background", "destructive as text"],
  ["state-success-foreground", "state-success-surface", "Alert/Badge success"],
  ["state-warning-foreground", "state-warning-surface", "Alert/Badge warning"],
  [
    "state-destructive-foreground",
    "state-destructive-surface",
    "Alert/Badge destructive",
  ],
  ["state-info-foreground", "state-info-surface", "Alert/Badge info"],
];

let failures = 0;
const rows = [];
for (const variant of VARIANTS) {
  for (const dark of [false, true]) {
    const map = tokensFor(variant, dark);
    const mode = dark ? "dark" : "light";
    for (const [fgName, bgName, note] of pairs) {
      const fg = tokenColor(map, fgName);
      const bg = tokenColor(map, bgName);
      if (!fg || !bg) {
        failures += 1;
        rows.push([variant, mode, fgName, bgName, NaN, false, note]);
        continue;
      }
      const ratio = contrast(fg, bg);
      const ok = ratio >= AA - 1e-9;
      if (!ok) failures += 1;
      rows.push([variant, mode, fgName, bgName, ratio, ok, note]);
    }
  }
}

const label = (v) => (v === DEFAULT_VARIANT ? `${v} (default)` : v);
console.log(
  `\nWCAG AA contrast matrix — src/styles/theme.css (threshold ${AA}:1)\n`,
);
let current = "";
for (const [variant, mode, fg, bg, ratio, ok, note] of rows) {
  const key = `${label(variant)} ${mode}`;
  if (key !== current) {
    current = key;
    console.log(`── ${key}`);
  }
  console.log(
    `  ${ok ? "✓" : "✗"} ${fg} on ${bg}: ` +
      (Number.isNaN(ratio)
        ? "UNRESOLVED"
        : `${ratio.toFixed(2)}:1 ${hexOf(tokenColor(tokensFor(variant, mode === "dark"), fg))}/${hexOf(tokenColor(tokensFor(variant, mode === "dark"), bg))}`) +
      `${note ? `   (${note})` : ""}`,
  );
}

const totalPairs = VARIANTS.length * 2 * pairs.length;
console.log(
  `\n${totalPairs - failures}/${totalPairs} pairs ≥ ${AA}:1` +
    (failures ? ` — ${failures} FAILURES` : " — all green") +
    "\n",
);
if (failures) process.exit(1);

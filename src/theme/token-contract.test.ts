// @ts-nocheck -- contract test intentionally reads and parses the CSS source.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIMARY_DERIVED_TOKEN_NAMES,
  TOKEN_GROUP_LABELS,
  TOKEN_GROUP_ORDER,
  TOKEN_REGISTRY,
} from "./token-meta";
import { THEME_VARIANTS, type ThemeVariant } from "./variants";

const themeCss = readFileSync(
  resolve(process.cwd(), "src/styles/theme.css"),
  "utf8",
);

const cssTokenNames = new Set(
  Array.from(themeCss.matchAll(/--([a-z0-9-]+)\s*:/g), (match) => match[1]),
);
const registryTokenNames = TOKEN_REGISTRY.map((token) => token.name);

const paletteCss = themeCss.slice(
  themeCss.indexOf("PROFESSIONAL VIVID SOURCE PALETTES"),
  themeCss.indexOf("PROFESSIONAL VIVID DERIVED BRAND LAYERS"),
);

const lightSelector: Record<ThemeVariant, string> = {
  verdant: ":root",
  indigo: ':root[data-theme="indigo"]',
  amber: ':root[data-theme="amber"]',
  amethyst: ':root[data-theme="amethyst"]',
};

const darkSelector: Record<ThemeVariant, string> = {
  verdant: ":root.dark",
  indigo: ':root[data-theme="indigo"].dark',
  amber: ':root[data-theme="amber"].dark',
  amethyst: ':root[data-theme="amethyst"].dark',
};

function declarationsFor(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = paletteCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing palette selector: ${selector}`);

  return Object.fromEntries(
    Array.from(
      match[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g),
      (token) => [token[1], token[2].trim()],
    ),
  );
}

function parseOklch(value: string): { l: number; c: number; h: number } {
  const match = value.match(
    /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/,
  );
  if (!match) throw new Error(`Expected OKLCH color, received: ${value}`);
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

function linearSrgb(value: string): [number, number, number] {
  const { l, c, h } = parseOklch(value);
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const ll = lPrime ** 3;
  const mm = mPrime ** 3;
  const ss = sPrime ** 3;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));

  return [
    clamp(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
    clamp(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
    clamp(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
  ];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const [r, g, b] = linearSrgb(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function hueDistance(first: number, second: number): number {
  const distance = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
}

const corePaletteTokens = [
  "primary",
  "primary-hover",
  "primary-foreground",
  "background",
  "foreground",
  "card",
  "card-foreground",
  "secondary",
  "secondary-foreground",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "destructive",
  "success",
  "warning",
  "info",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
] as const;

describe("theme token contract", () => {
  it("CSS 自定义属性与 Token Registry 完全一致", () => {
    expect([...cssTokenNames].sort()).toEqual([...registryTokenNames].sort());
  });

  it("Token 名称唯一", () => {
    expect(new Set(registryTokenNames).size).toBe(registryTokenNames.length);
  });

  it("编辑器分组顺序覆盖所有 Registry 分组", () => {
    const registryGroups = new Set(TOKEN_REGISTRY.map((token) => token.group));
    expect(new Set(TOKEN_GROUP_ORDER)).toEqual(registryGroups);
    for (const group of TOKEN_GROUP_ORDER) {
      expect(TOKEN_GROUP_LABELS[group]).toBeTruthy();
    }
  });

  it("Professional Vivid 派生品牌 token 已完整注册且只读", () => {
    for (const name of PRIMARY_DERIVED_TOKEN_NAMES) {
      const token = TOKEN_REGISTRY.find((item) => item.name === name);
      expect(token).toMatchObject({
        name,
        type: "color",
        group: "brand",
        editable: false,
        perTheme: true,
      });
      expect(token?.derivesFrom).toBeTruthy();
      expect(themeCss).toContain(`--${name}: color-mix(in oklch`);
    }
  });

  it("四个主题的亮暗模式都提供完整核心色板", () => {
    for (const variant of THEME_VARIANTS) {
      for (const selector of [lightSelector[variant.id], darkSelector[variant.id]]) {
        const declarations = declarationsFor(selector);
        for (const token of corePaletteTokens) {
          expect(declarations[token], `${selector} 缺少 --${token}`).toBeTruthy();
        }
      }
    }
  });

  it("暗色 hover 比默认品牌色更亮，亮色 hover 更稳重", () => {
    for (const variant of THEME_VARIANTS) {
      const light = declarationsFor(lightSelector[variant.id]);
      const dark = declarationsFor(darkSelector[variant.id]);
      expect(parseOklch(light["primary-hover"]).l).toBeLessThan(
        parseOklch(light.primary).l,
      );
      expect(parseOklch(dark["primary-hover"]).l).toBeGreaterThan(
        parseOklch(dark.primary).l,
      );
    }
  });

  it("亮暗表面层级清晰且正文、弱化文字和主按钮满足 AA 对比度", () => {
    for (const variant of THEME_VARIANTS) {
      const light = declarationsFor(lightSelector[variant.id]);
      const dark = declarationsFor(darkSelector[variant.id]);

      expect(parseOklch(light.card).l).toBeGreaterThan(
        parseOklch(light.background).l,
      );
      expect(parseOklch(light.background).l).toBeGreaterThan(
        parseOklch(light.secondary).l,
      );
      expect(parseOklch(dark.background).l).toBeLessThan(parseOklch(dark.card).l);
      expect(parseOklch(dark.card).l).toBeLessThan(
        parseOklch(dark.secondary).l,
      );
      expect(parseOklch(dark.secondary).l).toBeLessThan(
        parseOklch(dark.border).l,
      );

      const lightPrimaryForeground = "oklch(0.99 0 0)";
      expect(contrastRatio(light.foreground, light.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light["muted-foreground"], light.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(lightPrimaryForeground, light.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dark.foreground, dark.background)).toBeGreaterThanOrEqual(4.5);
      const darkMutedContrast = contrastRatio(
        dark["muted-foreground"],
        dark.background,
      );
      expect(darkMutedContrast).toBeGreaterThanOrEqual(6.2);
      expect(darkMutedContrast).toBeLessThanOrEqual(6.5);
      expect(contrastRatio(dark["primary-foreground"], dark.primary)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("Verdant 与 success、Amber 与 warning 保持语义色相间隔", () => {
    const verdantLight = declarationsFor(lightSelector.verdant);
    const verdantDark = declarationsFor(darkSelector.verdant);
    const amberLight = declarationsFor(lightSelector.amber);
    const amberDark = declarationsFor(darkSelector.amber);

    expect(hueDistance(parseOklch(verdantLight.primary).h, parseOklch(verdantLight.success).h)).toBeGreaterThanOrEqual(18);
    expect(hueDistance(parseOklch(verdantDark.primary).h, parseOklch(verdantDark.success).h)).toBeGreaterThanOrEqual(18);
    expect(hueDistance(parseOklch(amberLight.primary).h, parseOklch(amberLight.warning).h)).toBeGreaterThanOrEqual(12);
    expect(hueDistance(parseOklch(amberDark.primary).h, parseOklch(amberDark.warning).h)).toBeGreaterThanOrEqual(8);
  });

  it("主题预览色与 light 色板同步", () => {
    for (const variant of THEME_VARIANTS) {
      const palette = declarationsFor(lightSelector[variant.id]);
      expect(variant.preview).toEqual({
        bg: palette.background,
        fg: palette.foreground,
        primary: palette.primary,
        border: palette.border,
      });
      expect(variant.desc).toMatch(/[，。]/);
    }
  });

  it("每个主题的五组图表色保持角色区分", () => {
    for (const variant of THEME_VARIANTS) {
      for (const selector of [lightSelector[variant.id], darkSelector[variant.id]]) {
        const palette = declarationsFor(selector);
        const chartColors = [1, 2, 3, 4, 5].map((index) => {
          const value = palette[`chart-${index}`];
          return value === "var(--primary)" ? palette.primary : value;
        });
        const hues = chartColors.map((value) => parseOklch(value).h);
        for (let first = 0; first < hues.length; first += 1) {
          for (let second = first + 1; second < hues.length; second += 1) {
            expect(hueDistance(hues[first], hues[second])).toBeGreaterThanOrEqual(30);
          }
        }
      }
    }
  });
});

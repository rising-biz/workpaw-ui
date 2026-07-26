/**
 * 聊天背景预设 — 单一真相源。预设 = glow/grid/background 三组 token 的命名快照。
 * 选中预设即把 tokens 批量写成 :root 内联 --var(经消费方的 wt())。
 * 新增预设:在 BackgroundPresetId 加 id + 追加一条 BackgroundPresetMeta,
 * 并在各 app 的 index.html no-flash 守卫里加对应分支。别处不要枚举 id。
 */

export type BackgroundPresetId =
  | "control-tower"
  | "dot-matrix"
  | "pure-glow"
  | "minimal";

export interface BackgroundPresetMeta {
  id: BackgroundPresetId;
  /** 中文显示名 */
  name: string;
  /** 一行风格描述 */
  desc: string;
  /** token 覆盖包(键无 -- 前缀),选中即批量写入 :root */
  tokens: Record<string, string>;
  /** 卡片 mini 预览用的静态快照 */
  preview: { gridImage: string; glow: string };
}

/** 无持久化选择时的默认预设 = 现状「控制塔」,保持开箱即用一致。 */
export const DEFAULT_BACKGROUND_PRESET: BackgroundPresetId = "control-tower";

// 网格图案片段(供 --bg-grid-image)。控制塔=线,点阵=点,其余=none。
const GRID_LINES =
  "linear-gradient(to right, color-mix(in oklch, var(--foreground) var(--grid-line-opacity, 5%), transparent) 1px, transparent 1px), " +
  "linear-gradient(to bottom, color-mix(in oklch, var(--foreground) var(--grid-line-opacity, 5%), transparent) 1px, transparent 1px)";
const GRID_DOTS =
  "radial-gradient(color-mix(in oklch, var(--foreground) var(--grid-line-opacity, 6%), transparent) 1.5px, transparent 1.5px)";

export const BACKGROUND_PRESETS: readonly BackgroundPresetMeta[] = [
  {
    id: "control-tower",
    name: "控制塔",
    desc: "细网格线 + 双角光晕。工程、冷静,精密仪表盘质感。",
    tokens: {
      "bg-grid-image": GRID_LINES,
      "grid-line-opacity": "5%",
      "bg-glow-intensity": "1",
      "bg-noise-opacity": "0.03",
    },
    preview: { gridImage: GRID_LINES, glow: "70% 20%" },
  },
  {
    id: "dot-matrix",
    name: "点阵",
    desc: "交点圆点替代线 + 同样光晕。更轻盈、更留白。",
    tokens: {
      "bg-grid-image": GRID_DOTS,
      "grid-line-opacity": "6%",
      "bg-glow-intensity": "1",
      "bg-noise-opacity": "0.03",
    },
    preview: { gridImage: GRID_DOTS, glow: "70% 20%" },
  },
  {
    id: "pure-glow",
    name: "纯光晕",
    desc: "去网格,只留呼吸光晕 + 噪点。氛围、柔和,焦点在内容。",
    tokens: {
      "bg-grid-image": "none",
      "grid-line-opacity": "0%",
      "bg-glow-intensity": "1.1",
      "bg-noise-opacity": "0.04",
    },
    preview: { gridImage: "none", glow: "55% 35%" },
  },
  {
    id: "minimal",
    name: "极简",
    desc: "网格近无、光晕压到最低。专注、内容至上,长对话不疲劳。",
    tokens: {
      "bg-grid-image": "none",
      "grid-line-opacity": "0%",
      "bg-glow-intensity": "0.4",
      "bg-noise-opacity": "0.02",
    },
    preview: { gridImage: "none", glow: "55% 35%" },
  },
];

/** 从真相源派生 id 列表;别处不要硬编码。 */
export const BACKGROUND_PRESET_IDS: readonly BackgroundPresetId[] =
  BACKGROUND_PRESETS.map((p) => p.id);

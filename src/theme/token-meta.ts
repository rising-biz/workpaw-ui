/**
 * Theme Token Registry — structured metadata for every CSS custom property
 * defined in `workpaw-ui/src/styles/theme.css`.
 *
 * This is the data dictionary that powers:
 *   1. The theme editor UI (grouping, labels, value pickers)
 *   2. Import/export validation (type checking, range constraints)
 *   3. Dependency tracking (derived token chains)
 *   4. Contrast / accessibility checks
 *
 * To add a token: append an entry to TOKEN_REGISTRY, add its CSS variable
 * to theme.css, and (if needed) bridge it in each app's @theme inline block.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type TokenType = "color" | "size" | "opacity" | "font" | "shadow" | "string";

export type TokenGroup =
  | "brand"
  | "surface"
  | "text"
  | "border"
  | "state"
  | "chart"
  | "sidebar"
  | "shape"
  | "shadow"
  | "spacing"
  | "typography"
  | "scrollbar"
  | "skeleton"
  | "glow"
  | "grid"
  | "background"
  | "overlay"
  | "data";

export interface TokenMeta {
  /** CSS variable name WITHOUT the leading `--`. */
  name: string;
  /** Value type — determines the editor widget (color picker, slider, etc.). */
  type: TokenType;
  /** UI grouping for the theme editor sidebar / panel. */
  group: TokenGroup;
  /** Human-readable label. Chinese-only per PRODUCT.md (v1). */
  label: string;
  /** One-line description of where this token appears in the UI. */
  description: string;
  /** For size tokens: valid range [min, max] with step. */
  range?: { min: string; max: string; step: string };
  /** Source token(s) this value derives from. Theme editors should show
   *  derived tokens as read-only computed values. */
  derivesFrom?: string | string[];
  /** When true the token is a leaf the user can edit.
   *  When false it is computed from other tokens. */
  editable: boolean;
  /** When true this token varies per theme variant (verdant/indigo/etc.).
   *  When false it is a shared constant in :root. */
  perTheme: boolean;
}

// ── Registry ───────────────────────────────────────────────────────────────

export const TOKEN_REGISTRY: readonly TokenMeta[] = [
  // -- brand ----------------------------------------------------------------
  {
    name: "primary",
    type: "color",
    group: "brand",
    label: "品牌色",
    description: "主按钮背景、链接色、聚焦环、选中态",
    editable: true,
    perTheme: true,
  },
  {
    name: "primary-hover",
    type: "color",
    group: "brand",
    label: "品牌色悬停",
    description: "按钮 hover / active 态的品牌色加深",
    derivesFrom: "primary",
    editable: true,
    perTheme: true,
  },
  {
    name: "primary-foreground",
    type: "color",
    group: "brand",
    label: "品牌色上的文字",
    description: "品牌色背景上的文字色（近白）",
    derivesFrom: "primary",
    editable: false,
    perTheme: false,
  },
  {
    name: "ring",
    type: "color",
    group: "brand",
    label: "聚焦环",
    description: "键盘聚焦时的 outline ring 颜色",
    derivesFrom: "primary",
    editable: false,
    perTheme: false,
  },

  // -- surface --------------------------------------------------------------
  {
    name: "background",
    type: "color",
    group: "surface",
    label: "页面底色",
    description: "最底层背景色，整个应用的基础色调",
    editable: true,
    perTheme: true,
  },
  {
    name: "foreground",
    type: "color",
    group: "surface",
    label: "正文色",
    description: "默认文字颜色，所有正文的基础色",
    editable: true,
    perTheme: true,
  },
  {
    name: "card",
    type: "color",
    group: "surface",
    label: "卡片背景",
    description: "卡片、浮层面板的背景色",
    editable: true,
    perTheme: true,
  },
  {
    name: "card-foreground",
    type: "color",
    group: "surface",
    label: "卡片文字",
    description: "卡片内的文字颜色",
    derivesFrom: "foreground",
    editable: true,
    perTheme: true,
  },
  {
    name: "popover",
    type: "color",
    group: "surface",
    label: "弹出层背景",
    description: "Popover、Dropdown 弹出面板的背景色",
    editable: true,
    perTheme: true,
  },
  {
    name: "popover-foreground",
    type: "color",
    group: "surface",
    label: "弹出层文字",
    description: "弹出层内的文字颜色",
    derivesFrom: "foreground",
    editable: true,
    perTheme: true,
  },
  {
    name: "secondary",
    type: "color",
    group: "surface",
    label: "次级表面",
    description: "次级按钮底、区块背景、hover 态底色",
    editable: true,
    perTheme: true,
  },
  {
    name: "secondary-foreground",
    type: "color",
    group: "surface",
    label: "次级表面文字",
    description: "次级表面上的文字颜色",
    derivesFrom: "foreground",
    editable: true,
    perTheme: true,
  },
  {
    name: "muted",
    type: "color",
    group: "surface",
    label: "静默表面",
    description: "禁用态、骨架屏底色、极弱区块背景",
    editable: true,
    perTheme: true,
  },
  {
    name: "muted-foreground",
    type: "color",
    group: "surface",
    label: "静默文字",
    description: "次级说明文字、占位符、时间戳",
    editable: true,
    perTheme: true,
  },
  {
    name: "accent",
    type: "color",
    group: "surface",
    label: "强调表面",
    description: "选中项背景、活跃导航项、高亮区块",
    editable: true,
    perTheme: true,
  },
  {
    name: "accent-foreground",
    type: "color",
    group: "surface",
    label: "强调表面文字",
    description: "强调表面上的文字颜色",
    derivesFrom: "foreground",
    editable: true,
    perTheme: true,
  },

  // -- surface layering (derived) -------------------------------------------
  {
    name: "surface-1",
    type: "color",
    group: "surface",
    label: "表面层 1",
    description: "最底层（= 页面底色）",
    derivesFrom: "background",
    editable: false,
    perTheme: false,
  },
  {
    name: "surface-2",
    type: "color",
    group: "surface",
    label: "表面层 2",
    description: "中层 tint（= 次级表面）。消息气泡、区块背景",
    derivesFrom: "secondary",
    editable: false,
    perTheme: false,
  },
  {
    name: "surface-3",
    type: "color",
    group: "surface",
    label: "表面层 3",
    description: "顶层白卡（= 卡片背景）。空状态、欢迎页卡片",
    derivesFrom: "card",
    editable: false,
    perTheme: false,
  },

  // -- border / input -------------------------------------------------------
  {
    name: "border",
    type: "color",
    group: "border",
    label: "边框色",
    description: "卡片边框、分隔线、输入框描边",
    editable: true,
    perTheme: true,
  },
  {
    name: "input",
    type: "color",
    group: "border",
    label: "输入框边框",
    description: "输入框专用描边色（通常比 --border 略深）",
    derivesFrom: "border",
    editable: true,
    perTheme: true,
  },

  // -- state ----------------------------------------------------------------
  {
    name: "destructive",
    type: "color",
    group: "state",
    label: "危险/错误色",
    description: "删除按钮、错误状态、验证失败",
    editable: true,
    perTheme: true,
  },
  {
    name: "destructive-foreground",
    type: "color",
    group: "state",
    label: "危险色文字",
    description: "危险按钮上的文字色",
    derivesFrom: "destructive",
    editable: false,
    perTheme: true,
  },
  {
    name: "success",
    type: "color",
    group: "state",
    label: "成功色",
    description: "成功状态、完成标记、绿色信号",
    editable: true,
    perTheme: true,
  },
  {
    name: "warning",
    type: "color",
    group: "state",
    label: "警告色",
    description: "警告状态、需要注意的信号",
    editable: true,
    perTheme: true,
  },
  {
    name: "info",
    type: "color",
    group: "state",
    label: "信息色",
    description: "信息提示、工具图标色",
    editable: true,
    perTheme: true,
  },

  // -- chart ----------------------------------------------------------------
  {
    name: "chart-1",
    type: "color",
    group: "chart",
    label: "图表色 1",
    description: "图表主序列（= 品牌色）",
    derivesFrom: "primary",
    editable: false,
    perTheme: true,
  },
  {
    name: "chart-2",
    type: "color",
    group: "chart",
    label: "图表色 2",
    description: "图表第二序列",
    editable: true,
    perTheme: true,
  },
  {
    name: "chart-3",
    type: "color",
    group: "chart",
    label: "图表色 3",
    description: "图表第三序列",
    editable: true,
    perTheme: true,
  },
  {
    name: "chart-4",
    type: "color",
    group: "chart",
    label: "图表色 4",
    description: "图表第四序列",
    editable: true,
    perTheme: true,
  },
  {
    name: "chart-5",
    type: "color",
    group: "chart",
    label: "图表色 5",
    description: "图表第五序列",
    editable: true,
    perTheme: true,
  },

  // -- sidebar --------------------------------------------------------------
  {
    name: "sidebar",
    type: "color",
    group: "sidebar",
    label: "侧栏背景",
    description: "左侧导航栏底色",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-foreground",
    type: "color",
    group: "sidebar",
    label: "侧栏文字",
    description: "侧栏导航项默认文字色",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-primary",
    type: "color",
    group: "sidebar",
    label: "侧栏品牌色",
    description: "侧栏中品牌色的变体（通常 = --primary）",
    derivesFrom: "primary",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-primary-foreground",
    type: "color",
    group: "sidebar",
    label: "侧栏品牌文字",
    description: "侧栏品牌色上的文字",
    derivesFrom: "primary-foreground",
    editable: false,
    perTheme: true,
  },
  {
    name: "sidebar-accent",
    type: "color",
    group: "sidebar",
    label: "侧栏强调色",
    description: "侧栏活跃项 / hover 项背景",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-accent-foreground",
    type: "color",
    group: "sidebar",
    label: "侧栏强调文字",
    description: "侧栏活跃项文字色",
    derivesFrom: "accent-foreground",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-border",
    type: "color",
    group: "sidebar",
    label: "侧栏边框",
    description: "侧栏右侧分隔线",
    derivesFrom: "border",
    editable: true,
    perTheme: true,
  },
  {
    name: "sidebar-ring",
    type: "color",
    group: "sidebar",
    label: "侧栏聚焦环",
    description: "侧栏中的聚焦指示",
    derivesFrom: "ring",
    editable: false,
    perTheme: true,
  },

  // -- shape ----------------------------------------------------------------
  {
    name: "radius",
    type: "size",
    group: "shape",
    label: "基础圆角",
    description: "默认圆角半径，派生整个圆角体系",
    range: { min: "0rem", max: "1.5rem", step: "0.0625rem" },
    editable: true,
    perTheme: true,
  },
  {
    name: "radius-sm",
    type: "size",
    group: "shape",
    label: "小圆角",
    description: "标签、徽标、紧凑元素",
    derivesFrom: "radius",
    editable: false,
    perTheme: false,
  },
  {
    name: "radius-md",
    type: "size",
    group: "shape",
    label: "中圆角",
    description: "导航项、工具栏按钮",
    derivesFrom: "radius",
    editable: false,
    perTheme: false,
  },
  {
    name: "radius-lg",
    type: "size",
    group: "shape",
    label: "大圆角",
    description: "按钮、输入框、卡片",
    derivesFrom: "radius",
    editable: false,
    perTheme: false,
  },
  {
    name: "radius-xl",
    type: "size",
    group: "shape",
    label: "超大圆角",
    description: "大卡片、对话框",
    derivesFrom: "radius",
    editable: false,
    perTheme: false,
  },

  // -- shadow ---------------------------------------------------------------
  {
    name: "shadow-sm",
    type: "shadow",
    group: "shadow",
    label: "轻阴影",
    description: "微浮起效果",
    editable: true,
    perTheme: false,
  },
  {
    name: "shadow-md",
    type: "shadow",
    group: "shadow",
    label: "中阴影",
    description: "hover 提升效果",
    editable: true,
    perTheme: false,
  },
  {
    name: "shadow-lg",
    type: "shadow",
    group: "shadow",
    label: "重阴影",
    description: "Dialog、Popover 浮层阴影",
    editable: true,
    perTheme: false,
  },

  // -- spacing --------------------------------------------------------------
  {
    name: "spacing-xs",
    type: "size",
    group: "spacing",
    label: "间距 xs",
    description: "极紧凑间距（4px）",
    range: { min: "0rem", max: "0.5rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "spacing-sm",
    type: "size",
    group: "spacing",
    label: "间距 sm",
    description: "紧凑间距（8px）",
    range: { min: "0.25rem", max: "0.75rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "spacing-md",
    type: "size",
    group: "spacing",
    label: "间距 md",
    description: "默认间距（12px）",
    range: { min: "0.5rem", max: "1rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "spacing-lg",
    type: "size",
    group: "spacing",
    label: "间距 lg",
    description: "宽松间距（16px）",
    range: { min: "0.75rem", max: "1.5rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "spacing-xl",
    type: "size",
    group: "spacing",
    label: "间距 xl",
    description: "大间距（24px）",
    range: { min: "1rem", max: "2rem", step: "0.125rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "spacing-2xl",
    type: "size",
    group: "spacing",
    label: "间距 2xl",
    description: "超大间距（32px）",
    range: { min: "1.5rem", max: "3rem", step: "0.125rem" },
    editable: true,
    perTheme: false,
  },

  // -- typography -----------------------------------------------------------
  {
    name: "font-sans",
    type: "font",
    group: "typography",
    label: "无衬线字体",
    description: "全局默认字体栈",
    editable: true,
    perTheme: false,
  },
  {
    name: "font-mono",
    type: "font",
    group: "typography",
    label: "等宽字体",
    description: "代码块、技术文本",
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-3xs",
    type: "size",
    group: "typography",
    label: "超微字号",
    description: "超小标签、badge（10px）",
    range: { min: "0.5rem", max: "0.75rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-2xs",
    type: "size",
    group: "typography",
    label: "微小字号",
    description: "小标签、时间戳、计数（11px）",
    range: { min: "0.5625rem", max: "0.8125rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-xs",
    type: "size",
    group: "typography",
    label: "特小字号",
    description: "说明文字、placeholder（12px）",
    range: { min: "0.625rem", max: "0.875rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-sm",
    type: "size",
    group: "typography",
    label: "小字号",
    description: "辅助正文、列表项（13px / 0.8125rem）",
    range: { min: "0.6875rem", max: "0.9375rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-base",
    type: "size",
    group: "typography",
    label: "基础字号",
    description: "正文默认字号（14px）",
    range: { min: "0.75rem", max: "1rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-lg",
    type: "size",
    group: "typography",
    label: "大字号",
    description: "卡片标题、区块标题（17px）",
    range: { min: "0.875rem", max: "1.25rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-xl",
    type: "size",
    group: "typography",
    label: "特大字号",
    description: "页面标题（20px）",
    range: { min: "1rem", max: "1.5rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-2xl",
    type: "size",
    group: "typography",
    label: "超大字号",
    description: "主要标题（24px）",
    range: { min: "1.25rem", max: "2rem", step: "0.0625rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-3xl",
    type: "size",
    group: "typography",
    label: "2xl 字号",
    description: "登录页标题（30px）",
    range: { min: "1.5rem", max: "2.5rem", step: "0.125rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "font-size-4xl",
    type: "size",
    group: "typography",
    label: "3xl 字号",
    description: "超大展示标题（36px）",
    range: { min: "2rem", max: "3rem", step: "0.125rem" },
    editable: true,
    perTheme: false,
  },
  {
    name: "leading-tight",
    type: "size",
    group: "typography",
    label: "紧凑行高",
    description: "标题、按钮文字行高",
    range: { min: "1", max: "1.5", step: "0.0625" },
    editable: true,
    perTheme: false,
  },
  {
    name: "leading-normal",
    type: "size",
    group: "typography",
    label: "正常行高",
    description: "正文默认行高",
    range: { min: "1.25", max: "1.75", step: "0.0625" },
    editable: true,
    perTheme: false,
  },
  {
    name: "leading-relaxed",
    type: "size",
    group: "typography",
    label: "宽松行高",
    description: "长文、说明文字行高",
    range: { min: "1.5", max: "2", step: "0.0625" },
    editable: true,
    perTheme: false,
  },
  {
    name: "tracking-tight",
    type: "size",
    group: "typography",
    label: "紧凑字距",
    description: "标题字距",
    range: { min: "-0.05em", max: "0", step: "0.005em" },
    editable: true,
    perTheme: false,
  },
  {
    name: "tracking-normal",
    type: "size",
    group: "typography",
    label: "正常字距",
    description: "正文默认字距",
    range: { min: "-0.02em", max: "0.02em", step: "0.005em" },
    editable: true,
    perTheme: false,
  },
  {
    name: "tracking-wide",
    type: "size",
    group: "typography",
    label: "宽松字距",
    description: "标签、uppercase 字距",
    range: { min: "0", max: "0.05em", step: "0.005em" },
    editable: true,
    perTheme: false,
  },

  // -- scrollbar ------------------------------------------------------------
  {
    name: "scrollbar-width",
    type: "size",
    group: "scrollbar",
    label: "滚动条宽度",
    description: "滚动条轨道宽度",
    range: { min: "4px", max: "12px", step: "1px" },
    editable: true,
    perTheme: false,
  },
  {
    name: "scrollbar-track",
    type: "color",
    group: "scrollbar",
    label: "滚动条轨道",
    description: "滚动条轨道背景色",
    editable: true,
    perTheme: false,
  },
  {
    name: "scrollbar-thumb",
    type: "color",
    group: "scrollbar",
    label: "滚动条滑块",
    description: "滚动条滑块颜色（亮色模式）",
    editable: true,
    perTheme: true,
  },
  {
    name: "scrollbar-thumb-hover",
    type: "color",
    group: "scrollbar",
    label: "滚动条悬停",
    description: "滚动条滑块 hover 态颜色",
    derivesFrom: "scrollbar-thumb",
    editable: true,
    perTheme: true,
  },

  // -- skeleton -------------------------------------------------------------
  {
    name: "skeleton-base",
    type: "color",
    group: "skeleton",
    label: "骨架底色",
    description: "加载骨架屏的底色",
    derivesFrom: "muted",
    editable: false,
    perTheme: false,
  },
  {
    name: "skeleton-shine",
    type: "color",
    group: "skeleton",
    label: "骨架光泽",
    description: "加载骨架屏的光泽色（shimmer 动画）",
    derivesFrom: "secondary",
    editable: false,
    perTheme: false,
  },

  // -- data visualization ---------------------------------------------------
  {
    name: "data-positive",
    type: "color",
    group: "data",
    label: "正向数据色",
    description: "增长、达标、正向指标（= 成功色）",
    derivesFrom: "success",
    editable: false,
    perTheme: false,
  },
  {
    name: "data-negative",
    type: "color",
    group: "data",
    label: "负向数据色",
    description: "下降、异常、负向指标（= 危险色）",
    derivesFrom: "destructive",
    editable: false,
    perTheme: false,
  },
  {
    name: "data-neutral",
    type: "color",
    group: "data",
    label: "中性数据色",
    description: "持平、无变化指标（= 静默文字色）",
    derivesFrom: "muted-foreground",
    editable: false,
    perTheme: false,
  },

  // -- overlay --------------------------------------------------------------
  {
    name: "overlay",
    type: "color",
    group: "overlay",
    label: "遮罩层背景",
    description: "Modal / Dialog 遮罩层背景色",
    editable: true,
    perTheme: false,
  },
  {
    name: "overlay-foreground",
    type: "color",
    group: "overlay",
    label: "遮罩层文字",
    description: "遮罩层上的文字色（通常近白）",
    derivesFrom: "overlay",
    editable: false,
    perTheme: false,
  },

  // -- glow / grid ----------------------------------------------------------
  {
    name: "bg-glow-intensity",
    type: "opacity",
    group: "glow",
    label: "光晕强度",
    description: "Chat 背景光晕的整体强度倍数（0 = 关闭）",
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-glow-color",
    type: "color",
    group: "glow",
    label: "光晕颜色",
    description: "Chat 背景光晕的颜色",
    derivesFrom: "primary",
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-glow-size-1",
    type: "size",
    group: "glow",
    label: "光斑 1 尺寸",
    description: "右上光斑的直径",
    range: { min: "200px", max: "1600px", step: "50px" },
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-glow-size-2",
    type: "size",
    group: "glow",
    label: "光斑 2 尺寸",
    description: "左下光斑的直径",
    range: { min: "200px", max: "1200px", step: "50px" },
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-glow-breathing-w",
    type: "size",
    group: "glow",
    label: "呼吸光晕宽",
    description: "呼吸光晕椭圆的宽度",
    range: { min: "400px", max: "2000px", step: "50px" },
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-glow-breathing-h",
    type: "size",
    group: "glow",
    label: "呼吸光晕高",
    description: "呼吸光晕椭圆的高度",
    range: { min: "300px", max: "1500px", step: "50px" },
    editable: true,
    perTheme: false,
  },

  // -- grid -----------------------------------------------------------------
  {
    name: "grid-line-opacity",
    type: "opacity",
    group: "grid",
    label: "网格线透明度",
    description: "科技感背景网格线的透明度",
    range: { min: "0%", max: "20%", step: "1%" },
    editable: true,
    perTheme: true,
  },
  {
    name: "grid-glow-opacity",
    type: "opacity",
    group: "grid",
    label: "网格光晕透明度",
    description: "角落光晕的透明度",
    range: { min: "0%", max: "40%", step: "1%" },
    editable: true,
    perTheme: true,
  },
  {
    name: "grid-cell-size",
    type: "size",
    group: "grid",
    label: "网格单元格大小",
    description: "科技感网格的单元格边长",
    range: { min: "24px", max: "96px", step: "8px" },
    editable: true,
    perTheme: false,
  },

  // -- background images ----------------------------------------------------
  {
    name: "bg-chat-image",
    type: "string",
    group: "background",
    label: "背景图片",
    description: "Chat 背景纹理图片（url() 或 none）",
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-chat-image-blend",
    type: "string",
    group: "background",
    label: "背景图混合模式",
    description: "背景纹理与底色的 CSS mix-blend-mode",
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-noise-image",
    type: "string",
    group: "background",
    label: "噪点纹理",
    description: "噪声/颗粒纹理（url() 或 none）",
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-noise-opacity",
    type: "opacity",
    group: "background",
    label: "噪点透明度",
    description: "噪点纹理的不透明度",
    range: { min: "0", max: "0.2", step: "0.01" },
    editable: true,
    perTheme: false,
  },
  {
    name: "bg-noise-blend",
    type: "string",
    group: "background",
    label: "噪点混合模式",
    description: "噪点纹理的 CSS mix-blend-mode",
    editable: true,
    perTheme: false,
  },
];

// ── Group labels (Chinese) ─────────────────────────────────────────────────

export const TOKEN_GROUP_LABELS: Record<TokenGroup, string> = {
  brand: "品牌色",
  surface: "表面色",
  text: "文字色",
  border: "边框",
  state: "状态色",
  chart: "图表色",
  sidebar: "侧栏",
  shape: "圆角",
  shadow: "阴影",
  spacing: "间距",
  typography: "排版",
  scrollbar: "滚动条",
  skeleton: "骨架屏",
  glow: "环境光",
  grid: "网格",
  background: "背景纹理",
  overlay: "遮罩层",
  data: "数据色",
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Get all editable (leaf) tokens — these are what a theme editor exposes. */
export function editableTokens(): TokenMeta[] {
  return TOKEN_REGISTRY.filter((t) => t.editable);
}

/** Get tokens grouped for the theme editor sidebar. */
export function tokensByGroup(): Map<TokenGroup, TokenMeta[]> {
  const map = new Map<TokenGroup, TokenMeta[]>();
  for (const t of TOKEN_REGISTRY) {
    const arr = map.get(t.group) || [];
    arr.push(t);
    map.set(t.group, arr);
  }
  return map;
}

/** Build a dependency map: token name → tokens that derive from it. */
export function dependencyGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const t of TOKEN_REGISTRY) {
    if (!t.derivesFrom) continue;
    const sources = Array.isArray(t.derivesFrom) ? t.derivesFrom : [t.derivesFrom];
    for (const src of sources) {
      const deps = graph.get(src) || [];
      deps.push(t.name);
      graph.set(src, deps);
    }
  }
  return graph;
}

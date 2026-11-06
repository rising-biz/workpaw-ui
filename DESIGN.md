---
name: WorkPaw
description: 企业级私有化多用户 AI 智能体平台 — 五主题设计系统
colors:
  indigo-primary: "oklch(0.52 0.27 264)"
  indigo-primary-hover: "oklch(0.46 0.27 264)"
  indigo-bg: "oklch(0.965 0.012 265)"
  verdant-primary: "oklch(0.50 0.20 165)"
  verdant-bg: "oklch(0.965 0.012 160)"
  amber-primary: "oklch(0.56 0.15 72)"
  amber-bg: "oklch(0.970 0.016 82)"
  amethyst-primary: "oklch(0.54 0.27 296)"
  amethyst-bg: "oklch(0.965 0.014 294)"
  workbuddy-primary: "oklch(0.22 0 0)"
  workbuddy-bg: "oklch(0.985 0 0)"
  ink: "oklch(0.20 0.035 265)"
  destructive: "oklch(0.54 0.22 25)"
typography:
  display:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.01em"
rounded:
  sm: "calc(var(--radius) - 4px)"
  md: "calc(var(--radius) - 2px)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) + 4px)"
  2xl: "calc(var(--radius) * 1.8)"
spacing:
  xs: "calc(var(--spacing-md) * 0.333)"
  sm: "calc(var(--spacing-md) * 0.667)"
  md: "var(--spacing-md, 12px)"
  lg: "calc(var(--spacing-md) * 1.333)"
  xl: "calc(var(--spacing-md) * 2)"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "var(--primary-foreground)"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "var(--foreground)"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "36px"
  input-text:
    backgroundColor: "transparent"
    textColor: "var(--foreground)"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  card:
    backgroundColor: "var(--card)"
    textColor: "var(--card-foreground)"
    border: "1px var(--border)"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-state:
    backgroundColor: "var(--state-*-surface)"
    textColor: "var(--state-*-foreground)"
    border: "1px var(--state-*-border)"
  sidebar-floating:
    backgroundColor: "var(--sidebar)"
    border: "1px var(--sidebar-border)"
    shadow: "var(--shadow-lg)"
---

# Design System: WorkPaw

> 本文档描述 `workpaw-ui`（`src/styles/theme.css` + `src/components/ui/*`）的真实实现。
> 事实来源：`src/theme/variants.ts`（主题注册表）、`src/styles/theme.css`（token 矩阵）、
> `src/components/ui/`（组件）。文档与实现由 `pnpm lint` 中的
> `scripts/check-theme-contracts.mjs` / `scripts/check-contrast.mjs` /
> `scripts/check-tailwind-preset.mjs` 门禁看守。

## 1. Overview

**Creative North Star: "色彩个性"**

WorkPaw 的辨识度来自**饱和且出人意料的强调色**，不靠沉重的深色侧栏。默认主题是夜靛
（Indigo）——在蓝紫之间找到自己的区间，区别于企业蓝海和开发者绿。它轻盈、不压抑，但有
强烈的色彩主张：用户打开第一眼就知道"这不是又一个蓝灰色的企业工具"。

五主题体系（夜靛 / 翠微 / 墨金 / 紫微 / 墨白）覆盖靛、绿、金、紫、无彩五个区间，全部
亮色为主、侧栏保持轻盈。`workbuddy`（墨白）是无彩墨色方案：产品 chrome 全部黑白灰，
但状态色与图表色保持可用，让状态与数据依然可读。

这套系统的气质是「轻盈 · 明快 · 友好」的当代表达：饱和强调色提供戏剧性的第一眼（明快），
品牌色微染的 tonal 分层建立舒适的空间深度（轻盈），出人意料的色彩选择让人愿意停留（友好）。

**Key Characteristics:**
- **色彩个性优先**：辨识度 = 强调色的选择，不是侧栏的明暗。夜靛是默认签名；紫微把紫色
  做到 0.27 chroma 的高能主张。侧栏保持亮色（品牌色微染），绝不压抑
- **Tonal 三层表面**：内容区通过色彩亮度区分层次——微染底色 → 品牌 tint 区块 → 近白卡片
  浮起，不需要阴影就能建立空间深度
- **品牌色策略 Committed**：品牌色占 ~20-25%，出现在主操作、accent 表面、选中态、hover
  微光。比 Restrained（≤10%）更有存在感，但不喧宾夺主
- **一个字族**：Inter Variable，400/500/600 三级权重；字号系统从 0.875rem 基准派生
- **组件克制但自信**：卡片在 tint 底上浮起，静止态只有边框。深度靠色彩，不靠投影

**What we reject（引自 PRODUCT.md）：** Ant Design 紧凑观感、冷硬企业控制台、过度装饰
SaaS、沉闷企业蓝、AI-SaaS 暖中性底色、等大卡片网格

---

## 2. Themes

WorkPaw 提供五个主题，用户可在设置中切换。每个主题是完整的亮/暗双模式体系。

**CSS 映射契约**（P1-2 修复后）：默认主题 indigo **就是裸 `:root`**（不设置
`data-theme` 属性）；其余主题通过 `data-theme` 属性挂载。`.dark` class 控制亮暗模式。

```
:root                                 → indigo light（默认，无 data-theme 属性）
:root.dark                            → indigo dark
:root[data-theme="verdant"]           → verdant light
:root[data-theme="verdant"].dark      → verdant dark
:root[data-theme="amber"]             → amber light
:root[data-theme="amber"].dark        → amber dark
:root[data-theme="amethyst"]          → amethyst light
:root[data-theme="amethyst"].dark     → amethyst dark
:root[data-theme="workbuddy"]         → workbuddy light
:root[data-theme="workbuddy"].dark    → workbuddy dark
```

显式设置 `data-theme="indigo"` 也解析到同一组值（裸 `:root` 即 indigo）。运行时映射由
`ThemeProvider`（`ThemeApplier`：默认主题移除属性、其余设置属性）与无闪烁守卫脚本
`src/theme-init.js`（导出为 `workpaw-ui/theme-init.js`）共同拥有，两者的一致性由
`scripts/check-theme-contracts.mjs` 强制。

### 2.1 夜靛 Indigo（默认）

**场景句**：日常办公，需要专注但不想被界面压迫。电光靛蓝在高密度工作流中保持清晰锋芒。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.52 0.27 264)` | `oklch(0.70 0.25 264)` |
| `--primary-hover` | `oklch(0.46 0.27 264)` | `oklch(0.75 0.23 264)` |
| `--background` | `oklch(0.965 0.012 265)` | `oklch(0.140 0.028 265)` |
| `--foreground` | `oklch(0.20 0.035 265)` | `oklch(0.92 0.008 260)` |
| `--card` | `oklch(0.995 0.006 265)` | `oklch(0.200 0.032 264)` |
| `--secondary` | `oklch(0.925 0.030 265)` | `oklch(0.245 0.040 264)` |
| `--muted-foreground` | `oklch(0.49 0.035 265)` | `oklch(0.66 0.025 262)` |
| `--accent` | `oklch(0.890 0.090 264)` | `oklch(0.290 0.120 264)` |
| `--accent-foreground` | `oklch(0.27 0.145 264)` | `oklch(0.88 0.160 264)` |
| `--border` | `oklch(0.840 0.030 265)` | `oklch(0.340 0.040 264)` |
| `--sidebar` | `oklch(0.952 0.024 265)` | `oklch(0.172 0.040 264)` |

**性格**：微染冷白底 + 电光靛蓝信号。底色 chroma 0.012 toward 265——不是纯白，是"冷纸
色"。0.27 chroma 的饱和度是五主题中最锋利的品牌主张。

### 2.2 翠微 Verdant

**场景句**：需要一点生命力。青翠翡翠 + 清透中性色，可信、敏捷，并与成功状态（hue 145）
保持明确区分（品牌 hue 165）。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.50 0.20 165)` | `oklch(0.72 0.20 165)` |
| `--primary-hover` | `oklch(0.44 0.20 165)` | `oklch(0.77 0.18 165)` |
| `--background` | `oklch(0.965 0.012 160)` | `oklch(0.140 0.023 160)` |
| `--foreground` | `oklch(0.20 0.030 160)` | `oklch(0.92 0.008 155)` |
| `--card` | `oklch(0.995 0.006 160)` | `oklch(0.200 0.028 160)` |
| `--secondary` | `oklch(0.925 0.028 160)` | `oklch(0.245 0.034 160)` |
| `--muted-foreground` | `oklch(0.49 0.030 160)` | `oklch(0.66 0.022 158)` |
| `--accent` | `oklch(0.895 0.080 163)` | `oklch(0.290 0.105 163)` |
| `--accent-foreground` | `oklch(0.27 0.125 165)` | `oklch(0.88 0.135 165)` |
| `--border` | `oklch(0.840 0.026 160)` | `oklch(0.340 0.032 160)` |
| `--sidebar` | `oklch(0.952 0.022 160)` | `oklch(0.172 0.034 160)` |

### 2.3 墨金 Amber

**场景句**：下午三四点，想要一点温暖。矿物金 + 温润墨色，高级稳健，以金色品牌感
（hue 72）避开橙色警告语义（warning hue 58）。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.56 0.15 72)` | `oklch(0.78 0.18 78)` |
| `--primary-hover` | `oklch(0.50 0.15 72)` | `oklch(0.83 0.16 80)` |
| `--background` | `oklch(0.970 0.016 82)` | `oklch(0.145 0.018 72)` |
| `--foreground` | `oklch(0.20 0.025 78)` | `oklch(0.92 0.009 82)` |
| `--card` | `oklch(0.995 0.008 82)` | `oklch(0.200 0.024 74)` |
| `--secondary` | `oklch(0.935 0.035 82)` | `oklch(0.245 0.030 76)` |
| `--muted-foreground` | `oklch(0.49 0.030 80)` | `oklch(0.66 0.022 78)` |
| `--accent` | `oklch(0.900 0.085 76)` | `oklch(0.300 0.105 74)` |
| `--accent-foreground` | `oklch(0.28 0.105 72)` | `oklch(0.89 0.135 80)` |
| `--border` | `oklch(0.850 0.032 80)` | `oklch(0.345 0.030 76)` |
| `--sidebar` | `oklch(0.958 0.028 82)` | `oklch(0.176 0.030 74)` |

### 2.4 紫微 Amethyst

**场景句**：需要创造力和能量。高能紫晶 + 冷调层次，让数据密集界面鲜亮而不躁。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.54 0.27 296)` | `oklch(0.72 0.25 296)` |
| `--primary-hover` | `oklch(0.48 0.27 296)` | `oklch(0.77 0.22 296)` |
| `--background` | `oklch(0.965 0.014 294)` | `oklch(0.140 0.030 294)` |
| `--foreground` | `oklch(0.20 0.040 294)` | `oklch(0.92 0.009 290)` |
| `--card` | `oklch(0.995 0.007 294)` | `oklch(0.200 0.036 294)` |
| `--secondary` | `oklch(0.925 0.032 294)` | `oklch(0.245 0.044 294)` |
| `--muted-foreground` | `oklch(0.49 0.040 294)` | `oklch(0.66 0.028 294)` |
| `--accent` | `oklch(0.895 0.095 296)` | `oklch(0.290 0.130 296)` |
| `--accent-foreground` | `oklch(0.28 0.150 296)` | `oklch(0.88 0.170 296)` |
| `--border` | `oklch(0.840 0.032 294)` | `oklch(0.340 0.045 294)` |
| `--sidebar` | `oklch(0.952 0.026 294)` | `oklch(0.172 0.044 294)` |

### 2.5 墨白 WorkBuddy

**场景句**：办公感优先。墨色主按钮 + 纯白纸面，界面不靠彩色品牌色说话。无彩主色
（hue 0, chroma 0）远离 destructive（25°）与 warning（58°），互不混淆。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.22 0 0)` | `oklch(0.92 0 0)` |
| `--primary-hover` | `oklch(0.12 0 0)` | `oklch(0.97 0 0)` |
| `--background` | `oklch(0.985 0 0)` | `oklch(0.140 0 0)` |
| `--foreground` | `oklch(0.18 0 0)` | `oklch(0.97 0 0)` |
| `--card` | `oklch(0.998 0 0)` | `oklch(0.200 0 0)` |
| `--secondary` | `oklch(0.940 0 0)` | `oklch(0.248 0 0)` |
| `--muted-foreground` | `oklch(0.46 0 0)` | `oklch(0.664 0 0)` |
| `--accent` | `oklch(0.920 0 0)` | `oklch(0.280 0 0)` |
| `--accent-foreground` | `oklch(0.22 0 0)` | `oklch(0.97 0 0)` |
| `--border` | `oklch(0.860 0 0)` | `oklch(0.348 0 0)` |
| `--sidebar` | `oklch(0.970 0 0)` | `oklch(0.172 0 0)` |

**注**：workbuddy 的暗色主按钮反转为近白（`oklch(0.92 0 0)`）配墨色文字——暗色模式下的
"墨白"是白墨，不是灰按钮。

### 2.6 Shared Tokens（跨主题常量与派生）

这些 token 不随主题变化，定义在裸 `:root` 上：

| Token | Value | Notes |
|-------|-------|-------|
| `--primary-foreground` | `oklch(0.99 0 0)` light | 品牌色上的文字（近白）；暗色按主题定义（墨白反转为墨色） |
| `--ring` | `var(--primary)` | 聚焦环跟随品牌色 |
| `--destructive` | `oklch(0.54 0.22 25)` light / `oklch(0.68 0.20 25)` dark | 五主题统一 |
| `--success` | `oklch(0.50 0.17 145)` light / `oklch(0.72 0.18 145)` dark | |
| `--warning` | `oklch(0.55 0.15 58)` light / `oklch(0.78 0.16 70)` dark | 亮色 L=0.55（P1-1 修复：原 0.60 不达 AA 4.5:1） |
| `--info` | `oklch(0.52 0.18 245)` light / `oklch(0.72 0.17 245)` dark | |
| `--overlay` | `color-mix(in oklch, var(--foreground) 42%, transparent)` | 无 color-mix 引擎回退 `oklch(0 0 0 / 0.5)`（半透明黑，绝不是不透明前景色） |
| `--state-{success,warning,destructive,info}-{foreground,surface,border}` | color-mix 派生（76% / 10% / 32%） | 回退：前景/背景/主题色直用 |
| `--skeleton-base` | `var(--accent)` | Skeleton 组件实际消费；`--skeleton-shine` 为 shimmer 预留（未实现） |
| `--radius` | `0.625rem`（10px） | sm/md/lg/xl 按上游公式 -4/-2/+0/+4 派生；2xl+ 按乘法 1.8×/2.2×/2.6× |
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | 经 @theme inline 映射，`shadow-sm` 工具类引用运行时 token |
| `--shadow-md` | `0 4px 8px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)` | |
| `--shadow-lg` | `0 8px 16px -4px rgb(0 0 0 / 0.10), 0 4px 6px -2px rgb(0 0 0 / 0.05)` | |
| `--chart-1` | `var(--primary)` | 图表主序列跟随品牌色 |
| `--chart-2..5` | 每主题独立四色 | 与主色保持色相距离（color-verify 由对比度门禁覆盖前景用途） |
| `--spacing-md` | `0.75rem` | xs/sm/lg/xl/2xl 由它派生（×0.333/0.667/1.333/2/2.667） |
| `--font-size-base` | `0.875rem`（14px） | 3xs–4xl 字号全部派生（×0.714…×2.571） |

**Tailwind 映射层归库所有**：`theme.css` 顶部声明 `@source "../"`（扫描库组件源码）、
`@custom-variant dark`、`@theme inline`（全部 `--color-*`/radius/shadow 到运行时 token
的映射）。消费端只需 `@import "workpaw-ui/theme.css"` 一行即可获得全部工具类；
`scripts/check-tailwind-preset.mjs` 用真实 Tailwind 编译器实证这些声明在 @import 链内
生效（utilities、dark: 变体、任意值工具、state-* 工具全部断言）。

**消费端差异：desktop radius（既定决策，2026-11 审计拍板）**：workpaw-desktop 维护
自己的一套加法密度公式（8/10/12/16px，见其 DESIGN.md），服务于桌面端信息密度，
**有意不收敛**到库的派生公式；web 与 admin 前端则完全使用库映射。统一需以
桌面视觉验收为前提，勿作为"漂移"单独"修复"。

### Named Rules

**The Color Personality Rule.** WorkPaw 的辨识度来自强调色的选择，不靠深色侧栏。默认
主题夜靛（hue 264）在蓝紫之间——企业软件海里几乎没人把 0.27 chroma 的电光靛做主色；
紫微（296）与翠微（165）覆盖另外两个不常见区间。绝不退回安全的企业蓝/灰。

**The Light Sidebar Rule.** 侧栏保持亮色（品牌色微染，`--sidebar` L≈0.95），不做成沉重
压抑的深色块。暗色模式下侧栏跟随暗色表面（L≈0.17），仍是同一 tonal 层次体系。

**The Tonal Canvas Rule.** 内容区通过三层色彩亮度建立空间深度，不需要阴影：底色
（`--background`，品牌色微染）→ 区块/次级表面（`--secondary`）→ 卡片/浮层（`--card`，
近白）。用户能感知到卡片在"上面"，但说不清为什么——这是色彩层次，不是投影层次。

**The Border-OR-Shadow Rule.** 同一元素不可同时有 1px 边框 + 装饰性 drop shadow。深度
二选一：实线边框或轻阴影。**已批准例外**（记录于实现）：
- Sidebar `variant="floating"`：圆角 + `--sidebar-border` 边框 + `--shadow-lg`（shadow-lg
  语义 token）——它整体悬浮于页面底面之上，属"浮层"而非"平面卡片"。
- SidebarInset `variant="inset"`：圆角 + `--shadow-sm`、无边框——同理，内嵌面板浮于底面。
- Tabs 激活态在 `bg-background` 之上用 `shadow-sm` 标示"抬起的一层"（状态性阴影，非装饰）。

**The Flat-By-Default Rule.** 静止态一律扁平。卡片（Card）静止态只有 1px 边框、无阴影
（`shadow-sm` 已从 Card 移除，遵守 Border-OR-Shadow）。阴影只在元素真正脱离底面（浮层
走 `--shadow-lg`）或响应 hover/激活时出现，且必须引用 `--shadow-*` 语义 token，不得
散布硬编码阴影。

---

## 3. Typography

**Font:** 'Inter Variable'（ui-sans-serif/system-ui fallback）+ 'JetBrains Mono'（mono）。
主字族一个，三级权重。

**Character:** Inter 是一款人文 grotesque——比 Helvetica/Geist 更友好，比纯人文体更干净。
更大的 x-height 让中英混排基线更一致，数字对齐整齐。

### Hierarchy（真实派生：`--font-size-base` = 0.875rem）

- **Display**（600, 2xl = 1.5rem / 24px, leading-tight 1.25, -0.02em）：页面主标题，每屏
  一处。固定 rem，非流体。
- **Title**（600, lg = 1.0625rem / 17px, 1.4, -0.01em）：区块标题、卡片标题、Dialog 标题。
- **Body**（400, base = 0.875rem / 14px, leading-relaxed 1.625）：正文与表单。中文混排行
  高 ≥1.6 保证呼吸感。
- **Label**（500, xs = 0.75rem / 12px, 0.01em）：导航分组标题、表单 label、徽标。UPPERCASE
  仅用于 ≤4 字短标签。

### Named Rules

**The One Family Rule.** 全项目一主字族（Inter Variable）+ 权重对比做层级。mono 只用于
代码/日志。不引入第三字族。

**The No-Gray-Body Rule.** 正文用 `--foreground`，次级正文用 `--muted-foreground`。全部
十种主题×模式组合由 `scripts/check-contrast.mjs` 强制 ≥4.5:1（亮色承诺 ≥5:1），绝不靠
更浅的灰显优雅。

---

## 4. Elevation

系统接近扁平。深度靠边框与间距传达，而非阴影。卡片、输入框静止态一律只有 1px 边框，
无阴影。

### Shadow Vocabulary（全部经语义 token 引用）

- **Popover Lift**（`--shadow-lg`）：Dialog / Sheet / Drawer / Popover / 下拉菜单 /
  floating Sidebar——真正脱离底面的浮层。blur ≤16px。
- **Hover/Active Lift**（`--shadow-md`）：仅在 hover 或激活时提升的元素。
- **Hairline Lift**（`--shadow-sm`）：Tabs 激活态、inset Sidebar 的"抬起一层"。
- **无卡片静态阴影**：卡片静止态扁平，只有边框。
- **遮罩**：`--overlay`（前景色 42% 半透明 / 回退半透明黑）统一 Dialog/Sheet/Drawer/
  AlertDialog 的遮罩层，组件内禁止再散布 `bg-black/50`。

---

## 5. Components

组件清单即实现：`src/components/ui/`（57 个文件，全部经 `src/index.ts` 具名导出，
tree-shakeable）。结构类：accordion, alert-dialog, alert, aspect-ratio, avatar, badge,
breadcrumb, button-group, button, calendar, card, carousel, chart, checkbox, collapsible,
combobox, command, context-menu, dialog, direction, drawer, dropdown-menu, empty, field,
form, hover-card, input-group, input-otp, input, item, kbd, label, menubar, native-select,
navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select,
separator, sheet, sidebar, skeleton, slider, sonner, spinner, switch, table, tabs, textarea,
toggle-group, toggle, tooltip。

### Buttons

- **Shape:** 10px 圆角（rounded-lg），36px 高，px-4。
- **Primary:** 品牌色底 + `--primary-foreground` 字。Hover 加深（`--primary-hover`），
  focus-visible ring，active 微下移。
- **Outline / Ghost / Link / Destructive:** 与 shadcn new-york v4 语义一致；Destructive
  用 `--destructive` 实底 + 暗色墨字（暗色模式 `--destructive-foreground` 反转为底色）。

### Badges / Alerts（状态语义）

- Badge 变体：default / secondary / destructive / outline / ghost / link + **success /
  warning / info**（对接 `--state-*-surface/foreground/border` 三元组）。
- Alert 变体：default / destructive + **success / warning / info**（同上，软色底配方）。
- 状态不只靠颜色：必须配图标或文字。

### Cards / Containers

- **Corner Style:** 14px（rounded-xl = radius + 4px），容器最大到 2xl+。
- **Background:** `--card`（近白，在微染底色上形成分层）。
- **Border:** 1px `--border`。**Shadow:** 静止态无（The Border-OR-Shadow Rule）。
- **Padding:** 24px（p-6）。

### Inputs / Fields

- 1px `--input` 描边，透明底，10px 圆角，36px 高。
- Placeholder：`--muted-foreground`（对比门禁覆盖）。
- Focus：品牌色 ring。Error：`--destructive` 边框 + ring。Disabled：opacity-50。

### Dialog / Select 实现契约

- **Dialog 滚动**：`DialogContent` 只负责定位与高度上限（`max-h ≤ 100dvh`），
  长内容滚动收在内层 `[data-slot=dialog-content-scroll]`——右上角关闭按钮因此
  常驻不随内容滚出视口。
- **Select 弹层**：默认 `position="popper"`（与 shadcn v4 上游一致，悬浮于触发器
  下方）；`item-aligned` 是显式 opt-in，不再是默认值。

### Navigation (Sidebar)

- 宽度 `--sidebar-width`（`--sidebar` 底、`--sidebar-border` 边框）。variant：default /
  floating（圆角+边框+`--shadow-lg`，见例外）/ inset（`--shadow-sm`）。
- Items：默认 `--sidebar-foreground`；hover/active `--sidebar-accent` 底。8px 圆角。
- 分组标题：Label 级（`--muted-foreground`）。折叠 icon 态、移动端 Sheet 化、键盘快捷键
  （`Ctrl/Cmd+B`）完整。
- Skeleton 占位宽度由 `React.useId()` 哈希决定（SSR 稳定，不使用 Math.random）。

### 内建文案（zh-CN 默认，可覆盖）

组件自带的 sr-only / aria 文案统一走 `UITextProvider`（`src/components/ui/ui-text.tsx`，
zh-CN 默认值 `defaultUIText`）：Dialog/Sheet 关闭按钮、Spinner 状态、Pagination 上下页、
Carousel 幻灯片、Sidebar 开合与移动端标题、CommandDialog 标题、Breadcrumb 省略。应用按
实例 props 覆盖仍优先生效（向后兼容）。

---

## 6. Accessibility Gates（文档即门禁）

- **对比度**：`scripts/check-contrast.mjs` 把 OKLCH 换算成 WCAG 相对亮度，验证 5 主题 ×
  亮暗 × 25 关键前景/背景对（250 对）全部 ≥4.5:1，接入 `pnpm lint`。这是 P1-1 的防回潮
  机制——warning 亮色曾以 L=0.60 落在 ~4:1，修复为 0.55 后全矩阵绿。
- **主题契约**：`scripts/check-theme-contracts.mjs` 保证注册表 / 无闪烁守卫 / theme.css
  块 / 本文档四方一致。
- **Tailwind 契约**：`scripts/check-tailwind-preset.mjs` 用真实编译器断言映射层生效。
- **键盘/读屏**：交互组件 focus-visible ring；Dialog/Sheet 关闭、Pagination、Carousel、
  Sidebar、Command 均有可配置 aria 文案。
- **减弱动效**：全局 `@media (prefers-reduced-motion: reduce)` 降级 + 主题切换交叉淡入
  （`html.theme-transitioning`，320ms）对 reduced-motion 用户瞬切。

---

## 7. Do's and Don'ts

### Do:
- **Do** 用饱和且出人意料的强调色建立辨识度（The Color Personality Rule）。默认夜靛，
  备选翠微/墨金/紫微/墨白——避开企业蓝/灰的安全牌。
- **Do** 侧栏保持亮色（品牌色微染），不做沉重深色侧栏（The Light Sidebar Rule）。
- **Do** 内容区用三层 tonal 色彩建立空间深度（The Tonal Canvas Rule）。
- **Do** 次级正文用 `--muted-foreground`（门禁保证 ≥4.5:1，亮色 ≥5:1），正文用
  `--foreground`（The No-Gray-Body Rule）。
- **Do** 卡片静止态只留 1px 边框；阴影只给浮层且引用 `--shadow-*` token（The
  Flat-By-Default Rule）。
- **Do** 遮罩统一用 `--overlay`；状态用 `--state-*` 三元组；骨架用 `--skeleton-base`。
- **Do** 三界面共享同一套 token、同一字族、同一组件语义。
- **Do** 状态指示配图标或文字，不只靠颜色。图表用色盲安全五色。
- **Do** 每个主题的亮暗双模式同等调校；每个动画提供 `prefers-reduced-motion` 降级。
- **Do** 新增主题时同步四处：variants.ts、theme.css、theme-init.js、DESIGN.md（lint
  门禁会拦截遗漏）。

### Don't:
- **Don't** 用 Ant Design 紧凑观感。
- **Don't** 用沉闷企业蓝或冷硬运维终端。
- **Don't** 用毛玻璃卡片、渐变文字、32px+ 超大圆角卡片。
- **Don't** 给同一元素同时加 1px 边框和装饰性 drop shadow——浮层例外见 Named Rules。
- **Don't** 硬编码颜色（`bg-black/50`、`bg-white`、裸 hex）；一律走语义 token 或
  `--token` 任意值引用（lint: shadcn/no-raw-colors）。
- **Don't** 把品牌色铺满界面——它不稀缺就不再是信号。
- **Don't** 嵌套卡片。
- **Don't** 用默认浅灰占位符文本——占位符也要 4.5:1。
- **Don't** 正文 ALL CAPS 长句；uppercase 只给 ≤4 字短标签。
- **Don't** 用第二个主字族——Inter Variable + 权重对比足够。
- **Don't** 默认暖中性米色/沙色底（chroma 0.01+）。品牌微染底（chroma ≤0.016）是设计，
  米色底是将就。

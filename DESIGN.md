---
name: WorkPaw
description: 企业级私有化多用户 AI 智能体平台 — 三主题设计系统
colors:
  indigo-primary: "oklch(0.55 0.18 265)"
  indigo-primary-hover: "oklch(0.45 0.18 265)"
  indigo-bg: "oklch(0.99 0.003 80)"
  amber-primary: "oklch(0.62 0.16 72)"
  amber-bg: "oklch(0.98 0.008 75)"
  sky-primary: "oklch(0.68 0.14 235)"
  sky-bg: "oklch(1 0 0)"
  ink: "oklch(0.15 0.003 80)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
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
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "oklch(0.985 0 0)"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  input-text:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
  chip:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: WorkPaw

## 1. Overview

**Creative North Star: "色彩个性"**

WorkPaw 的辨识度来自**饱和且出人意料的强调色**，不靠沉重的深色侧栏。默认主题是薰衣草紫——2026 企业软件最少被滥用的强调色。它轻盈、不压抑，但有强烈的色彩主张：用户打开第一眼就知道"这不是又一个蓝灰色的企业工具"。

三主题体系（薰衣草 / 翡翠 / 珊瑚）覆盖紫、绿、暖红三个色相区间，全部亮色为主、侧栏保持轻盈。灵感来自 tweakcn 预设（amethyst haze / sage garden / solar dusk）。

这套系统的气质是「轻盈 · 明快 · 友好」的当代表达：饱和强调色提供戏剧性的第一眼（明快），品牌色微染的 tonal 分层建立舒适的空间深度（轻盈），出人意料的色彩选择让人愿意停留（友好）。

**Key Characteristics:**
- **色彩个性优先**：辨识度 = 强调色的选择，不是侧栏的明暗。薰衣草紫是默认签名——企业海里几乎没人用紫色做主色。侧栏保持亮色（品牌色微染），绝不压抑
- **Tonal 三层表面**：内容区通过色彩亮度区分层次——微染白底色 → 品牌 tint 区块 → 纯白卡片浮起，不需要阴影就能建立空间深度
- **品牌色策略 Committed**：品牌色占 ~20-25%，出现在主操作、accent 表面、选中态、hover 微光。比 Restrained（≤10%）更有存在感，但不喧宾夺主
- **一个字族**：Inter Variable，400/500/600 三级权重
- **组件克制但自信**：白卡在 tint 底上浮起，但静止态不加阴影。深度靠色彩，不靠投影

**What we reject（引自 PRODUCT.md）：** Ant Design 紧凑观感、冷硬企业控制台、过度装饰 SaaS、沉闷企业蓝、AI-SaaS 暖中性底色、等大卡片网格

---

## 2. Themes

WorkPaw 提供三个主题，用户可在设置中切换。每个主题是完整的亮/暗双模式体系。`data-theme` 属性控制主题，`.dark` class 控制模式。

```
:root                                 → indigo light（默认，无 data-theme 属性）
:root.dark                            → indigo dark
:root[data-theme="amber"]             → amber light
:root[data-theme="amber"].dark        → amber dark
:root[data-theme="sky"]               → sky light
:root[data-theme="sky"].dark          → sky dark
```

### 2.1 Indigo Studio（默认）

**场景句**：日常办公，需要专注但不想被界面压迫。靛蓝像一本认真排过版的书——安静但不冷。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.55 0.18 265)` | `oklch(0.65 0.16 265)` |
| `--primary-hover` | `oklch(0.45 0.18 265)` | `oklch(0.55 0.18 265)` |
| `--background` | `oklch(0.99 0.003 80)` | `oklch(0.19 0.012 265)` |
| `--foreground` | `oklch(0.15 0.003 80)` | `oklch(0.93 0.003 80)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.23 0.01 265)` |
| `--secondary` | `oklch(0.965 0.004 80)` | `oklch(0.26 0.01 265)` |
| `--muted` | `oklch(0.965 0.004 80)` | `oklch(0.26 0.01 265)` |
| `--muted-foreground` | `oklch(0.45 0.008 80)` | `oklch(0.68 0.006 80)` |
| `--accent` | `oklch(0.95 0.02 265)` | `oklch(0.28 0.05 265)` |
| `--accent-foreground` | `oklch(0.35 0.12 265)` | `oklch(0.93 0.003 80)` |
| `--border` | `oklch(0.91 0.006 80)` | `oklch(0.93 0.003 80 / 0.12)` |
| `--input` | `oklch(0.91 0.006 80)` | `oklch(0.93 0.003 80 / 0.16)` |
| `--radius` | `0.625rem` | — |

**性格**：微暖白底 + 靛蓝信号。底色 chroma 0.003 toward 80——不是纯白，不是米色，是"纸色"。靛蓝在蓝和紫之间找到自己的区间，区别于企业蓝海和开发者绿。

### 2.2 Amber Desktop

**场景句**：下午三四点，想要一点温暖。琥珀像台灯下的工作桌——亲密、专注、不冷。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.62 0.16 72)` | `oklch(0.7 0.15 72)` |
| `--primary-hover` | `oklch(0.52 0.16 72)` | `oklch(0.6 0.15 72)` |
| `--background` | `oklch(0.98 0.008 75)` | `oklch(0.19 0.015 60)` |
| `--foreground` | `oklch(0.16 0.005 75)` | `oklch(0.93 0.005 75)` |
| `--card` | `oklch(0.99 0.005 75)` | `oklch(0.23 0.01 60)` |
| `--secondary` | `oklch(0.96 0.008 75)` | `oklch(0.26 0.01 60)` |
| `--muted` | `oklch(0.96 0.008 75)` | `oklch(0.26 0.01 60)` |
| `--muted-foreground` | `oklch(0.44 0.01 75)` | `oklch(0.68 0.008 75)` |
| `--accent` | `oklch(0.94 0.04 75)` | `oklch(0.28 0.06 72)` |
| `--accent-foreground` | `oklch(0.35 0.12 72)` | `oklch(0.93 0.005 75)` |
| `--border` | `oklch(0.90 0.01 75)` | `oklch(0.93 0.005 75 / 0.12)` |
| `--input` | `oklch(0.90 0.01 75)` | `oklch(0.93 0.005 75 / 0.16)` |
| `--radius` | `0.625rem` | — |

**性格**：淡奶油底 + 琥珀信号。三主题中最大胆——在蓝/绿主宰的企业工具海里是明确的差异化。中性阶全部偏向 hue 75，与琥珀同家族。暗色模式是暖炭底，琥珀像烛光。

### 2.3 Sky Canvas

**场景句**：早晨，需要清醒和高效。天蓝像落地窗前的开放办公区——通透、明亮、无压力。

| Token | Light | Dark |
|-------|-------|------|
| `--primary` | `oklch(0.68 0.14 235)` | `oklch(0.72 0.12 235)` |
| `--primary-hover` | `oklch(0.58 0.14 235)` | `oklch(0.62 0.12 235)` |
| `--background` | `oklch(1 0 0)` | `oklch(0.19 0.008 240)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.93 0.004 240)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.23 0.006 240)` |
| `--secondary` | `oklch(0.97 0.003 240)` | `oklch(0.26 0.006 240)` |
| `--muted` | `oklch(0.97 0.003 240)` | `oklch(0.26 0.006 240)` |
| `--muted-foreground` | `oklch(0.446 0 0)` | `oklch(0.68 0.005 240)` |
| `--accent` | `oklch(0.95 0.02 235)` | `oklch(0.28 0.05 235)` |
| `--accent-foreground` | `oklch(0.35 0.12 235)` | `oklch(0.93 0.004 240)` |
| `--border` | `oklch(0.92 0.004 240)` | `oklch(0.93 0.004 240 / 0.12)` |
| `--input` | `oklch(0.92 0.004 240)` | `oklch(0.93 0.004 240 / 0.16)` |
| `--radius` | `0.5rem` | — |

**性格**：纯白底 + 天蓝信号。"轻盈·明快"的最直接表达。冷调中性阶（hue 240），干净通透。圆角比其他主题略小（8px），更利落。

### 2.4 Shared Tokens（跨主题常量）

这些 token 不随主题变化，定义在基础 `:root` 上：

| Token | Value | Notes |
|-------|-------|-------|
| `--primary-foreground` | `oklch(0.985 0 0)` | 品牌色上的文字（近白），所有主题统一 |
| `--ring` | `--primary`（动态） | 聚焦环跟随品牌色 |
| `--destructive` | `oklch(0.577 0.245 27.325)` light / `oklch(0.65 0.2 22)` dark | |
| `--success` | `oklch(0.55 0.15 155)` light / `oklch(0.68 0.15 155)` dark | |
| `--warning` | `oklch(0.6 0.16 70)` light / `oklch(0.72 0.16 70)` dark | |
| `--info` | `oklch(0.55 0.14 240)` light / `oklch(0.65 0.14 240)` dark | |
| `--chart-1` | `--primary`（动态） | 图表主序列跟随品牌色 |
| `--chart-2` | `oklch(0.6 0.18 320)` | 紫 |
| `--chart-3` | `oklch(0.65 0.18 45)` | 橙 |
| `--chart-4` | `oklch(0.55 0.19 12)` | 红 |
| `--chart-5` | `oklch(0.6 0.12 195)` | 青 |
| `--shadow-sm` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | |
| `--shadow-md` | `0 4px 8px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)` | |
| `--shadow-lg` | `0 8px 16px -4px rgb(0 0 0 / 0.10), 0 4px 6px -2px rgb(0 0 0 / 0.05)` | |

### Named Rules

**The Color Personality Rule.** WorkPaw 的辨识度来自强调色的选择，不靠深色侧栏。默认主题用薰衣草紫（`oklch(0.55 0.22 295)`）——企业软件海里几乎没人用紫色做主色，这是记忆锚点。三主题（薰衣草/翡翠/珊瑚）覆盖紫、绿、暖红三个不常见的色相区间。绝不退回安全的企业蓝/灰。

**The Light Sidebar Rule.** 侧栏保持亮色（品牌色微染，L≈0.98），不做成沉重压抑的深色块。深色侧栏是 Slack/Discord 时代的老套路，且在密集配置界面中压迫感强。辨识度交给色彩个性，不交给侧栏明暗。

**The Tonal Canvas Rule.** 内容区通过三层色彩亮度建立空间深度，不需要阴影：底色（`--background`，品牌色微染白）→ 区块/次级表面（`--secondary`，品牌色调 tint）→ 卡片/浮层（`--card`，纯白）。用户能感知到卡片在"上面"，但说不清为什么——这是色彩层次，不是投影层次。

**The Border-OR-Shadow Rule.** 同一元素不可同时有 1px 边框 + 装饰性 drop shadow。深度二选一：实线边框或 ≤8px 模糊的轻阴影。

**The Flat-By-Default Rule.** 静止态一律扁平。卡片在白底上的浮起感由 Tonal Canvas 的色彩层次提供，不由阴影提供。阴影只在元素真正脱离底面（浮层）或响应 hover 聚焦时出现。

---

## 3. Typography

**Font:** 'Inter Variable' (sans-serif fallback)。一个字族，三级权重。

**Character:** Inter 是一款人文 grotesque——比 Helvetica/Geist 更友好，比纯人文体更干净。更大的 x-height 让中英混排基线更一致，数字对齐整齐。Figma、GitHub、Vercel 的选择。

### Hierarchy

- **Display**（600, 1.5rem / 24px, 1.3, -0.02em）：页面主标题。每屏一处。固定 rem，非流体（Product 寄存器：工具界面不需要流体标题）。
- **Title**（600, 1.0625rem / 17px, 1.4, -0.01em）：区块标题、卡片标题、Dialog 标题。
- **Body**（400, 0.875rem / 14px, 1.6）：正文与表单。行宽控制在 65–75ch。中文混排时行高 1.6 保证足够呼吸感。
- **Label**（500, 0.75rem / 12px, 0.01em）：导航分组标题、表单 label、徽标。UPPERCASE 仅用于 ≤4 字短标签。

### Named Rules

**The One Family Rule.** 全项目一字族（Inter Variable）+ 权重对比做层级。不引入第二字族。

**The No-Gray-Body Rule.** 正文用 `--foreground`，次级正文用 `--muted-foreground`（所有主题亮色模式下对比 ≥5:1），绝不靠更浅的灰显优雅。

---

## 4. Elevation

系统接近扁平。深度靠边框与间距传达，而非阴影。卡片、按钮、输入框静止态一律只有 1px 边框，无阴影。

### Shadow Vocabulary

- **Popover Lift**（`:root` 的 `--shadow-lg`）：Dialog / Popover / Sheet / 下拉菜单——真正脱离底面的浮层。blur ≤16px。
- **Hover Lift**（`:root` 的 `--shadow-md`）：仅在 hover 时提升的元素（如可拖拽卡片、悬浮预览）。
- **无卡片静态阴影**：卡片静止态扁平，只有边框。

---

## 5. Components

### Buttons

- **Shape:** 10px 圆角（rounded-lg），36px 高（比旧 32px 更疏朗），px-4。
- **Primary:** 品牌色底 + `--primary-foreground` 白字。Hover 色相加深（`--primary-hover`），focus-visible 3px ring，active 微下移。
- **Outline:** 透明底 + `--border` 边框 + `--foreground` 字；hover 转 `--secondary` 底。
- **Ghost:** 透明底；hover `--secondary` 底。导航、工具栏。
- **Destructive:** `--destructive` 10% 透明底 + destructive 文字；hover 20%。不整块红。
- **Link:** 品牌色文字 + underline-offset；hover 下划线。

### Chips / Badges

- **Style:** `--secondary` 底 + `--foreground` 字，6px 圆角，px-2 py-0.5。
- **Status:** 状态 chip 可用 `--accent` 底 + `--accent-foreground` 字。状态不只靠颜色，必须配图标或文字。

### Cards / Containers

- **Corner Style:** 12px（rounded-xl），不超 16px。
- **Background:** `--card`（纯白，在微暖底色上形成分层）。
- **Border:** 1px `--border`。
- **Shadow:** 静止态无阴影。嵌套卡片永远禁止。
- **Padding:** 24px（p-6）。

### Inputs / Fields

- **Style:** 1px `--border` 描边，透明底，10px 圆角（rounded-lg，与按钮统一），36px 高，px-3。
- **Placeholder:** `--muted-foreground`（保 4.5:1 对比）。
- **Focus:** 品牌色边框 + 3px ring。
- **Error:** `--destructive` 边框 + ring。
- **Disabled:** opacity-50。

### Navigation (Sidebar)

- **Style:** 240px 宽，`--sidebar` 底，`--sidebar-border` 右边框。
- **Items:** 默认 `--sidebar-foreground`；hover `--sidebar-accent` 底；active `--sidebar-accent` 底 + `--sidebar-accent-foreground` 字。8px 圆角（rounded-md）。
- **分组标题:** Label 级（`--muted-foreground`，uppercase tracking，短标签）。

### Agent Selector (Signature)

顶部胶囊 Select，展示当前操作目标 Agent。品牌绿勾选标记是品牌色在导航中的合法出场点之一。空态、禁用态、加载态完整。

---

## 6. Do's and Don'ts

### Do:
- **Do** 用饱和且出人意料的强调色建立辨识度（The Color Personality Rule）。默认薰衣草紫，备选翡翠绿、珊瑚红——避开企业蓝/灰的安全牌。
- **Do** 侧栏保持亮色（品牌色微染），不做沉重深色侧栏（The Light Sidebar Rule）。辨识度靠色彩个性，不靠侧栏明暗。
- **Do** 内容区用三层 tonal 色彩建立空间深度（The Tonal Canvas Rule）：底色 → 区块 tint → 白卡浮起。
- **Do** 次级正文用 `--muted-foreground`（对比 ≥5:1 light / ≥4.5:1 dark），正文用 `--foreground`（The No-Gray-Body Rule）。
- **Do** 卡片静止态只留 1px 边框，扁平无阴影；阴影只给浮层（The Flat-By-Default Rule）。
- **Do** 三界面共享同一套 token、同一字族（Inter Variable）、同一组件语义。
- **Do** 状态指示配图标或文字，不只靠颜色。图表用色盲安全五色。
- **Do** 每个主题的亮暗双模式同等调校。
- **Do** 每个动画提供 `prefers-reduced-motion` 降级。

### Don't:
- **Don't** 用 Ant Design 紧凑观感。
- **Don't** 用沉闷企业蓝或冷硬运维终端。
- **Don't** 用毛玻璃卡片、渐变文字、32px+ 超大圆角卡片。
- **Don't** 给同一元素同时加 1px 边框和装饰性 drop shadow（The Border-OR-Shadow Rule）。
- **Don't** 把品牌色铺满界面——它不稀缺就不再是信号。
- **Don't** 嵌套卡片。
- **Don't** 用默认浅灰占位符文本——占位符也要 4.5:1。
- **Don't** 正文 ALL CAPS 长句；uppercase 只给 ≤4 字短标签。
- **Don't** 用第二个字族——Inter Variable + 权重对比足够。
- **Don't** 默认暖中性米色/沙色/奶油色底（chroma 0.01+）。微暖白是 chroma 0.003，不是米色。

---
name: WorkPaw
description: 企业级私有化多用户 AI 智能体平台 — 精密控制台设计语言
colors:
  brand-green: "oklch(0.78 0.16 162)"
  brand-green-deep: "oklch(0.66 0.15 162)"
  ink: "oklch(0.145 0 0)"
  canvas: "oklch(1 0 0)"
  surface: "oklch(1 0 0)"
  mist: "oklch(0.97 0 0)"
  mist-ink: "oklch(0.446 0 0)"
  hairline: "oklch(0.922 0 0)"
  danger: "oklch(0.577 0.245 27.325)"
  chart-orange: "oklch(0.715 0.183 49.77)"
  chart-purple: "oklch(0.6 0.18 280)"
  chart-green: "oklch(0.65 0.16 160)"
  chart-red: "oklch(0.62 0.19 12)"
  chart-blue: "oklch(0.7 0.15 230)"
typography:
  display:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "clamp(1.625rem, 2.6vw, 2.125rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Geist Variable', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  2xl: "18px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-green}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.brand-green-deep}"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  input-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  nav-item-active:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
  chip:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: WorkPaw

## 1. Overview

**Creative North Star: "精密控制台"**

WorkPaw 的三块界面——桌面对话端、Web 配置面、管理后台——共享同一张控制台桌面的语言。精密的网格与刻度是骨架,品牌绿是仪表盘上唯一的提示灯。它是帮人做事的工具,不是炫技的展品。

这套系统的气质是「精密·温暖·克制」:工程感的骨架(一致的网格、清晰的字号层级、精确的对齐、可信但不拥挤的信息密度),温度感的表面(克制的微交互、被恰当使用的品牌绿、不冷漠的文案),克制的实现(没有毛玻璃、没有渐变文字、没有营销式 Hero)。控制台不靠装饰建立信任,它靠"每一处都经得起推敲"建立信任。用户打开它时感到的是"这是一个帮我的工具,不是一个监视我的系统"。

这套系统明确拒绝四样东西(引自 PRODUCT.md):QwenPaw 的 Ant Design 紧凑观感(功能照搬,气质重塑,用 Shadcn + base-ui 的更扁平、更克制节奏替代 AntD);泛 AI-SaaS 米色暖中性底色(底色保持真正中性白,不向暖色默认倾斜);冷硬运维终端(admin 不是 Grafana 式密集低对比纯数据后台,保持可亲、有层级);时髦玻璃/渐变 SaaS(不要毛玻璃卡片、渐变文字、超大圆角卡片、营销式 Hero)。三块界面信息密度取向是"更疏朗可读"——优先读得进去,而非塞得满。

**Key Characteristics:**
- 精密控制台骨架:中性白底 + ink 深字 + 细发丝线分隔,深度靠 tonal 层级而非阴影。
- 单一信号色:品牌绿是全界面唯一的彩色强调,出现在主操作、关键状态、聚焦环;其余全是中性灰 ramp。
- 疏朗可读:行高 1.6、留白充足、表格不拥挤,避开 AntD 紧凑与运维终端密集两个极端。
- 三界面一套语言:desktop / web / admin 共享同一套 token、组件语义、排版与间距节奏,跨界面切换无割裂感。
- 双模式完整:亮色为主场,暗色为运维/夜间场景同等调校,橙在暗底保持可读。

## 2. Colors

调色板是「一块中性灰画布 + 一盏绿色信号灯」。中性 ramp 用 chroma 0 的真正灰(不向暖不向冷),把所有彩色权重让给品牌绿,让它在任何屏幕上都只占 ≤10% 面积——它的稀缺才是它被看见的原因。

### Primary
- **品牌绿 / Brand Green** (oklch(0.78 0.16 162),#3ECF8E):全界面唯一的主操作色,沿用 Supabase 的开发者工具身份锚点。主按钮填充、聚焦环、当前选中 Agent 勾选标记、关键状态点、图表主序列。明度 0.78、彩度 0.16,让它在企业中性白底上不刺眼,在暗底上不发灰。三前端(workpaw-web / workpaw-desktop / workpaw-control-plane/console)的 `index.css` 均通过 `@import "workpaw-ui/theme.css"` 引用此绿,`--primary` 在所有主题统一取值、无独立覆盖(品牌锚点)。原 QwenPaw 的 #FF7F16 橙色已退出品牌体系,仅保留为图表辅色 chart-3。
- **Brand Green Deep** (oklch(0.66 0.15 162)):主按钮 hover/active 的色相加深态。比透明浅化(bg-primary/80)更有工程感、更稳。

### Neutral
- **Ink** (oklch(0.145 0 0)):正文与标题前景色。近黑而非纯黑,在白底上对比 ~15:1,远超 AA。
- **Canvas** (oklch(1 0 0)):界面底色。真正中性白,chroma 0,不向暖色偏。这是显式拒绝"泛 AI-SaaS 米色"的承诺。
- **Surface / Card** (oklch(1 0 0)):卡片与弹层底色。当前与 Canvas 同值——深度靠边框与间距区分,不靠 tonal 差异(克制取向)。
- **Mist** (oklch(0.97 0 0)):次级填充——hover 态、muted 背景、active 导航底、chip 底。
- **Mist Ink** (oklch(0.446 0 0)):次级正文/标签前景。Shadcn 默认 0.556 在白底对比仅 ~4.6:1,边界值且常被用于正文,不达标。已上调到 0.446(对比 ~7:1)满足 AA 并向 ink 端收拢,消除"muted 灰正文读不清"的 AI 通病。
- **Hairline** (oklch(0.922 0 0)):边框与输入框描边。1px,中性,不抢戏。
- **Danger** (oklch(0.577 0.245 27.325)):破坏性操作。destructive 变体当前是 10% 透明底 + danger 文字(克制,不整块红),正确。

### Data
- 图表序列:品牌绿(主,chart-1)+ chart-orange(49,退役品牌橙留作辅色)/ chart-purple(280)/ chart-red(12)/ chart-blue(230)。四辅色围绕色环分散,色盲安全(明度差足够区分),不与品牌绿撞色相。

### Semantic
- **Success** (oklch(0.52 0.15 160) light / 0.72 dark)、**Warning** (oklch(0.55 0.14 65) / 0.78)、**Info** (oklch(0.52 0.14 230) / 0.72)、**Destructive** (既有,red)。语义状态色,全主题统一(同 `--primary`),与 One Signal Rule 不冲突:那条针对装饰性彩色强调,语义状态色是另一维度。状态指示不只靠颜色,必须配图标/文字(色盲安全)。Error 复用 `--destructive`,不另立 red token。

### Named Rules
**The One Signal Rule.** 品牌绿是全界面唯一的彩色强调,任何给定屏幕占比 ≤10%。它的稀缺是被看见的前提——把它铺满,它就不再是信号,成了噪音。
**The True-Neutral Rule.** 中性 ramp 一律 chroma 0(standard)或极低彩度冷调(supabase,chroma 0.003–0.005 hue 264),不向暖、不向冷偏、不向品牌绿微染。暖中性底色(米色/沙色/奶油)是 2026 饱和 AI 默认,显式拒绝。"温度"由品牌绿 + 排版 + 文案承载,不由底色承载。
**The Border-OR-Shadow Rule.** 同一元素不可同时有 1px 边框 + 装饰性 drop shadow(这是 codex 的 ghost-card tell)。深度二选一:一条实线边框,或一个 ≤8px 模糊的轻阴影,不叠用。

## 3. Typography

**Display / Body Font:** 'Geist Variable' (sans-serif fallback)
**Label Font:** 同 Geist Variable(无独立 label 字族)

**Character:** Geist 是一款工程感的几何 grotesque,字宽克制、x-height 适中、数字对齐整齐——契合「精密控制台」的刻度感。一个字族用多权重(400/500/600)做层级,比三个字族竞争更干净。

### Hierarchy
- **Display** (600, clamp(1.625rem, 2.6vw, 2.125rem) ≈ 26–34px, 1.2, -0.02em):页面主标题。仅每屏一处,desktop 容器标题/登录页标题。
- **Title** (600, 1.125rem / 18px, 1.4, -0.01em):区块标题、卡片标题、Dialog 标题。当前 CardTitle 即此。
- **Body** (400, 0.9rem / ~14.4px, 1.6):正文与表单。行高 1.6 保证疏朗可读;正文行宽控制在 65–75ch。当前代码 base 是 text-sm(14px),疏朗方向建议微抬到 ~14.4–15px。
- **Label** (500, 0.75rem / 12px, 0.01em):导航分组标题、表单 label、徽标。短标签可用,不用于正文。

### Named Rules
**The One Family Rule.** 全项目一个字族(Geist Variable)+ 权重对比做层级。当前 workpaw-desktop 用 'Inter Variable'、workpaw-web/admin 用 'Geist Variable',三界面字族不一致,需统一到 Geist(2/3 已用,且更工程感),落实「一套语言三个界面」。
**The No-Gray-Body Rule.** 正文与次级正文一律用 Ink 或 Mist Ink,绝不靠"更浅的灰显优雅"。Mist Ink 已上调到 0.446 保 AA;再浅即违规。
**The Tight-Not-Touching Rule.** Display 字距 ≥ -0.02em,不小于 -0.04em。Geist grotesque 用 -0.02em 刚好收紧不碰触,过紧读作局促。

## 4. Elevation

这套系统接近扁平,深度主要靠 tonal 边界与间距传达,而非阴影。Surface 与 Canvas 同值,卡片与底面靠 1px Hairline 边框和周围留白分离——这是克制取向,不是 Material 的 tonal 抬升,也不是 SaaS 的软投影堆叠。

卡片静止态已落实为 1px Hairline 边框、无阴影(原 Shadcn 的 `shadow-sm` 已移除,兑现 Border-OR-Shadow Rule)。仅悬浮菜单(Dialog/Popover/Sheet)用阴影表达"脱离底面"。

### Shadow Vocabulary
- **Popover Lift** (`box-shadow: 0 4px 16px rgb(0 0 0 / 0.08)`):Dialog / Popover / Sheet / 下拉菜单——真正"脱离底面"的浮层。blur ≤16px,柔和但明确。
- **无卡片静态阴影**:卡片、按钮、输入框静止态一律扁平,只有边框。

### Named Rules
**The Flat-By-Default Rule.** 静止态一律扁平。阴影只在元素真正脱离底面(浮层)或响应状态(hover 提升聚焦)时出现,绝不作为卡片的默认装饰。
**The No-Ghost-Card Rule.** 禁止 1px 边框 + 软投影叠加的 ghost-card 模式。卡片静止态只留 1px 边框、无阴影(已落实)。

## 5. Components

每个组件先一句性格,再给形状、配色、状态。

### Buttons
- **Shape:** 中等圆角(10px, rounded-lg),不超圆。工程感,不萌。
- **Primary:** 品牌绿底 + Canvas 白字,32px 高(疏朗方向 36px),px-3。当前 hover 是 `/80` 透明浅化,建议改为 Brand Green Deep 色相加深(更稳更工程)。focus-visible 用 3px ring-ring/50。
- **Hover / Focus:** hover 色相加深(Brand Green Deep);focus-visible 出 ring-ring/50;active 微下移 translate-y-px(已有)。transition-all 平滑。
- **Outline:** Canvas 底 + Hairline 边框 + Ink 字;hover 转 Mist 底。次级主操作。
- **Ghost:** 透明底;hover Mist 底。导航、工具栏。
- **Destructive:** danger 10% 透明底 + danger 文字;hover 20%。克制,不整块红。删除、强制停止实例。
- **Link:** 品牌绿文字 + underline-offset;hover 下划线。

### Chips / Badges
- **Style:** Mist 底 + Ink 字,6px 圆角(rounded-sm),px-2 py-0.5。状态 chip 可用品牌绿 tint 底 + Brand Green Deep 字。
- **State:** 选中/未选中、启用/禁用、状态标签。状态不只靠颜色,配图标或文字(色盲安全)。

### Cards / Containers
- **Corner Style:** 14px(rounded-xl),不超 16px。
- **Background:** Surface(= Canvas 白)。
- **Border:** 1px Hairline。
- **Shadow Strategy:** 静止态无阴影(见 Elevation 的 No-Ghost-Card Rule,待移除当前 shadow-sm)。
- **Internal Padding:** 24px(p-6)。疏朗。嵌套卡片永远禁止。

### Inputs / Fields
- **Style:** 1px Hairline 描边,透明底,8px 圆角(rounded-md),36px 高,px-3。占位符用 Mist Ink(不是默认浅灰,保 4.5:1)。
- **Focus:** 1px ring-ring(品牌绿)聚焦环,边框转品牌绿。
- **Error / Disabled:** aria-invalid 转 danger 边框 + ring;disabled opacity-50。

### Navigation (Sidebar)
- **Style:** 240px 宽,Canvas/Sidebar 底,Hairline 右边框。分组标题 Label 级(Mist Ink,uppercase tracking,短标签)。
- **Default / Hover / Active:** 默认 Ink/70;hover Mist/50 底;active Mist 底 + Ink 字。10px 圆角,px-3 py-2。当前已实现,节奏正确。
- **Agent Selector:** 顶部 Select,品牌绿勾选当前选中项——这是品牌绿在导航里的合法出场点之一。

### Agent Selector (Signature)
顶部胶囊 Select,展示当前操作目标 Agent。切换即改全局 X-Agent-Id。空态、禁用态、加载态完整。它是"配置面 → 用起来"工作流的关键握手点,值得打磨。

## 6. Do's and Don'ts

### Do:
- **Do** 让品牌绿是任何屏幕上唯一的彩色强调,占比 ≤10%(The One Signal Rule)。主按钮、聚焦环、当前选中勾选、关键状态点是它的合法位置。
- **Do** 用真正中性白(oklch(1 0 0))做底,chroma 0,不向暖色偏(The True-Neutral Rule)。温度由橙与文案承载,不由底色承载。
- **Do** 把次级正文前景保持在 Mist Ink(oklch(0.446 0 0),对比 ~7:1),正文用 Ink,绝不靠更浅的灰显优雅(The No-Gray-Body Rule)。
- **Do** 卡片静止态只留 1px Hairline 边框,扁平无阴影;阴影只留给真正脱离底面的浮层(The Flat-By-Default Rule)。
- **Do** 三界面共享同一套 token、同一字族(Geist Variable)、同一组件语义,跨界面切换无割裂(一套语言三个界面)。
- **Do** 状态指示配图标或文字,不只靠颜色,图表用色盲安全四辅色。
- **Do** 亮暗双模式同等调校,品牌绿在暗底保持可读(暗底用稍亮明度)。
- **Do** 每个动画提供 `prefers-reduced-motion` 降级(WCAG AA 硬约束)。

### Don't:
- **Don't** 用 QwenPaw 的 Ant Design 紧凑观感——不抄 AntD 的表单密度、默认配色、组件间距节奏。功能照搬,气质用 Shadcn + base-ui 重塑(PRODUCT.md 反参考)。
- **Don't** 用米色/沙色/奶油色等暖中性底色——这是泛 AI-SaaS 米色,2026 饱和 AI 默认,显式拒绝(PRODUCT.md 反参考)。
- **Don't** 把 admin 做成冷硬运维终端——不要 Grafana 式密集低对比纯数据黑底荧光,保持可亲、有层级、读得下去(PRODUCT.md 反参考)。
- **Don't** 用毛玻璃卡片、渐变文字(background-clip:text + gradient)、32px+ 超大圆角卡片、营销式 Hero 大图模板——时髦玻璃/渐变 SaaS 噪音(PRODUCT.md 反参考)。
- **Don't** 给同一元素同时加 1px 边框和装饰性 drop shadow——ghost-card tell(The Border-OR-Shadow Rule)。卡片已移除 shadow-sm,只留边框。
- **Don't** 把品牌绿铺满界面或用于大面积背景——它一旦不稀缺就不再是信号。
- **Don't** 给中性灰 ramp 加任何色相偏移(不向暖、不向冷、不向橙微染)。
- **Don't** 用三个字族竞争——一个 Geist Variable + 权重对比足够(The One Family Rule)。
- **Don't** 嵌套卡片——卡片内再套卡片永远错。
- **Don't** 用默认浅灰占位符文本——占位符也要 4.5:1 对比。
- **Don't** 在正文中用 ALL CAPS 长句;uppercase 只留给 ≤4 字的短标签和导航分组标题。

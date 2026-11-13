# Changelog — workpaw-ui

格式：Keep a Changelog 简化版（Added / Changed / Fixed，中文）。本仓为**源码包**
（三端以 `file:/link:` 依赖直指 `src/`，无 `dist/` 产物），版本语义 = 包版本
`1.x`（`package.json`）+ 发布链 pinned commit 双轨（仓内暂无 git tag——策略见
`/workspace/docs/VERSIONING.md` §4，tag 化为待办）。三端消费方：workpaw-web、
workpaw-admin/console、workpaw-desktop。

## [1.2.0] - 2026-11-13

### Added

- **组件 fork 漂移守卫**（P0-1① / P1-1）：`scripts/check-component-forks.mjs`
  （`pnpm check:forks`，已入 `pnpm lint`）+ 基线
  `scripts/component-forks-baseline.json`（首线 100 对同名 / 97 fork：web 30、
  desktop 52、admin-console 15）。基线内 hash 变化即 fail；`--write-baseline`
  重生成。`check-ui-stack.mjs` 版本化分发（v2026.11，库侧权威，四端副本头部
  标注"副本"）；README 增「守卫脚本分发约定」。
- **Stepper / StepperStep**（`stepper.tsx`）：分步导航（admin stepper 为功能基准，
  `aria-current="step"` + `aria-controls`），文案走 UIText `stepper` 组。
- **CopyButton**（`copy-button.tsx`）：剪贴板复制按钮（market CopyButton 为行为
  基准：Clipboard API + execCommand 回退、成功 Check、失败不静默、`role="status"`
  播报、2s 复位），文案走 UIText `clipboard` 组；`onCopyResult` 可接 toast。
- **排版桥**（P1-5 / §8 D3）：`@theme inline` 收编 desktop 的 3xs/2xs 桥
  （`--text-3xs/2xs → var(--font-size-3xs/2xs)`）；具名 `text-*` 刻度**保持
  Tailwind 默认**（全量映射会改 text-sm/base/lg 渲染，实证后否决），
  `check-tailwind-preset.mjs` 新增 4 条断言双向锁定。
- playground（`src/main.tsx`）新增 Stepper、CopyButton 渲染样例。

## [1.1.0] - 2026-11-09（回顾式条目：本仓无 CHANGELOG，自此版起建账）

### Added

- 企业基座件补全（含 `TabsTrigger` 对比度对齐）；市场诊断能力与 destructive
  色对收敛；
- **主题变体首帧零闪烁重构**：`theme-init.js` 成为三端共用的无闪烁守卫唯一
  来源（`<html>` 的 `.dark` / `data-theme` 首帧前落位，默认变体不设置
  `data-theme`）；`scripts/check-theme-contracts.mjs` 门禁强制注册表 / 守卫 /
  `theme.css` / DESIGN.md 四方一致（新增主题两处都要加）。

### Changed（破坏性——README 已记载，升级三端需适配）

- **`Select` 默认 `position="popper"`**（弹层悬浮于触发器下方，与 shadcn v4
  上游一致）；旧默认 `item-aligned`（选中项对齐触发器）已移除——需要旧行为的
  调用方显式传 `position="item-aligned"`；
- **`Form` 默认校验时机改为自包含包装组件**：与上游 shadcn 的 `FormProvider`
  直传不同，本库 `<Form>…</Form>` 默认 `mode="onBlur"` + `reValidateMode=
  "onChange"`（失焦校验、修改即复检）；注意 RHF 的 `FormProvider` 本身不接收
  `mode`，上游惯用法 `<Form {...form}>`（props 带 `control`）仍原样透传、
  时机跟随调用方的 `useForm()`——此形态下本组件的这两个 prop 不生效。

### Fixed

- `pair destructive colors and constrain long dialogs`（destructive 色成对、
  长对话框约束）。

### 版本基线说明

本 1.1.0 基线随平台 v0.5.0 构建纳入（发布链 `build-server-images.yml` 与
`build-desktop-release.yml` 同钉 commit `2c3bf4beee8d2ee4954ff8f958df88dfaa7d1ed0`）。
改库纪律：先改 README（行为变更记载）再动实现；`Select`/`Form` 之外的行为
变更持续补充进本文件。

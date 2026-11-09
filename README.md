# workpaw-ui

WorkPaw 共享 UI 组件库：`src/components/ui/`（shadcn 风格组件）、`src/theme/`（五主题系统 + ThemeProvider/ThemeSettings）、`src/api` + `src/hooks` + `src/types`（控制面客户端）、`src/styles`（token 矩阵）。

## 源码包形态（重要）

本包是**源码包**：消费端（workpaw-admin/console、workpaw-web、workpaw-desktop）以
`file:../../workpaw-ui` 声明依赖，并用 vite alias + tsconfig paths 直指本仓库 `src/`
消费源码。**`dist/` 构建产物不存在也不需要**——`exports` 的 `.` 与 `./theme.css`
都指向真实源码文件（`./src/index.ts`、`./src/styles/theme.css`），不要把 `exports`
改回指向 `dist`。`pnpm build` 只是 `tsc -b` 类型检查；vite 只服务本地 playground
（`index.html` → `src/main.tsx`）。

样式引用口径：三端统一 `@import "workpaw-ui/theme.css"`（token 唯一真相源 =
`src/styles/theme.css`）。**theme.css 同时拥有 Tailwind v4 映射层**（`@source "../"`、
`@custom-variant dark`、`@theme inline` 全量 `--color-*`/radius/shadow 映射），所以
消费端 `index.css` 里手抄的重复 `@theme` 块可以删除——库侧映射值与之一致，导入一行即
获得全部工具类（含 state-* 与 shadow）。消费端保留自己的映射也无害：值相同，级联顺序
决定消费端声明胜出。实证由 `scripts/check-tailwind-preset.mjs`（真实 Tailwind 编译器
断言）看守。

## 首帧主题守卫（theme-init.js）

`src/theme-init.js` 是三端共用的无闪烁守卫唯一来源，包导出为
`workpaw-ui/theme-init.js`：

- 职责：首帧前从 localStorage 读 `theme`（亮/暗，next-themes 键）与
  `workpaw-theme-variant`（纯字符串主题变体），给 `<html>` 打 `.dark` class 与
  `data-theme` 属性。**默认变体（indigo）不设置 `data-theme`**（裸 `:root` 即默认
  调色板），无效值回退默认。
- 消费端接线：把各自 index.html 内联的手写守卫替换为读取本文件内联（或同步 `<script
  src>` 引入）。在接线完成前，admin/desktop 存量用户可能各多一次主题闪烁——属于迁移
  期一次性成本。
- allowlist 与 `src/theme/variants.ts` 注册表的同步由
  `scripts/check-theme-contracts.mjs` 门禁强制；新增主题时两处都要加。

## 运行时 API 要点

- **`useFetch(fetcher, { refreshDeps })`**：`refreshDeps` 对标 SWR 的 `key` /
  react-query 的 `queryKey` / ahooks 的 `refreshDeps`——fetcher 本身放在 ref 里
  （允许内联闭包不触发循环），凡 fetcher 读到的外部值（路由参数、id、筛选条件）都
  必须列进 `refreshDeps`，变化即自动重取；数组长度需跨渲染稳定。返回值
  `{ data, error, loading, refetch }` 与旧版完全兼容。fetcher 可接收一个
  `AbortSignal` 参数（`useFetch((signal) => getItem(id, signal))`）：卸载 /
  `refreshDeps` 变化时请求会被真正中止；忽略该参数仍向后兼容，只是退化为
  「放弃结果」而不是「中止请求」。
- **`Select` 默认 `position="popper"`**：与 shadcn v4 上游一致（弹层悬浮于触发器
  下方/上方）。旧默认 `item-aligned`（选中项对齐触发器）已移除——需要旧行为的
  调用方显式传 `position="item-aligned"`。
- **`Form` 默认校验时机（与上游 shadcn 的差异）**：上游 `Form = FormProvider` 直传；
  本库改为包装组件，自包含用法 `<Form>…</Form>` 默认 `mode="onBlur"` +
  `reValidateMode="onChange"`（失焦校验、修改即复检），显式传这两个 prop 可覆盖。
  注意 RHF 的 `FormProvider` 本身不接收 `mode`（它是 `useForm()` 的选项），所以
  shadcn 惯用法 `<Form {...form}>`（props 带 `control`）仍原样透传、时机跟随调用方
  的 `useForm()`——此形态下本组件的 `mode`/`reValidateMode` 不生效。
- **`UITextProvider` / `useUIText`**：组件内建文案（Dialog/Sheet 关闭、Spinner 状态、
  Pagination（含分页摘要/每页条数）、Carousel、Sidebar、CommandDialog、Breadcrumb、
  PluginTypeTag、ThemeSettings、市场错误文案、ErrorBoundary、Combobox chip 移除）
  默认 zh-CN，应用用 `<UITextProvider text={{ close: "Close", ... }}>` 局部覆盖；
  组件实例 props 仍然优先，向后兼容。模板词条用 `{token}` 占位（如
  `"共 {total} 条"`），由调用点做字符串替换，不引 i18next。词典分组
  （pluginType / themeSettings / marketErrors）按键浅合并，可只覆盖组内单条。
- **消毒与导出工具（PERM-09）**：`sanitizeHtml(dirty, config?)`（DOMPurify 封装，
  禁 script/style/iframe 等与事件属性、URI 白名单 http/https/mailto/相对路径；
  `config` 与默认顶层浅合并）、`safeHref(url)`（协议白名单，`javascript:` 等返回
  `undefined`）、`escapeCsvCell(v)`（OWASP CSV 注入前缀 + RFC 4180 引号转义）。
  依赖 `dompurify`（已在本包 dependencies，源码消费随 install 获得）；运行时需
  浏览器 DOM（本库 CSR-first）。
- **分页基元（TABLE-06）**：`PaginationInfo({ total, pageSize, current })` 渲染
  「共 N 条 · 第 X–Y 条」，`PaginationPageSize({ value, onChange, options? })`
  每页条数选择器（默认 10/20/50/100，组合 Select）；现有 `PaginationLink` API 不变。
- **警示：`ApiError.message` 含原始响应体**：`message` 为
  `API Error: <status> <statusText> - <body>` 拼接，`body` 是服务端原始返回，
  可能包含内部实现细节、堆栈或超长文本——**不要把 `ApiError.message` 直接渲染到
  界面或原样上报**；展示/上报请用 `status` + `body` 结构化字段，或经
  `marketErrorMessage` 之类的用户文案映射。
- **`ThemeProvider`**：包装 next-themes（`.dark` class）+ 变体到 `data-theme` 属性；
  默认变体映射为**移除**属性。

## 消费端注意

- 运行时共享依赖（react / react-dom / radix-ui / @base-ui/react / next-themes /
  zustand / motion）声明在 `peerDependencies`（本仓库 `devDependencies` 用精确版本
  供自身开发），避免双实例。
- 组件内部一律**相对导入**（`../../lib/utils`、`./button` 等），不使用 `@/` 别名，
  否则会撞上消费端各自的 `@` alias。`check-ui-stack.mjs` 会直接拒绝 `src/` 内的
  `@/…` 导入（含动态 import / require / import type）。
- `components.json` 的 aliases 仍是 `@/…`（shadcn CLI 的 schema 不支持自定义 import
  模板）：用 `npx shadcn add <component>` 添加组件后，必须把生成的 `@/lib/utils`
  等导入手工替换为相对路径——lint 门禁会拦住漏改的提交。
- 本仓库与 playground 均为 **CSR-first**：三个消费端（web / admin console /
  desktop）都是 Vite CSR SPA（`createRoot`，无任何 SSR 运行时），库未在 SSR 下
  测试，也不承诺 SSR/hydration 安全；`Sidebar` 的 `document.cookie` 写入只发生在
  事件回调里，SSR 渲染路径不会触达。

## 开发与门禁

```bash
pnpm install
pnpm dev                        # playground（index.html + src/main.tsx）
pnpm lint                       # ui-stack + theme-contracts + contrast + tailwind-preset 门禁 + oxlint(correctness)
pnpm exec tsc --noEmit
pnpm build                      # tsc -b（类型检查；无 dist 产物）
pnpm check:contrast             # 5 主题 × 亮暗 × 25 关键对 = 250 对 ≥ 4.5:1 全绿
pnpm check:theme-contracts      # 注册表/守卫/theme.css/DESIGN.md 四方一致
node scripts/check-tailwind-preset.mjs  # 真实 Tailwind 编译器断言映射层生效
```

playground 渲染的是**真实主题系统**（globals.css 直接 `@import "./theme.css"`，
ThemeProvider + ThemeSettings + theme-init.js 与消费端同源）：`pnpm dev` 后在
五主题 × 明暗下逐组目检组件（Button/Badge/Alert/表单控件/Tabs/Dialog 长内容滚动
等），主题类缺陷先在这里复现再进修复。

改动后三端回归：在消费端仓库跑 `pnpm exec tsc -b`（如 admin console）。

# WorkPaw Desktop 非技术员工导向重设计

- **日期**: 2026-06-22
- **范围**: 仅 `workpaw-desktop`（Tauri 桌面对话端）
- **不动**: `workpaw-web`（配置面）、`workpaw-admin/console`（管理后台）、后端契约、K8s 生命周期逻辑
- **目标用户**: 企业内非技术员工（不会读技术术语、不看文档、怕点错的高频日常使用者）
- **北极星**: 精密控制台（PRODUCT.md / DESIGN.md），克制·温暖·精密
- **成败标准**: 零文档自服务优先 + 降低畏惧感（两者都要，自服务优先）

---

## 0. 设计决策（来自 brainstorming 问答）

1. **Agent 与模型是使用 AI 的前提，不重新设计**——下拉保留，只补兜底说明，不藏不折叠。
2. **容器生命周期自动拉起 + 人文提示**——员工不点"激活"，后台自动起，过渡屏用人话。
3. **范围仅 desktop 侧**——web/admin 职责边界清晰，不在本设计内；但 desktop 遇到"需配置"的交接点保持现状跳转。
4. **成败定义**: 零文档自服务优先 + 降低畏惧感。
5. **方向**: 方案 A（就地教学）为主干 + 方案 B 的一缕轻量首提示。不做重度向导（与"克制"气质冲突），不做导航重排（Inbox/Cron/Files 是非技术员工的自助卖点，不藏抽屉）。

---

## 1. 容器闸门改造（自动拉起 + 人文提示）

### 问题
`App.tsx` 在 `instance.status !== "running"` 时渲染 `ContainerStatusPage`，满是"QwenPaw 容器""激活容器""尚未部署"裸技术词，非技术员工卡在第一道门。

### 改造
1. **闸门逻辑**: 保留 `App.tsx` 三态判断，但渲染改为 `<ContainerGate>` 过渡屏（非独立页）。`not_found` / `stopped` 都自动触发 `activate()`，员工不点按钮。员工视角只有"在准备"和"好了"两态。
2. **过渡屏文案（去术语）**:

   | 实际状态 | 员工看到的 |
   |---|---|
   | not_found → creating | "正在为你准备 AI 助手，首次准备约需 1 分钟" |
   | stopped → creating | "正在唤醒你的 AI 助手，约需 30 秒" |
   | creating / 轮询中 | 同上 + Signal Orange 进度环（复用现有 `border-primary` spinner） |
   | error（激活失败）| 见 §4，不在这页露堆栈 |

   过渡屏无标题，居中：一句主文 + 一句副文 + 进度环。
3. **前端文案计时器**: 纯前端计时，不依赖后端。
   - >60s 仍在 creating → 副文换"比你预期久了一点，还在努力，请稍候"
   - >180s → 副文换"准备时间过长，你可以稍后再试，或联系管理员"，出现一个 ghost 按钮"稍后再试"
   - **不做跳过按钮**——跳过只落到没准备好的 chat 页，更糟。
4. **Signal Orange 出场**: 进度环是本节唯一橙色出场点（One Signal Rule 合规）。
5. **directPodUrl 开发分支不动**。

### 取舍
完全拿掉"主动点激活"。代价是首次登录有不可跳过的等待（约 1 分钟），用递进文案缓解焦虑。

---

## 2. Chat 就地教学（去技术化 + 在动作点给信息）

Agent/模型保留（前提），让非技术员工"看着就会用"。chat 主结构（SessionSidebar + MessageList + ChatInput）不动。

### 2.1 术语替换（desktop chrome 通用）
- "Agent" / "选择 Agent" → "助手" / "选择助手"（全 chrome 统一；web 配置面保留 Agent 术语——配置者语境 vs 使用者语境的分叉是合理的）。

### 2.2 AgentSelector
- 触发按钮未选中态 "选择 Agent" → "选择助手"；下拉项不出现 Agent 字样。
- description 空时前端兜底"通用对话助手"，不让空 description 显得"没说明"。非空原样显示（line-clamp-2 保留）。
- 选中项 `Check` 仍 `text-primary`，不动。
- **不加**新手引导气泡/首次高亮——下拉本身就是动作点。

### 2.3 ModelSelector
- PRO/FREE tab 保留（QwenPaw 既有能力分层，员工理解"免费/付费档"）。
- 每个 provider 分组上方，description 缺失时加兜底说明（`text-xs text-muted-foreground`）：
  - PRO："PRO：能力更强，适合复杂任务"
  - FREE："FREE：无需配置，随时可用"
- 模型项图标体系（Sparkles/Zap/Eye 现有）保留。
- **不改**模型 id 展示（现状 `m.name || m.id` 已对）。模型不藏（遵守"模型是前提"）。

### 2.4 空对话首屏（唯一教学出口）
`messages.length === 0` 时 MessageList 区渲染空状态组件而非空白：
- Bot 图标（`text-muted-foreground`，**不用橙色**——橙色留给主操作）+ "你好，我是你的 AI 助手" + "直接在下方输入问题就行"
- 三个示例按钮（ghost, `text-sm`, 左侧小点），**点击即填入**输入框（不发送，让员工还能改）：
  - "总结这份文档"
  - "帮我起草一封邮件"
  - "解释这个表格的数据"
- 示例中文、具体、非技术语境。
- **首条提示**（借自方案 B）：容器首次就绪后首次进入空对话，标题下多浮一行 `text-xs text-muted-foreground`："这是你的 AI 助手，直接打字提问就行"，localStorage flag 标记已看过，非阻塞、不弹窗、下次不显示。

### 2.5 ChatInput 微调
- 占位符 "输入消息... (Enter 发送, Shift+Enter 换行)" → "输入你的问题..."。
- 快捷键提示移到**首次 focus 输入框**时 `text-[11px]` 行内淡入，3s 淡出，localStorage flag 记一次，不常驻。
- 斜杠命令（/clear /compact /skills）**保留不教学**——进阶用户快捷方式，非技术员工不会碰到也不困扰（仅输入 / 触发）。SlashSuggestionBar 现状不动。

---

## 3. Inbox/Cron/Files 语言简化（去技术腔，结构不动）

信息架构与功能完全保留（不藏、不收抽屉），只做文案/术语"翻译"。

### 3.1 术语替换表（desktop chrome 通用）

| 现状 | 改为 |
|---|---|
| Agent / 选择 Agent | 助手 / 选择助手 |
| 按 Agent 筛选 | 按助手筛选 |
| 归属Agent: / 执行Agent: / 子Agent | 所属助手: / 执行助手: / 子助手 |
| 工具: (tool call) | 将执行: |
| 严重性: | 重要性: |
| 发现: (findings_count) | 问题: |
| 参数 (tool_params 折叠) | 详细内容 |
| 安全审批 | 保留 |
| 已超时，自动拒绝 | 超过时限，已自动拒绝 |
| 取消任务 / 批准 / 拒绝 | 保留 |
| 暂无推送消息 | 没有新消息 |
| 暂无待审批项 | 没有需要你审批的内容 |

### 3.2 ApprovalCard 的"为什么需要我批准"
卡片头部"安全审批"标题下方，按 `toolName` 给一句人类语言意图说明（`text-xs text-muted-foreground`）：
- 发消息/外呼类 → "你的助手想向外部发送消息，需要你确认"
- 文件删除类 → "你的助手想删除文件，需要你确认"
- 其他/未知 → "你的助手想执行一个操作，需要你确认"

映射放 `lib/approvalIntents.ts`，按 toolName 关键词匹配，未知兜底"执行一个操作"。兜底已足够安全（不误导）。这是给非技术员工的"30 秒电梯演讲"，不替代 `findingsSummary`（那是细节）。

### 3.3 Cron（定时任务）
- 标题"定时任务"保留。
- cron 表达式输入下方加自然语言预览（`text-xs text-muted-foreground`），**复用现有 `cronUtils.cronToText`**（已存在 `cronToText`，返回"每小时"/"每天 09:00"等），不新增解析逻辑。
- **payload 表单化（`{"role":"user",...}` JSON → 结构化表单）本轮不做**——Cron 对非技术员工低频，payload 结构可能复杂，值得单独 spec。本轮只做 cron 预览 + 术语兜底。
- 空状态补功能说明副文（见 §3.5）。

### 3.4 Files
- tooltip "启用/禁用此文件加载到系统提示词" → "启用后，助手会记住这份文件的内容"（"系统提示词"是实现概念，翻译成"助手会记住"）。
- 其余文案（文件/大小/修改时间）现状可读，不动。
- **Files 页当前无 Empty 组件**，本轮新增空状态："还没有文件，把文件拖进来或点击上传"。

### 3.5 全 chrome 空状态补"这页是干什么的"
每页空状态 EmptyTitle 下加一句功能说明副文（`text-xs text-muted-foreground`）：
- Chat 空对话 → §2.4 已覆盖
- Inbox 推送消息空 → "助手通过钉钉、飞书等渠道收到的消息会显示在这里"
- Inbox 审批空 → "助手想做重要操作时，会在这里等你确认"
- Cron 空 → "设置后，助手会按时间自动执行任务"
- Files 空 → "上传文件让助手在对话中参考"

---

## 4. 错误与破坏性操作防护

### 4.1 错误呈现：集中化 + 人类语言
建 `lib/errorToast.ts`，统一把后端/网络错误转人类语言 toast（sonner, destructive 变体）：

| 错误来源 | 员工看到的 toast |
|---|---|
| 网络断开/超时 | 网络好像断了，请检查后重试 |
| 401 未授权 | 登录已过期，请重新登录（+ 触发登出） |
| 403 无权限 | 你没有权限做这个操作 |
| 5xx 服务端 | 服务暂时不可用，请稍后重试 |
| 503 容器未就绪 | AI 助手还没准备好，请稍候 |
| 其他/未知 | 出了一点问题，请重试；如反复出现请联系管理员 |

- **绝不**把 `error.message`/堆栈/HTTP body 原样显示给员工。原始错误仍 `console.error` 供 IT 排查。
- **替换**各页散落的 `toast.error("...")`——是行为变更，统一文案口径，净收益。

### 4.2 破坏性操作：显式确认
建 `<ConfirmAction>` 组件（基于现有 `ConfirmPopover` 提炼），统一破坏性操作确认：
- 触发：点破坏性按钮 → 弹确认气泡/对话框，不立即执行。
- 确认文案：动词 + 对象 + 后果：
  - 拒绝审批 → "拒绝这个审批？助手将不会执行该操作"
  - 删除定时任务 → "删除这个定时任务？删除后无法恢复"
  - 删除文件 → "删除这份文件？助手将不再记住它的内容"
  - 批量删除消息 → "删除选中的 N 条消息？"（带数量）
  - 取消任务 → "取消这个任务？助手会停止当前操作"
- 确认按钮 `variant="destructive"`，标"删除"/"拒绝"而非通用"确认"；取消按钮 ghost 标"取消"。
- 破坏性按钮本身已是 destructive 变体，**不**加 hover 警告色——确认在点击后发生，不在悬停时吓人。
- 适用边界：批量删除/单条删除/拒绝/取消任务 → 确认；非破坏性（标记已读/切 tab/上传）→ 不确认，避免确认疲劳。

### 4.3 审批的不可逆兜底（批准/拒绝不对称）
- **批准不加确认**：审批的确认本质是"员工读完卡片内容"，不是再点一次按钮；强行加确认会养成"无脑点两次"坏习惯，削弱对内容阅读。
- 批准按钮**防误触**：点击后立即 disabled + 文案变"已批准..."（loading 态），防双击重复提交。批准/拒绝按钮拉开距离（flex 两端，现状已对）。
- **拒绝加确认**（§4.2）：拒绝是"否决意图"，误点代价小但加确认无害，符合"破坏性"定义（终止 AI 待执行操作）。

### 4.4 网络断开常驻提示
检测 `navigator.onLine` + online/offline 事件，断网时 MainLayout 内容区上方显示细条 `bg-warning/10 text-warning`："网络已断开，恢复后将自动重连"。恢复后自动消失。不阻塞操作，只告知。用 warning 语义色（断网是状态非错误）。

---

## 5. 测试与验证策略

纯前端文案/交互改造，无后端契约变更。保证不回归 + 落实可用性承诺，不为测而测。

### 5.1 测试分层

| 层 | 做什么 | 工具 |
|---|---|---|
| 类型/构建 | `pnpm build`（tsc + vite）绿 | 现有 |
| 单元 | 纯逻辑：`approvalIntents`、`classifyError`、cron 预览（复用 cronUtils） | Vitest + Testing Library（**本轮需引入**，desktop 当前未装） |
| 组件 | 空对话示例点击填入、ConfirmAction 流、ContainerGate 计时器文案递进 | Vitest + Testing Library |
| 手动验收 | 容器闸门三态、首提示 flag、破坏性确认边界、网络条 | 人工 checklist |

**不做** E2E（Playwright）——表层改动，E2E 投入产出比低。

### 5.2 必测纯逻辑（单元核心）
1. **`approvalIntents(toolName)`**: 发消息类→"向外部发送消息"；删除类→"删除文件"；未知/空→"执行一个操作"；大小写/下划线健壮性。
2. **`classifyError(err)`**: network reject→网络断开；401→登录过期；403→无权限；5xx→服务不可用；503→助手没准备好；未知→兜底。
3. **cron 自然语言预览**: 复用 `cronToText`，测典型表达式（`0 9 * * *`→"每天 09:00"、`*/5 * * * *`→"每 5 分钟"、无效→兜底）。

### 5.3 手动验收 checklist（非技术员工视角，按 PRODUCT.md "5 分钟自服务"）
- [ ] 全新账号首次登录：见"正在为你准备 AI 助手"过渡屏，无需点按钮，约 1 分钟进 chat
- [ ] 过渡屏 >60s 副文变化、>180s 出现"稍后再试"
- [ ] 空对话：欢迎语 + 3 示例，点示例填入（不发送）
- [ ] 首次 focus 输入框：快捷键提示淡入淡出，第二次不出现
- [ ] 切助手/模型：下拉有兜底说明，无裸术语
- [ ] 断网：顶部"网络已断开"条，恢复后消失
- [ ] Inbox 审批：卡片有"为什么需要我批准"一句人话意图
- [ ] 拒绝审批弹确认；批准不弹、直接 disabled loading
- [ ] 批量删除消息：确认文案带数量
- [ ] 删除定时任务/文件：弹确认，文案说清后果
- [ ] 触发错误（断网发消息）：toast 人类语言，无原始堆栈
- [ ] 全程 chrome 无"容器/Pod/Ingress/Agent/参数/严重性"裸技术词

### 5.4 回归边界（不动）
- chat 消息渲染、流式输出、工具调用卡片（ai-elements 套件）
- SessionSidebar 会话管理逻辑
- web/admin（跨界面边界）
- 后端契约、K8s 生命周期逻辑（只改前端如何呈现）
- Cron payload 表单化（§3.3，后续独立 spec）

---

## 6. 与设计系统的一致性核对

- **One Signal Rule**: Signal Orange 仅出现在——过渡屏进度环、Agent 选中勾、批准按钮（primary 变体）、空对话示例不抢橙。占比 ≤10% 维持。
- **True-Neutral Rule**: 不引入暖底色，本轮纯文案/交互，底色不动。
- **Flat-By-Default / Border-OR-Shadow**: 新增 ConfirmAction、网络条、空状态组件均遵循——边框或轻阴影二选一，不叠用。
- **One Family Rule**: Geist Variable（上轮已迁移），本轮新组件沿用。
- **No-Gray-Body Rule**: 副文/兜底说明一律 `text-muted-foreground`（0.446），不再浅。
- **WCAG AA**: 网络条 `bg-warning/10 text-warning` 需复核对比度（warning light `oklch(0.55 0.14 65)` on warning/10 底——若不达 4.5:1，改 `text-warning` 实底或加深）。状态不只靠颜色（网络条配文字，审批意图配文字）。
- **prefers-reduced-motion**: 首提示淡入淡出、快捷键提示淡出、过渡屏进度环——均需 `MotionConfig reducedMotion="user"` 降级（main.tsx 已全局接，复用）。

---

## 7. 范围外（明确不做）

- web/admin 任何改动
- 后端契约、API、K8s 生命周期逻辑
- chat 消息渲染/流式/工具卡片
- SessionSidebar 逻辑
- Cron payload 表单化（独立后续 spec）
- E2E 测试
- 重度新手向导
- 导航重排（Inbox/Cron/Files 保持平级四页）

---

## 8. 实现优先级（供 writing-plans 参考）

1. **P0 基础设施**: `lib/errorToast.ts` + `classifyError`、`lib/approvalIntents.ts`、`<ConfirmAction>` 组件、Vitest 引入
2. **P0 容器闸门**: `<ContainerGate>` 替换 ContainerStatusPage 调用点 + 计时器
3. **P0 Chat**: 术语替换、AgentSelector/ModelSelector 兜底、空对话首屏 + 示例填入、首提示、ChatInput 占位符
4. **P1 Inbox/Cron/Files**: 术语表落地、审批意图、cron 预览、Files 空状态、各页空状态副文
5. **P1 防护**: 破坏性确认接入各处、批准/拒绝不对称、网络断开条
6. **P2 验证**: 单元测试、手动验收 checklist

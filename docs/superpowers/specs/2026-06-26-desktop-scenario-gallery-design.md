# Desktop 场景化最佳实践画廊(做同款)— 设计文档

- **日期**:2026-06-26
- **状态**:已确认设计,待用户复核 spec → 转 writing-plans
- **关联**:基于飞书 Aily + 业界 AI Agent UX 调研;落地于 workpaw-control-plane(含 console/ 子目录)/ workpaw-desktop / workpaw-ui

---

## 0. 背景与目标

### 0.1 问题

WorkPaw Desktop 的 chat 页面空状态只有一个 Bot 图标 + 3 个写死的示例 chip("总结这份文档"等),点击仅填入输入框。用户(尤其企业新用户)面对空白输入框不知该问什么,"AI 能帮我干什么"的脑洞打不开,使用门槛高。

### 0.2 目标

在 chat 页面引入**场景化最佳实践画廊**:用户点击一个场景卡片即可"做同款"——自动切到合适的 Agent + 模型,填好提示词(支持变量),一键进入可用状态并发送。用具体场景打开脑洞,把"空白输入框恐惧"转化为"挑一个试试"。

### 0.3 已确认的四个关键决策

1. **做同款深度 = 场景化预设**:绑定 Agent + 模型 + 提示词 + 可选附件,一键进入可用状态(非仅填充输入框,非完整工作流复刻)。
2. **内容来源 = 官方内置 + 企业下发**:官方场景随版本 seed 初始化;企业管理员通过 console 增删改/覆盖/分类。v1 不做用户自建。
3. **画廊落位 = 空状态画廊 + header `[✨场景]` 持久入口**:新会话空状态显示精选场景卡片;聊起来后用 header 按钮随时重开完整画廊 Sheet。
4. **变量填充 = 卡片含变量槽,点击弹轻量表单**:模板提示词支持 `{{变量}}` 占位,做同款时弹出变量填空表单(text/textarea/select/file 四种类型)。

### 0.4 调研结论(摘要)

- **飞书 Aily**:从官网路由 manifest 反推,其"做同款"为 `market_agents/explore`(浏览)→ `market_preview/{id}`(预览)→ `skill_template/install`(一键安装)→ 工作台二次定制,三段式且模板带工具配置。
- **Dify**:模板市场用业务职能分类(Marketing/Sales/Support/Operations/IT/Knowledge/Design),口号"Create. Remix. Deploy."。
- **差异化机会**:Dify/Coze/ChatGPT Store 均偏"营销化商店"(插图/渐变/大圆角)。WorkPaw 用"精密控制台"语言做画廊——像"场景目录"而非"应用商店",更契合企业私有化工具型审美。Signal Orange 严格限制在 hover 边框 + 主按钮文字 + 职能标签文字三处。
- **可复用模式**:预览再安装、空状态建议卡片、变量填充、能力分层、命令面板 `/`。

---

## 1. 整体架构与数据流

### 1.1 三端职责

```
┌─────────────────────────────────────────────────────────────┐
│ workpaw-control-plane (Go 治理层, Postgres)                  │
│  • Scenario 表 (official + enterprise 共存, slug 维度覆盖)    │
│  • seed migration: 官方场景随版本 upsert (按 slug)           │
│  • /api/admin/scenarios/*  ← console 管理 (admin role)       │
│  • /api/scenarios          ← desktop 只读 (login 即可)       │
└─────────────────────────────────────────────────────────────┘
            ▲ 管理CRUD/启停/排序                ▲ 只读拉取(启动时)
            │                                  │
┌───────────┴────────────┐         ┌───────────┴──────────────────┐
│ console (admin 前端)    │         │ desktop (Tauri)               │
│  • 场景管理页(独立模块) │         │  • 空状态画廊(6 卡)          │
│  • CRUD/分类/启停/排序  │         │  • [✨场景] Sheet(全画廊)     │
│  • 预览(含示例对话)     │         │  • 预览 Sheet → 变量表单      │
│  • 企业覆盖/克隆官方     │         │  • 做同款:新建会话+应用+填入  │
└────────────────────────┘         │  • / 斜杠命令接入场景         │
                                   └───────────────────────────────┘
                                                  │ 拿到 ingress_url+token 后
                                                  ▼
                                          QwenPaw Pod (/api/console/chat SSE)
```

### 1.2 关键边界判断

- **场景库放 control-plane 而非 Pod**:QwenPaw Pod 锁定 v1.1.12 不可改;企业下发需跨所有用户 Pod,只有 control-plane 有全局视角;desktop 启动时已在调 control-plane(`/api/instance/connect`),顺带拉 `/api/scenarios` 零额外握手;复用现有 `TemplateService`/`AdminTemplateHandler`/`model.Migrate` 基建。
- **chat 数据流不经 control-plane**:做同款本质是"帮用户把 Agent/Model/prompt 预设好,再走正常 chat"。desktop → Pod 的 `/api/console/chat`(SSE)原路不变,control-plane 只提供场景库。
- **与现有 Agent/Model 的关系**:场景**引用**一个 agent(用户 Pod 内已配置的 agent id)和可选 model 预设,**不复制** agent 定义。admin 先用现有模板管理配好 Pod 跑哪些 agent,场景再从中挑选并组合提示词——两层解耦。

---

## 2. 数据模型(Scenario 实体)

落在 control-plane 的 Postgres,GORM 模型加进 `internal/model/model.go`,走 `model.Migrate()`。

### 2.1 Scenario 主表

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `slug` | string | 稳定标识,unique with source;官方 seed 与企业覆盖靠它对齐 |
| `source` | string | `official` \| `enterprise` |
| `title` | string | 场景名(Label 级,≤12 字) |
| `description` | string | 一句话描述(Body,≤2 行) |
| `category` | string | 职能分类(见 2.3) |
| `icon` | string | lucide 图标名(克制:用图标不用插图) |
| `agent_id` | string | 引用的 agent(Pod 内 agent id) |
| `model_preset` | jsonb | `{provider_id, model}`,空=用 agent 默认模型 |
| `prompt_template` | text | 含 `{{变量}}` 占位的提示词模板 |
| `variables` | jsonb | 变量 schema 数组(见 2.2),可空 |
| `example_dialogue` | jsonb | 2-3 轮示例对话(预览用) |
| `attachments` | jsonb | 可选示例附件引用,可空 |
| `sort_order` | int | 卡片排序 |
| `enabled` | bool | 启停 |
| `created_at` / `updated_at` | timestamp | |

联合唯一约束:`(slug, source)` —— 同一 slug 允许一 official + 一 enterprise。

### 2.2 Variable(variables jsonb 元素)

| 字段 | 说明 |
|---|---|
| `key` | 对应 `{{key}}` |
| `label` | 中文显示名 |
| `type` | `text` \| `textarea` \| `select` \| `file`(克制四选) |
| `required` | bool |
| `placeholder` | 占位符(4.5:1 对比) |
| `options` | select 的选项 |
| `default` | 默认值 |

### 2.3 分类(category)

v1 用业务职能分类(借鉴 Dify),中文化为:**写作 / 分析 / 代码 / 办公 / 运营 / 客服 / 知识**。分类作为 string 字段(非独立表),v1 够用;枚举放 Go const,console 下拉选。

### 2.4 企业覆盖官方的机制

- 官方场景 `source=official`,**企业不可删改**(只读 seed)。
- 企业要定制 → **克隆成 `source=enterprise` 副本**(同 slug),可改。
- 查询时 unique 维度是 `slug`:**enterprise 优先于 official**——同一 slug 若有 enterprise 记录则只返回 enterprise 版。
- 企业"隐藏官方某场景" → 创建同 slug 的 enterprise 记录并 `enabled=false`(软覆盖)。
- 官方 seed 升级 upsert 时只动 `source=official` 行,**不触碰 enterprise 行**——企业定制永不丢。

查询有效场景的 SQL 语义:
```sql
SELECT * FROM scenarios s
WHERE enabled = true
  AND id = (
    SELECT id FROM scenarios s2
    WHERE s2.slug = s.slug AND enabled = true
    ORDER BY source='enterprise' DESC, updated_at DESC
    LIMIT 1
  )
ORDER BY category, sort_order;
```

### 2.5 为什么用 jsonb 存 variables/example_dialogue

这些是场景的**只读附属数据**,无独立查询/索引需求,随场景整体读写。独立表徒增 join 与 CRUD 复杂度。jsonb + GORM `datatypes.JSON` 足够,且与 `model_preset` 一致。

---

## 3. 后端 API(control-plane)

复用现有 `TemplateService`/`AdminTemplateHandler` 模式,新建 `ScenarioService` + `ScenarioHandler`。

### 3.1 desktop 只读接口 `/api/scenarios`(普通登录即可)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/scenarios` | 返回当前用户可见的有效场景列表(已做 enterprise 覆盖 + enabled 过滤 + 排序) |

响应体(desktop 画廊直接消费):
```json
{
  "scenarios": [
    {
      "id": "uuid",
      "slug": "summarize-doc",
      "title": "总结文档",
      "description": "上传文档,生成结构化摘要与要点",
      "category": "分析",
      "icon": "FileText",
      "agent_id": "agent-xxx",
      "agent_name": "文档助手",
      "model_preset": {"provider_id":"p1","model":"qwen-max"},
      "prompt_template": "请总结以下文档:{{doc}}\n风格:{{style}}",
      "variables": [
        {"key":"doc","label":"文档","type":"file","required":true},
        {"key":"style","label":"风格","type":"select","options":["简洁","详细"],"default":"简洁"}
      ],
      "example_dialogue": [{"role":"user","content":"..."},{"role":"assistant","content":"..."}],
      "sort_order": 1
    }
  ]
}
```

设计要点:
- desktop 拉**全量**(v1 场景量级 ≤ 数十,无需分页/搜索后端;搜索过滤前端做)。
- `agent_name` 一并返回,避免 desktop 为展示卡片名再二次请求 Pod 的 `/api/agents`。
- 不返回企业禁用/未发布的场景(enabled 过滤已在查询里)。
- 缓存:desktop 启动拉一次,本地内存缓存;admin 改动后 desktop 重启或手动刷新生效。v1 不做实时推送。

### 3.2 console 管理接口 `/api/admin/scenarios/*`(admin role)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/scenarios` | 列全部(含 official + enterprise + disabled),带 source 标记 |
| GET | `/api/admin/scenarios/:id` | 详情(含完整 prompt_template/variables) |
| POST | `/api/admin/scenarios` | 新建(enterprise) |
| PUT | `/api/admin/scenarios/:id` | 改(仅 enterprise;改 official 返回 409) |
| DELETE | `/api/admin/scenarios/:id` | 删(仅 enterprise;official 不可删) |
| POST | `/api/admin/scenarios/clone/:slug` | 克隆 official→enterprise(定制官方场景的入口) |
| PUT | `/api/admin/scenarios/sort` | 批量调排序(见下方说明) |
| PUT | `/api/admin/scenarios/:id/toggle` | 启停 |

> **路由偏差说明(sort 批量化)**:本表早期版本写作 `PUT /api/admin/scenarios/:id/sort`(逐条排序)。实现时改为**批量路由** `PUT /api/admin/scenarios/sort`,请求体 `{"orders": {"<id>": <sort_order>}}`,一次提交多个场景的排序。批量更合理:console 拖拽排序通常一次调整多行的 sort_order,逐条会产生 N 次请求与中间乱序态;批量 + 单事务(见 §3.4 实现注记)保证原子完成。`/scenarios/sort` 在 gin 路由表中先于 `/scenarios/:id` 注册,不会被 `:id=sort` 误匹配。代码以此为准确契约。

权限与契约约束:
- 沿用现有 `Auth + AdminOnly` 中间件。
- 官方场景 `source=official` 的 PUT/DELETE → **409 Conflict**(只读 seed,只能 clone 后改副本)。
- 新建/克隆强制 `source=enterprise`。
- slug 唯一性:`(slug, source)` 联合唯一。
- 所有写操作落审计(`AuditService.Write`),记 `scenario.create/update/delete/clone`。
- 模型字段一律带 snake_case json tag(防历史契约 bug)。

### 3.3 官方 seed migration

- 在 `model.Migrate()` 后独立 `seed.Scenarios()` 步骤,**按 slug upsert** `source=official` 行:存在则更新官方字段(不碰 enterprise),不存在则插入。
- 官方场景定义放 Go 代码常量(`internal/service/scenario_seed.go`),随版本演进。
- 初版 seed ~20 个场景,覆盖 7 个分类各 2-3 个(清单见 §6.3)。

### 3.4 路由注册(router.go 增量)

```go
// desktop 只读(普通登录)
scenarioSvc := service.NewScenarioService(gdb)
scenarioReadH := handler.NewScenarioHandler(scenarioSvc)
scenarioGroup := r.Group("/api/scenarios")
scenarioGroup.Use(middleware.Auth(jwtSvc))
scenarioGroup.GET("", scenarioReadH.List)

// console 管理(admin)
adminGroup.GET("/scenarios", adminScenarioH.List)
adminGroup.GET("/scenarios/:id", adminScenarioH.Get)
adminGroup.POST("/scenarios", adminScenarioH.Create)
adminGroup.PUT("/scenarios/:id", adminScenarioH.Update)
adminGroup.DELETE("/scenarios/:id", adminScenarioH.Delete)
adminGroup.POST("/scenarios/clone/:slug", adminScenarioH.Clone)
adminGroup.PUT("/scenarios/sort", adminScenarioH.Sort)      // 批量,先于 :id 注册
adminGroup.PUT("/scenarios/:id/toggle", adminScenarioH.Toggle)
```

> **实现注记(代码 review 偏差修订)**:
> - **Sort 批量化(对应 review I2)**:`PUT /scenarios/sort` 为批量路由,body `{"orders":{"<id>":<n>}}`。`ScenarioService.Sort` 将全部更新包在单个 `s.db.Transaction` 中,任一失败回滚(无半完成态,对应 review I4)。`/scenarios/sort` 必须先于 `/scenarios/:id` 注册,否则会被 `:id="sort"` 吞掉。
> - **Create 事务化(对应 review I3)**:`ScenarioService.Create` 将 slug 唯一性预检 + 插入包在单个 `s.db.Transaction` 中,消除 check-then-insert 的 TOCTOU 竞态;并发同 slug 第二写入方干净返回 `ErrSlugExists`(409)。
> - **Clone 继承 enabled(对应 review I5)**:克隆 enterprise 副本时 `clone.Enabled = off.Enabled`,不强制 `true`,与 §2.4 软覆盖语义一致(克隆一个被禁用的官方场景应保持禁用,待管理员显式启用)。
> - **Clone slug 精确错误(对应 review M5)**:official slug 找不到时返回 `ErrSlugNotFound`(非泛化 `ErrNotFound`),handler 映射 404 + 明确消息。
> - **审计 target_name(对应 review I6)**:Update/Delete/Toggle handler 在写操作前后 `Get` 取 title/slug 传入审计;Sort 无单一 target,记 `detail={"count": N}`。
> - **typed jsonb struct(对应 review M2)**:`Variables` 用 `[]model.ScenarioVariable`、`ExampleDialogue` 用 `[]model.ScenarioDialogueTurn`(带 snake_case json tag)替代 `[]map[string]interface{}`,jsonb serializer 兼容,编译期字段安全。

---

## 4. console 管理页(场景管理,独立模块)

落在 `workpaw-control-plane/console/src/pages/`,与现有 Templates 页并列。

### 4.1 信息架构

console 主导航新增一级项 **「场景」**(介于「模板」与「策略」之间)。场景与模板维度不同:模板是"配 Pod 跑什么 agent",场景是"chat 端用户点一下做什么"。两者并列,场景引用模板配出来的 agent。

```
console 导航: 仪表盘 / 用户 / 实例 / 模板 / 场景 / 策略 / OIDC / 审计
                                          └─ 新增
```

### 4.2 场景管理页布局

```
┌─────────────────────────────────────────────────────────────┐
│ 场景管理                              [+ 新建场景]           │
├─────────────────────────────────────────────────────────────┤
│ [全部] [写作] [分析] [代码] [办公] [运营] [客服] [知识]  🔍搜索│
├─────────────────────────────────────────────────────────────┤
│ 总结文档        写作  official  ●启用      [预览][克隆][排序] │
│ 数据洞察        分析  enterprise ●启用      [预览][编辑][删]  │
│ SQL 生成        代码  official  ○禁用      [预览][克隆][启用] │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

表格列:标题 / 分类 / 来源(official 灰色只读 chip / enterprise 橙色可改 chip)/ 启停开关 / 操作。

操作语义:
- **official 行**:`[预览]`(只读 Drawer)+ `[克隆]`(→ 生成 enterprise 副本进编辑)+ `[排序]`。无编辑/删除。
- **enterprise 行**:`[预览]` + `[编辑]` + `[删除]` + `[启停]`。
- 启停开关:official 不可直接关(灰锁,提示"先克隆");enterprise 可关。

### 4.3 新建/编辑场景(表单 Sheet)

右侧 Sheet 滑出(沿用 console 现有 ApplyTemplateDialog 的 Sheet 模式):

```
┌─ 新建场景 ──────────────────────────┐
│ 标题*      [总结文档           ]     │
│ 分类*      [写作 ▾]                  │
│ 图标       [FileText ▾](lucide 选)   │
│ 描述*      [上传文档生成结构化摘要 ]  │
│ 引用 Agent*[agent-xxx ▾](下拉 Pod 内)│
│ 推荐模型   [qwen-max ▾](可空=默认)   │
│ ─────────────────────────────────── │
│ 提示词模板*[含 {{变量}} 的大文本框 ]  │
│ ─────────────────────────────────── │
│ 变量(可选)  [+ 添加变量]             │
│  key=doc  label=文档  type=file  ⋮  │
│  key=style label=风格 type=select ⋮ │
│ ─────────────────────────────────── │
│ 示例对话(预览用,2-3轮)              │
│  用户: [ ... ]  助手: [ ... ]        │
│ ─────────────────────────────────── │
│              [取消]  [保存]          │
└──────────────────────────────────────┘
```

编辑器关键交互:
- 提示词模板里输入 `{{` 自动提示已定义的变量 key(光标处补全),降低变量与模板错配。
- 变量类型 select 限定四选(text/textarea/select/file)。
- 引用 Agent 下拉:数据源是 admin 视角能管理的 agent 集合(复用现有模板管理的 agent 列表来源);存的是 agent 标识/id 与展示名,desktop 侧再校验当前用户 Pod 是否真有此 agent(见 §10.2)。
- 保存前前端校验:模板里的 `{{x}}` 必须都有对应 variable,否则报错(避免 desktop 侧渲染出裸占位符)。

### 4.4 预览 Drawer(只读,official 与 enterprise 共用)

展示场景将如何呈现给用户:标题 + 描述 + 图标 + 变量表单的真实渲染(用 desktop 同款变量表单组件,共享自 workpaw-ui)+ 示例对话(用 chat 消息样式渲染)。让管理员所见即所得。

### 4.5 组件复用与共享

- **变量表单组件**(变量 key→输入控件渲染)抽到 `workpaw-ui`,console 编辑器、console 预览、desktop 做同款三处共用同一组件——"一套语言三个界面"原则,避免三处行为漂移。
- adminApi.ts 增 `scenarioApi`(沿用现有 fetch 封装与类型模式)。

---

## 5. desktop 侧数据层与状态

### 5.1 类型与 API client

新建 `workpaw-desktop/src/lib/scenarioApi.ts`。类型与 workpaw-ui 共享的变量表单组件对齐:

```ts
export interface ScenarioVariable {
  key: string; label: string;
  type: "text" | "textarea" | "select" | "file";
  required: boolean; placeholder?: string;
  options?: string[]; default?: string;
}
export interface Scenario {
  id: string; slug: string; title: string; description: string;
  category: string; icon: string;
  agent_id: string; agent_name: string;
  model_preset: { provider_id: string; model: string } | null;
  prompt_template: string;
  variables: ScenarioVariable[];
  example_dialogue: { role: "user"|"assistant"; content: string }[];
  sort_order: number;
}
export async function listScenarios(): Promise<Scenario[]>
```

注意:desktop 现有 `podApi.ts` 连 Pod;场景走 control-plane,用 control-plane 的 baseUrl(从 `useInstanceStore`/auth 来)。这是唯一跨域点,已在 control-plane `config.yaml` 的 CORS allowed_origins 里允许了 5173(Tauri dev),生产同源无问题。

### 5.2 状态管理(useScenarioStore)

新建 `stores/useScenarioStore.ts`(zustand,与现有三个 store 风格一致):
- `scenarios: Scenario[]` / `loading` / `error`
- `fetchScenarios()`:启动时调一次,内存缓存
- `getEnabled()`:已过滤(后端已过滤,前端再保险)
- `scenariosByCategory()`:按 category 分组的选择器

加载时机:在 `App.tsx` 实例就绪后(MainLayout 渲染时)触发 `fetchScenarios()`,与现有 `listAgents`/`listProviders` 同批。失败不阻断主流程(降级见 §10.1)。

---

## 6. 空状态画廊(WelcomeScreen 改造)

改造 `MessageList.tsx` 里的 `WelcomeScreen`(现仅 Bot 图标 + 3 个写死 chip)。

### 6.1 布局

```
┌──────────────────────────────────────────────┐
│            (Bot 图标 48px)                    │
│       你好,我是你的 AI 助手                   │
│       从一个场景开始,或直接提问 ↓             │
│                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │📄总结文档│ │✉️起草邮件│ │📊数据洞察│           │  ← 6 张精选
│  │分析      │ │写作      │ │分析      │           │     (2行×3列)
│  └────────┘ └────────┘ └────────┘           │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │🔧SQL生成│ │📅周报    │ │💬客服话术│           │
│  │代码      │ │办公      │ │客服      │           │
│  └────────┘ └────────┘ └────────┘           │
│                                              │
│         浏览全部场景 →                        │  ← 文字链,打开 Sheet
└──────────────────────────────────────────────┘
```

### 6.2 卡片视觉(严格遵循"精密控制台")

```
┌────────────────┐
│ 📄              │   ← lucide 图标 18px,中性 ink(图中 emoji 仅示意)
│ 总结文档        │   ← 标题 14px medium, ink
│ 上传文档生成摘要 │   ← 描述 12px, mist-ink, 2行截断
│ 分析 · 做同款 → │   ← 分类 chip(mist 底)+ "做同款" 文字(signal orange)
└────────────────┘
  1px hairline 边框, 无阴影, 14px 圆角
  hover: 边框转 signal orange + 整卡微微抬升(translate-y-px)
```

克制清单(兑现设计语言,与 Dify/Coze 商店视觉差异化):
- ❌ 无插图、无 emoji、无渐变、无背景色块(本节及 §6.1 示意图中的 emoji 仅为占位示意,实际实现一律用 lucide 图标)
- ❌ 无静态阴影(Flat-By-Default)
- ✅ 仅 1px hairline 边框 + hover 信号橙
- ✅ Signal Orange 只出现在:卡片 hover 边框 + "做同款"文字 + 分类标签文字(三处,≤10% 面积)
- ✅ 图标用 lucide(与现有 ChatInput 一致),中性色
- ✅ `prefers-reduced-motion` 降级 hover 动画

注:上方布局示意图中的 emoji 仅为示意占位,实际实现用 lucide 图标、不使用 emoji。

### 6.3 6 张精选的选择逻辑与 seed 清单

- 空状态展示 `sort_order` 最靠前的 6 个(管理员通过排序控制"首屏推哪些")。
- 若场景总数 < 6,按实际数量显示(不强凑)。
- 点卡片 → 进入"做同款"流程(§8)。
- "浏览全部场景 →" → 打开完整画廊 Sheet(§7)。

初版 ~20 个官方场景 seed 清单(覆盖 7 分类,各 2-3 个):
- **写作**:总结文档、起草邮件、改写润色
- **分析**:数据洞察、报表解读、竞品对比
- **代码**:SQL 生成、代码审查、bug 定位
- **办公**:周报生成、会议纪要、PPT 大纲
- **运营**:活动文案、用户画像、社媒排期
- **客服**:话术建议、工单分类、FAQ 整理
- **知识**:知识抽取、术语解释、文档问答

---

## 7. 完整画廊 Sheet(header [✨场景] 入口)

header 新增 `[✨ 场景]` 按钮(Sparkles 图标,ghost 样式),点击打开右侧 Sheet(Shadcn Sheet,克制非全屏)。

### 7.1 布局

```
┌─ 场景库 ───────────────────────────────────────┐
│ [🔍 搜索场景...]                               │
│ [全部][写作][分析][代码][办公][运营][客服][知识]│  ← 分类 tab
├────────────────────────────────────────────────┤
│ ┌────────┐┌────────┐┌────────┐                 │
│ │总结文档 ││数据洞察 ││SQL生成  │   (3列网格)    │
│ └────────┘└────────┘└────────┘                 │
│ ┌────────┐┌────────┐┌────────┐                 │
│ │起草邮件 ││周报     ││客服话术 │                │
│ └────────┘└────────┘└────────┘                 │
│  ... (可滚动)                                   │
└────────────────────────────────────────────────┘
```

- 左侧不另设分类 sidebar(Sheet 宽度有限),改用顶部分类 tab + 搜索——更紧凑,适合 Sheet 形态。职能分类用 tab 承载,语义不变。
- 卡片同 §6.2 视觉,点击行为分两种:
  - **点卡片主体** → 打开预览 Sheet(§8.1)
  - **点"做同款"** → 直接进变量表单(无变量则直接执行)

---

## 8. "做同款"三段式流程(核心)

借鉴 Aily `preview → install` + Coze Duplicate + Dify 变量填充,落地为预览 → 填变量 → 进会话三段。

### 8.1 预览 Sheet(第二层 Sheet,或同 Sheet 切视图)

```
┌─ 总结文档 ─────────────────────────────┐
│ 📄 分析 · 引用:文档助手 · 模型:qwen-max │
│                                        │
│ 上传文档,生成结构化摘要与要点。          │  ← 描述
│                                        │
│ ─ 示例对话 ──────────────────────────  │
│ 👤 用户: 帮我总结这份季度报告            │
│ 🤖 助手: 本季度营收同比增长 12%,要点:  │
│         1. ... 2. ...(2-3轮,真实渲染)  │
│                                        │
│ ─ 需要填写 ──────────────────────────  │
│ 文档* [选择文件...] (file 变量)         │
│ 风格  [简洁 ▾]      (select 变量)       │
│                                        │
│              [取消]  [✨ 做同款]         │  ← 主按钮 signal orange
└────────────────────────────────────────┘
```

- 示例对话用 desktop 现有 chat 消息组件渲染(`MessageResponse`/Bot 头像),真实感 + 顺带展示产品能力。固定 2-3 轮,不滚动,克制样式。
- 变量表单用 workpaw-ui 共享组件(§4.5)。
- 若无变量:预览 Sheet 只显示例对话,主按钮直接"做同款"执行。
- 若场景引用的 agent 当前用户 Pod 未启用(防御,见 §10.2):预览 Sheet 顶部黄色提示条"此场景需启用「文档助手」Agent,请到 Web 配置开启",`做同款` 置灰。

### 8.2 做同款执行(点主按钮后)

按"新建会话 + 应用预设 + 填入并发送"的原子序列:

```
1. 新建会话  createChat() → 拿到 session_id
2. 切 Agent   setSelectedAgent(scenario.agent_id)   // 设 X-Agent-Id header
3. 切 Model   scenario.model_preset ? setActiveModel(...) : 跳过
4. 渲染提示词 prompt_template 的 {{key}} 用表单值替换 → 最终 prompt
5. 处理附件   file 类型变量 → uploadFile() 拿 url,拼进 prompt 或作为附件
6. 发送      sendMessage(finalPrompt, attachments)   // 走现有 SSE 流
7. 切视图    关闭 Sheet,主区切到该新会话的消息流
```

关键决策:做同款 = **新建会话**,不在已有会话中途强切 Agent/Model(会话内切换语义脏)。新建后用户仍在同一 chat 页,只是会话列表多一条、主区进入新会话。

提示词渲染:`{{doc}}` 占位用变量值替换;`file` 变量的值是上传后的附件 url/引用,按 QwenPaw 的 chat 输入格式拼装(复用现有 `ChatInput` 的附件→prompt 拼装逻辑,不另造)。若变量 `required` 未填,前端拦截不发。

### 8.3 失败处理

- 新建会话/切 Agent/切 Model 任一失败 → toast 错误,不进入半完成状态(已建的会话回滚删除);详见 §10.3。
- 发送失败走现有 `sendMessage` 的错误 block(限流替代模型按钮等已有机制)。

---

## 9. `/` 斜杠命令接入场景(替换空壳)

现有 `ChatInput.tsx` 的 `/skills` 是 TODO 空壳。改造斜杠命令为真实场景快速插入:

- 输入框打 `/` → 弹出场景命令菜单(搜索场景标题),选中后**把该场景的 prompt_template(未填变量版,占位符保留)填入输入框**。
- 这是"轻量入口",服务键盘用户;与画廊/Sheet 三入口同源(同一 scenarioStore 数据)。
- 填入后用户可手动改占位符再发,或 Shift+进预览——v1 先做"填入输入框"最轻形态,不弹变量表单(表单走画廊/Sheet)。
- 保留现有 `/clear` `/compact`,新增 `/场景名` 动态项。

---

## 10. 错误处理与降级

核心原则:不进入半完成状态、不阻断主 chat。

### 10.1 场景库加载失败

- `fetchScenarios()` 失败 → `error` 置位,但不抛、不阻断。
- **空状态画廊降级**:场景加载失败/为空时,`WelcomeScreen` 回退到现有 3 个写死示例 chip,保证空状态永远有东西可点、不白屏。
- **`[✨场景]` 按钮降级**:场景为空时按钮仍可见,点击 Sheet 显示空态("暂无可用场景,请稍后重试"+ 重试按钮)。
- **`/` 斜杠降级**:场景为空时 `/` 菜单只显示 `/clear` `/compact`,不报错。
- chat 是主业,场景库是锦上添花,绝不能让它拖垮主流程。

### 10.2 场景引用的 Agent 不可用(防御性,关键)

场景引用的 `agent_id` 在当前用户 Pod 内未启用/不存在:

- **预览 Sheet** 顶部黄色提示条:"此场景需要「文档助手」Agent,请到 Web 配置启用",`做同款` 置灰。
- **判断时机**:desktop 已有 `listAgents()`(Pod `/api/agents`),场景预览打开时用本地 agent 列表校验 `agent_id` 是否在列。
- **不硬塞**:绝不自动切到一个不存在的 agent(会让 chat 报 500)。
- **空状态画廊卡片**若 agent 不可用 → 卡片置灰 + 角标"需启用",不可点做同款(可点进预览看说明)。

### 10.3 做同款执行链失败

| 步骤 | 失败处理 |
|---|---|
| 新建会话 | toast"创建会话失败",流程中止,无残留 |
| 切 Agent | toast"切换 Agent 失败",回滚删除刚建的空会话 |
| 切 Model | 回滚会话;v1 选回滚(语义干净),不降级到默认模型 |
| file 变量上传 | toast"附件上传失败",停留在变量表单不关 |
| 发送(SSE) | 走现有 `sendMessage` 错误块(含限流替代模型按钮),会话保留 |

回滚保证:做同款是"先建会话再配置"的多步操作,任一步失败需把已建的空会话删掉,避免会话列表堆积空壳。用 `try/catch` 包裹执行链,`finally` 校验:若未走到"发送"步且会话已建,则删除该会话。

### 10.4 变量渲染异常

- `prompt_template` 里 `{{key}}` 无对应变量定义(数据脏)→ 渲染时保留原占位符文本让用户看见,不崩;console 侧编辑器已校验拦截(§4.3),此处兜底。
- `select` 变量值不在 options 内 → 用 default,记 warn 日志不阻断。

### 10.5 模型预设失效

- `model_preset` 指定的 provider/model 在当前用户 Pod 不可用 → 调 `setActiveModel` 失败 → 触发 §10.3 回滚。
- v1 不做"自动降级到可用模型"(会改变场景语义,用户不知情);明确失败 + 回滚更诚实。

---

## 11. UX 增强分期(v2/v3,不进 v1)

明确列出避免范围蔓延:

### v2(画廊跑通后优先)
- **试用态会话**:从画廊发起的会话默认"试用"(不污染历史/可一键丢弃)。降低企业用户"试模板怕留痕"顾虑。
- **常用/最近场景**:画廊顶部置"最近使用"+"常用"区,基于本地使用频次(纯前端 localStorage,不上传)。
- **空状态卡片轮换**:6 张精选不再固定 sort_order,按用户使用习惯轻度轮换。

### v3(企业沉淀,依赖后端扩展)
- **团队级场景沉淀**:用户自建场景 → 提交 admin 审核 → 发布给全企业。
- **场景 DSL 导入导出**:YAML/JSON 跨实例流转(私有化部署多集群场景同步)。
- **对话式改造**:做同款后用自然语言改场景("把语气改正式点")。
- **能力分层显化**:新手画廊 / 进阶 `/` 命令 / 高手 DSL 三入口在 UI 上有引导提示。

v1 明确不做:用户自建场景、GPT Store 式公开市场、实时推送场景变更。

---

## 12. 测试策略

### 12.1 后端(control-plane,Go,TDD)
- `scenario_test.go`:`ScenarioService` 单测——覆盖查询合并(official vs enterprise 同 slug 优先级)、enabled 过滤、排序、seed upsert 幂等(跑两次结果一致、不碰 enterprise 行)。
- `admin_scenario_test.go`:handler 测试——CRUD、official 改/删返回 409、clone 生成 enterprise 副本、权限(非 admin 401/403)、审计落库。
- 契约:模型字段 snake_case json tag 全覆盖。
- 参考现有 `template_apply_integration_test.go` 模式做 scenario 集成测试。

### 12.2 console 前端(vitest)
- `ScenarioManager.test.tsx`:列表渲染、分类过滤、official 行无编辑/删除、clone 流程、启停。
- `ScenarioEditor.test.tsx`:表单校验(`{{x}}` 与变量匹配)、变量类型四选、保存调 API。
- `adminApi.test.ts`:scenarioApi 端点与类型。

### 12.3 desktop 前端(vitest)
- `useScenarioStore.test.ts`:加载/失败降级/分组。
- `WelcomeScreen.test.tsx`:有场景显示 6 卡、无场景回退 3 chip。
- `ScenarioSheet.test.tsx`:画廊分类 tab、搜索、预览渲染示例对话。
- 做同款流程测试:无变量直接执行、有变量填表执行、agent 不可用置灰、执行失败回滚空会话(关键)。
- `/` 斜杠:场景命令填入输入框。

### 12.4 共享组件(workpaw-ui)
- `VariableForm.test.tsx`:四种变量类型渲染、required 校验、值收集——三端共用,测一次保三端。

### 12.5 手测清单(交付前)
- 端到端:admin 建场景 → desktop 启动拉到 → 空状态点做同款 → 新会话正确切 Agent/Model → 流式输出。
- 降级:断 control-plane,空状态回退 chip、chat 不受影响。
- 防御:场景引用未启用 agent,卡片置灰 + 预览提示。
- 视觉:Signal Orange ≤10% 面积、扁平无阴影、暗色模式可读、reduced-motion 降级。

---

## 13. 范围与依赖

### 13.1 v1 范围
- 后端:Scenario 表 + seed + `/api/scenarios` + `/api/admin/scenarios/*`。
- console:场景管理独立模块(CRUD/克隆/启停/排序/预览)+ 变量表单组件抽 workpaw-ui。
- desktop:scenarioApi + useScenarioStore + 空状态画廊 + 画廊 Sheet + 做同款三段式 + `/` 斜杠接入。
- ~20 个官方场景 seed。

### 13.2 依赖与前提
- workpaw-control-plane 已含 GORM+Postgres+JWT+Admin 中间件+审计(三期已完成)。
- workpaw-desktop 已有 chat(SSE)、Agent/Model 切换、附件上传、斜杠命令框架。
- workpaw-ui 已有共享组件/类型基建。
- control-plane `config.yaml` CORS 已允许 desktop dev origin。

### 13.3 不在范围
- 用户自建场景(v3)。
- 实时推送场景变更(v1 重启/刷新生效)。
- 后端分页/搜索(v1 全量拉取,前端过滤)。
- 场景 DSL 导入导出(v3)。

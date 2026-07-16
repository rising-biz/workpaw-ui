# workpaw-admin/console 管理后台设计

> 日期：2026-06-21
> 状态：已确认（v2 修订：认证架构重构 + OIDC 集中管理 + 横切约定补充）
> 范围：workpaw-admin/console（前端）+ workpaw-admin（后端 admin 能力 + 统一认证扩展）
> 基于：QwenPaw v1.1.12

## 1. 概述

workpaw-admin/console 是面向企业超级管理员的管理后台，提供全平台可观测与治理能力：查看与集中管理全局配置（OIDC）、统计用户注册与实例在线情况、为指定用户配置 Agent 并为其添加 MCP/Skill、强制启停实例、禁用启用用户、全局策略与审计。只为企业超级管理员服务，与用户侧 workpaw-web 完全分离。

本 spec 同时定义 control-plane 的**统一认证扩展**：desktop / web / admin 三端共享同一套认证（control-plane 颁发的 JWT + PostgreSQL 账户/session），OIDC 上游配置由 admin 集中管理。

### 现状基线

**前端 workpaw-admin/console（已有骨架）**
- React 19 + Vite + Shadcn/base-ui + zustand + react-router 7，复用 workpaw-ui 共享包与设计系统。
- 已有页面：总览 / 实例管理 / 审计日志 / 全局策略 / 外观 + Login；侧边栏导航成型。
- 认证已通：OIDC SSO（走 control-plane `/api/auth/login`）+ JWT（含 `admin` role 校验）。
- API client 指向 control-plane `/api/admin/*`，当前全部读 mock 数据。

**后端 workpaw-admin**
- `/api/admin` 路由组已建，挂 `Auth` + `AdminOnly` 双中间件，但仅一个占位 `GET /api/admin/health`，无真实 admin handler。
- OIDC（Keycloak）+ JWT(HS256) + 角色提取（realm/client roles + 本地 admin allowlist 引导）可用。**注：本 spec 将把 JWT 从 HS256 升级为 RS256 + JWKS，以支持三端独立验证统一 token。**
- **无数据库层**：Postgres 配置在 config.yaml 声明但代码零引用，无 ORM、无 model、无 migration。
- 实例 = K8s `QwenPawInstance` CRD（controller-runtime 读写 `spec.desiredState`，operator reconcile）；token 在 `qwenpaw-token-{name}` Secret。审计日志不存在。
- Agent/MCP/Skill 配置当前存在于各用户自己的 QwenPaw Pod 内（workpaw-web 直连 Pod 修改），中心无配置存储。

## 2. 关键决策（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 配置管控模型 | 混合：中心模板 + 推送到 Pod | 管理员维护模板库（PostgreSQL），一键应用到用户（直连 Pod）；用户仍可在 web 面微调；Pod 仍是配置生效源真，不与用户自改冲突 |
| 设计范围 | 全量设计 + 分期实现 | 各子系统共享同一后端基础，一起设计避免返工；v1/v2 切分让实现可控 |
| 认证体系 | **纯 Go 统一认证 + PostgreSQL（control-plane 扩展为统一认证中心）** | BetterAuth 是 JS 库、Go control-plane 不能用；引入 Node 服务会打破 Go 栈统一与企业私有化"组件最少"取向。control-plane 现有 OIDC+JWT 扩展为统一 session（JWT RS256+JWKS 三端共享）+ PostgreSQL 账户/session，SSO 靠上游 IdP，真实诉求（集中管理 + PostgreSQL 账户）在纯 Go 内达成 |
| OIDC 配置 | **admin 集中管理（PostgreSQL 存储 + 测试连接 + 二次确认）** | 集中管理是合理诉求；改错会锁死全平台登录，故需"测试连接 + 二次确认"才生效，config.yaml 保留作 bootstrap/首启动回退 |
| 用户/实例数据源 | 以 K8s CRD 为实例主数据源；accounts 表为用户登记簿 | CRD 反映真实实例状态不依赖外部系统；accounts（登录 upsert）覆盖"登录过的用户"，CRD 覆盖"有实例的用户" |
| 审计日志 | PostgreSQL `audit_logs` 表 | 审计要求可追溯、不可从 K8s/Pod 清除；复用已引入的 PostgreSQL |
| 模板推送机制 | 同步直连 Pod API | 复用 workpaw-web 已验证的 Pod 配置 API 路径，不改 Pod；控制面能拿实时反馈；与现有 ConnectInfo token 机制一致 |
| 治理能力 | v1：强制启停 + 禁用启用 + 全局策略；v2：资源监控仪表盘 | 启停/禁用/策略是治理刚需且不依赖外部系统；监控需 Prometheus，列 v2 |
| 整体架构走向 | 分期演进型 | v1 同步直连交付核心价值，工程量最小；批量/离线重试与监控推迟 v2 |

## 3. 架构总览

```
┌──────────────────────────────────────────┐   ┌──────────────────────────────────┐
│  desktop(Tauri) / web / admin            │   │  workpaw-admin (Go/Gin)  │
│  三端共享统一认证                          │   │  统一认证中心 + admin API        │
│  系统浏览器SSO + deep link / OIDC dance   │──▶│  /api/auth/*  颁发 JWT RS256      │
│  持 JWT + refresh token                   │◀──│  /api/admin/* Auth+AdminOnly     │
└──────────────────────────────────────────┘   └───────────────┬──────────────────┘
                                                               │
                              ┌────────────────────────────────┼─────────────────┐
                              ▼                                ▼                 ▼
                      ┌──────────────┐              ┌──────────────────┐  ┌──────────────┐
                      │  PostgreSQL  │              │ K8s API (CRD)    │  │ QwenPaw Pod  │
                      │  (新建)       │              │ QwenPawInstance  │  │ 配置 API      │
                      │ accounts     │              │ 实例清单          │  │ (提权令牌直连)│
                      │ refresh_tokens│              └──────────────────┘  └──────────────┘
                      │ oidc_configs │
                      │ templates    │
                      │ audit_logs   │
                      │ policies     │
                      │ template_applies│
                      └──────────────┘
```

**数据流分工：**
- **K8s CRD（`QwenPawInstance`）** = 实例清单主数据源（状态、ingress、创建时间、最后活跃）。
- **`accounts` 表** = 用户登记簿，OIDC 登录回调时惰性 upsert（含 roles、last_login_at、治理状态），用于统计注册用户数与治理状态。CRD 覆盖"有实例的用户"，accounts 覆盖"登录过的用户"。OIDC provider（Keycloak）仅作"账号是否存在于 IdP"的补充验证，不作主清单。
- **PostgreSQL（新建）** = 中心数据：账户/session、OIDC 上游配置、Agent/MCP/Skill 模板库、审计日志、全局策略。模板存中心，应用时下发 Pod；Pod 仍是配置生效源真。
- **Pod 配置 API** = 配置生效唯一执行点。control-plane 持提权令牌直连，复用 workpaw-web 已验证的 QwenPaw 配置接口路径。

## 4. 范围（v1 / v2）

| 能力 | v1 | v2 |
|---|---|---|
| 统一认证扩展（JWT RS256+JWKS、PostgreSQL accounts/refresh_tokens、三端共享） | ✅ | |
| OIDC 配置集中管理（PostgreSQL + 测试连接 + 二次确认） | ✅ | |
| 用户/实例总览（CRD 统计、状态、搜索） | ✅ | |
| 强制启停用户实例 | ✅ | |
| 禁用/启用用户 | ✅ | |
| 全局资源/超时策略（读 + 改） | ✅ | |
| 审计日志（查询/筛选/导出） | ✅ | |
| Agent/MCP/Skill 模板库 CRUD + 应用到用户（同步直连 Pod） | ✅ | |
| 模板应用任务化（`apply_jobs` + worker 重试，应对 Pod 离线/批量） | | ✅ |
| 资源用量监控仪表盘（接 Prometheus） | | ✅ |

**v1 执行模型**：模板"应用到用户"= 同步直连 Pod API。单次应用在线 Pod 立即生效并回写状态；Pod 离线则返回错误，管理员稍后重试。批量 = 前端逐个确认（不做后台队列）。GORM auto-migrate 起步，预留 migration 文件路径。

**v2**：引入 `apply_jobs` 表 + worker，把同步调用改为幂等任务化，处理离线重试与批量；接入 Prometheus 做资源监控仪表盘。

## 5. 统一认证设计

### 5.1 token 模型
- **access token**：JWT **RS256**，TTL 15min。claims 含 `sub`(OIDC sub)、`email`、`name`、`roles`、`exp`、`iat`、`jti`。
- **refresh token**：opaque 随机串，TTL 7d，存 PostgreSQL `refresh_tokens`（存哈希）。用于换新 access token。
- **JWKS**：control-plane 暴露 `GET /.well-known/jwks.json`，三端/control-plane 用公钥验签，无需共享密钥（取代现 HS256 共享 secret）。
- **撤销**：logout 删该用户 `refresh_tokens`；access token 短 TTL 自然过期。v1 不做 access token 黑名单。

### 5.2 三端登录与 SSO
- **web / admin**：走 control-plane `/api/auth/login`（OIDC dance 到上游 IdP）→ 回调 → 颁发 access + refresh → 前端存 token（localStorage）。SSO 靠上游 IdP（Keycloak）session：用户在 IdP 登一次，web/admin 各自 dance 时免密跳回。
- **desktop（Tauri）**：系统浏览器 SSO + `workpaw://` deep link 回调拿 token（现有机制，改为接收 RS256 token）。
- 三端共用 `/api/auth/login` `/api/auth/callback` `/api/auth/refresh` `/api/auth/logout`。

### 5.3 OIDC 上游配置集中管理
- `oidc_configs` 表存上游 IdP 配置（provider_url、client_id、client_secret 加密、redirect_uri、scopes、admin_users）。control-plane 启动读 DB（DB 空则回退 config.yaml bootstrap）；admin `PUT` 后**热加载**到 OIDC service。
- 生效流程：admin 编辑 → `POST /api/admin/oidc/test`（用待生效配置验证 IdP discovery 可达——即 `oidc.NewProvider` 能完成 `.well-known/openid-configuration` 发现）→ 测试通过 → `PUT /api/admin/oidc/config` 二次确认写入 → control-plane 热加载。测试失败不生效，避免锁死。**注：Test 仅做 discovery，不校验 client_id/secret 凭证（坏凭证在运行时登录才会暴露）；这是 v1 取舍，避免测试连接产生真实 token 副作用与跨 IdP grant 差异。**
- `client_secret` 用 AES-GCM 加密存库，主密钥来自环境变量 `WORKPAW_DB_SECRET_KEY`（不入库不入 git）。

## 6. 后端数据模型

PostgreSQL 表（control-plane 用 GORM auto-migrate 起步，预留 `db/migrations/` 向 golang-migrate 迁移路径）。

| 表 | 主键 | 用途 | 关键字段 |
|---|---|---|---|
| `accounts` | user_id(OIDC sub) | 用户登记簿 + 治理 | email, display_name, roles(text[]), is_disabled, disabled_at, disabled_by, disabled_reason, first_seen_at, last_login_at, created_at, updated_at。登录回调惰性 upsert |
| `refresh_tokens` | token_hash | refresh/撤销 | user_id, expires_at, revoked_at, created_at, user_agent, ip |
| `oidc_configs` | id(单行=1) | OIDC 上游配置 | provider_url, client_id, client_secret_enc, redirect_uri, scopes, admin_users(text[]), updated_by, updated_at, version(乐观锁) |
| `agent_templates` | uuid | Agent 模板 | name, description, `spec(jsonb)`, mcp_template_ids(uuid[]), skill_template_ids(uuid[]), created_by, created_at, updated_at, deleted_at(软删除) |
| `mcp_templates` | uuid | MCP 服务模板 | name, description, `spec(jsonb)`(transport/command/args/env/url), created_by, 时间戳, deleted_at |
| `skill_templates` | uuid | Skill 模板 | name, description, `spec(jsonb)`(type/content), created_by, 时间戳, deleted_at |
| `audit_logs` | bigserial | 审计 | actor_user_id, actor_name, actor_email, action, target_type, target_id, target_name, `detail(jsonb)`, ip, user_agent, request_id, created_at(索引) |
| `policies` | id(单行=1) | 全局策略 | idle_timeout_seconds, scheduled_stop_policy(jsonb), default_cpu_request, default_memory_request, default_pvc_size, updated_by, updated_at, version(乐观锁) |
| `template_applies` | uuid | 应用记录 | template_type, template_id, template_name(冗余), target_user_id, target_agent_id, status(success/failed), error, applied_by, applied_at |

**软删除与级联**：模板表用 `deleted_at` 软删除；`template_applies` 保留 `template_name` 冗余，即使模板被软删除，审计记录仍可读。

**模板 `spec` 字段对齐点**：见第 12 节，实现前必须对照 QwenPaw Pod 配置 API 核对字段名。

## 7. API 设计

所有 admin 路由在 control-plane 现有 `Auth + AdminOnly` 中间件之后。认证路由 `/api/auth/*` 公开（除 refresh/logout 需 token）。

```
认证（三端共享, /api/auth/*）
  GET  /api/auth/login?redirect_uri=     返回上游 OIDC auth URL
  GET  /api/auth/callback                code 换 token, upsert accounts, 颁发 access+refresh
  POST /api/auth/refresh                 refresh token 换新 access
  POST /api/auth/logout                  撤销 refresh token
  POST /api/auth/dev-login               dev 模式直接签发(生产关)
  GET  /.well-known/jwks.json            RS256 公钥(三端验签)

总览/用户（/api/admin/*）
  GET  /stats                         总览统计(总用户=accounts数 / 在线实例=CRD running / 今日活动=审计今日事件数 / 禁用=accounts is_disabled)
  GET  /users                         用户·实例列表(分页/搜索/状态筛选, CRD+accounts)
  GET  /users/:id                     用户详情(CRD状态+治理状态+被应用过的模板)

实例治理
  POST /users/:id/instance/activate   强制启动(复用 instance service, 记审计)
  POST /users/:id/instance/deactivate 强制停止

用户治理
  POST /users/:id/disable             禁用(body: reason)
  POST /users/:id/enable              启用

OIDC 配置（集中管理）
  GET  /oidc/config                   读当前生效配置(client_secret 脱敏)
  POST /oidc/config/test              测试待生效配置(不落库不生效)
  PUT  /oidc/config                   二次确认写入 + 热加载(需先 test 通过)

全局策略
  GET  /policy                        读
  PUT  /policy                        改(写库+热更新内存, 乐观锁, 记审计)

审计
  GET  /audit-logs                    查询/筛选(actor/target/action/时间)/分页
  GET  /audit-logs/export             导出 CSV

模板库(CRUD 三类同构: agents / mcps / skills)
  GET    /templates/{type}
  POST   /templates/{type}
  GET    /templates/{type}/:id
  PUT    /templates/{type}/:id
  DELETE /templates/{type}/:id        软删除
  POST   /templates/agents/:id/apply          应用Agent模板到用户(同步直连Pod)
  POST   /templates/mcps/:id/apply            把MCP加到指定用户的某Agent
  POST   /templates/skills/:id/apply          把Skill加到指定用户的某Agent
```

### 三个关键生效机制

1. **禁用用户生效**：在 OIDC 登录回调（`/api/auth/callback`，签 token 前查 `accounts.is_disabled` → 拒绝登录）和实例 `activate`（`instance.go`，启动前查 → 拒绝）处校验。
2. **策略改了生效**：`policies` 单行表，control-plane 启动加载到内存；`PUT /policy` 写库 + 热更新内存。新实例创建用内存策略值写 CRD `spec`。**存量实例不变**（声明式，除非强制 reconcile）——策略页需明示告知。
3. **模板应用（v1 同步）**：`apply` 时 control-plane 取目标用户 Pod 提权令牌（复用 `GetConnectInfo` 读 `qwenpaw-token-{name}` Secret），直连 Pod 配置 API 创建/更新 Agent 并关联选定的 MCP/Skill；结果写 `template_applies` + `audit_logs`。Pod 离线 → 返回错误，管理员稍后重试。

### API 约定（横切）
- **分页**：`?page=1&page_size=20`（offset 分页 v1）；响应 `{items, total, page, page_size}`。cursor 分页留 v2。
- **错误响应统一**：`{"error": "message", "code": "ERROR_CODE", "detail": {}, "request_id": "..."}`。
- **鉴权**：Bearer JWT（Authorization 头）。无 cookie session，无 CSRF 风险。
- **版本**：现有路由无版本前缀，本 spec 沿用 `/api/admin`、`/api/auth`；未来破坏性变更再加 `/api/v1/`。
- **权限粒度**：v1 仅 admin/non-admin 二分（`AdminOnly` 中间件）。不做细粒度角色（只读管理员等）——留待未来。

## 8. 前端信息架构与页面

### 侧边栏导航（按职责分组，对齐 DESIGN.md 分组标题 Label 级）

```
监控
  总览                    /

治理
  用户与实例              /users
  全局策略                /policy
  OIDC 配置              /oidc

配置
  模板库                  /templates

系统
  审计日志                /audit
  外观                    /appearance
```

现有 `Instances` 页改造为"用户与实例"（CRD 驱动），`Appearance` 保留为主题切换。新增"用户详情""OIDC 配置""模板库"。

### 页面职责与关键交互

| 路由 | 页面 | 内容 / 交互 | 数据来源 |
|---|---|---|---|
| `/` | 总览 | 4 张统计卡（总用户数 / 在线实例数 / 今日活动 / 禁用用户数）+ 实例状态分布 + 最近活动流。统计卡可下钻到对应列表 | `GET /stats` + `GET /audit-logs`(limit) |
| `/users` | 用户与实例 | 表格：用户/邮箱/实例状态/ingress/创建时间/最后活跃/治理状态。搜索、按状态筛选、分页。行操作：查看详情、强制启停、禁用/启用 | `GET /users` |
| `/users/:id` | 用户详情 | 三区块：①CRD 实例状态（状态/ingress/资源/启停）②治理状态（禁用开关+原因+历史）③已应用模板记录（`template_applies`）。顶部"应用模板"入口 | `GET /users/:id` |
| `/templates` | 模板库 | 单页三 Tab：Agent / MCP / Skill。每 Tab 模板列表 + 新建/编辑/删除。模板行"应用到用户"→ 对话框选目标用户（+目标 Agent，对 MCP/Skill）→ 同步应用，实时显示成功/失败 | `GET/POST/PUT/DELETE /templates/{type}` + `POST .../apply` |
| `/policy` | 全局策略 | 表单：空闲超时、定时停止策略、默认 CPU/内存/PVC。保存写库 + 热更新。明示文案："修改仅对新创建的实例生效，存量实例不变" | `GET/PUT /policy` |
| `/oidc` | OIDC 配置 | **可编辑表单**：provider_url/client_id/client_secret/scopes/redirect_uri/admin allowlist。"测试连接"按钮 → 通过后"保存"二次确认生效。明示"保存即热加载，无需重启；测试失败不会生效" | `GET /oidc/config` + `POST /test` + `PUT` |
| `/audit` | 审计日志 | 表格：时间/操作人/动作/对象类型/对象名/详情。筛选：操作人、对象、动作类型、时间范围。分页 + 导出 CSV | `GET /audit-logs` + `/export` |
| `/appearance` | 外观 | 亮/暗主题切换（保留现有） | 本地 |

### 两个关键交互形态

**模板应用（对话框，非独立页）**：从模板库列表或用户详情发起 → 选目标用户（+对 MCP/Skill 再选该用户的 Agent）→ 点"应用"→ 前端同步等待结果 → 成功显示"已应用到 {用户}"，失败显示原因（如"该用户 Pod 离线，请稍后重试"）。全程记审计。v1 不做批量队列；v2 才有"应用到多个用户"的任务列表。

**强制启停 / 禁用启用**：行内按钮 + AlertDialog 二次确认（destructive 变体）。禁用需填"原因"（写入审计）。

**OIDC 配置保存**：编辑 → "测试连接"（调 `/test`，显示 IdP 可达 + client 配置校验结果）→ 测试通过后"保存并生效"按钮才可点（`/PUT`）→ 成功提示"已热加载"。测试失败给出原因，不生效。

### 与设计语言对齐
- 全部复用 workpaw-ui 的 Card / Table / Dialog / AlertDialog / Badge / Button，不新建组件语义。
- 状态指示三态（running/stopped/creating）配图标+文字不靠颜色（色盲安全）。
- 表格疏朗：行高 ≥ 48px，不拥挤（拒 AntD 紧凑、拒 Grafana 密集）。
- Signal Orange 只出现在主操作（应用模板、保存策略/配置）与当前选中态，占比 ≤10%。
- **i18n**：v1 仅中文，i18next 框架保留以备未来（与全局一致）。

## 9. 数据流

**A. 模板应用（v1 核心）**
```
admin 点"应用"
  → Agent 模板: 选目标用户 → 为该用户新建 Agent
  → MCP/Skill 模板: 选目标用户 + 选该用户的某 Agent → 加到该 Agent
  → POST /admin/templates/{type}/:id/apply
  → control-plane: 取 accounts(校验未禁用) → GetConnectInfo 取 Pod 提权令牌
  → 直连 Pod 配置 API (按 name 先查再 upsert, 幂等)
  → 成功: 写 template_applies(status=success) + audit_logs → 200
  → 失败: 写 template_applies(status=failed,error) + audit_logs → 4xx/5xx 带原因
```

**B. 禁用用户生效**
```
admin POST /admin/users/:id/disable (reason)
  → accounts.is_disabled=true + audit_logs
  → 该用户后续: /api/auth/callback 签 token 前查 is_disabled → 拒绝登录
             实例 activate 前查 is_disabled → 拒绝启动
```
注：禁用用户的实例 `activate`（含 admin 强制启动）一律拒绝，需先启用；`deactivate`（强制停止）不受禁用影响，可用于停掉禁用用户的运行中实例。

**C. 审计贯穿**：所有 admin 写操作（启停/禁用启用/策略改/OIDC 改/模板 CRUD/模板应用/导出）统一经一个 `audit.Log(action, target, detail)` helper，在 handler 成功路径后调用，actor 从 JWT claims 取，request_id 从中间件取。

**D. OIDC 配置热加载**：admin `PUT /oidc/config` → 写 `oidc_configs` → control-plane 重新初始化 OIDC service（新 provider/client 配置）→ 后续 `/api/auth/login` 用新配置。无需重启。

## 10. 错误处理

| 场景 | 处理 |
|---|---|
| Pod 离线/不可达（apply） | 同步返回 503 + 明确原因"用户 Pod 离线"，记 failed；前端提示稍后重试。不阻塞 |
| 提权令牌缺失（Secret 不存在） | 返回 409"实例未就绪，无法配置"；提示先启动实例 |
| Pod 配置 API 字段冲突 | 透传 Pod 返回的 4xx + 详情；记 failed |
| 并发：多管理员同时操作同一用户 | Pod API 按 name upsert 天然幂等（apply 前先查再 update/create）；策略/OIDC 用乐观锁（version），冲突返回 409 |
| OIDC 测试连接失败 | `/test` 返回 4xx + 原因（IdP 不可达/client 无效），不落库不生效；前端禁用"保存" |
| OIDC 配置改错锁死 | 靠"测试连接 + 二次确认"前置拦截；万一仍锁死，回退 config.yaml bootstrap（清 `oidc_configs` 表或环境变量绕过 DB 配置） |
| access token 过期 | 前端用 refresh token 调 `/api/auth/refresh`；refresh 也过期则跳登录 |
| Postgres 不可用 | 启停实例等不依赖 DB 的操作仍可用；认证/accounts/模板/审计/治理返回 503。健康检查暴露 DB 状态 |
| K8s API 不可用 | 用户/实例列表 503；总览统计降级显示"暂时不可用"而非整页崩 |
| 非 admin 访问 | `AdminOnly` 中间件 403；前端未带 admin role 的 JWT 不进入受保护路由 |

## 11. 测试策略

**后端（Go，最重）**
- `service` 层单元测试：模板 CRUD、`template_applies` 写入、禁用校验、OIDC 热加载、refresh token 换发与撤销，用接口 mock 掉 K8s/Pod/IdP 调用。
- 模板应用：fake K8s client + mock Pod HTTP（httptest）验证"取令牌→调 Pod→写记录"全链路，覆盖成功/Pod 离线/令牌缺失/字段冲突四态。
- 认证：JWT RS256 签发/验签（JWKS）、`/auth/callback` accounts upsert + 禁用拒绝、`/auth/refresh`、`/auth/logout` 撤销。
- OIDC 集中管理：`/oidc/test` mock IdP（httptest）覆盖可达/不可达；`PUT` 热加载验证后续 login 用新配置。
- handler 层：`httptest` 验证路由、AdminOnly 拦截、审计写入、统一错误响应结构。
- 集成：Postgres 用 testcontainer（真实库验证 auto-migrate + GORM 查询 + client_secret 加解密）。
- 幂等：重复 apply 同一模板到同一用户，验证不产生重复 Agent。

**前端**
- 组件测试：模板库 Tab、应用对话框、用户表格筛选、禁用确认、OIDC 配置测试连接+保存流程。
- 关键流程：模板应用成功/失败两态；OIDC 测试失败时"保存"被禁用；强制启停二次确认。
- 复用 workpaw-ui 组件，组件本身不重测。

**不测**：上游 IdP（Keycloak）本身、QwenPaw Pod 内部配置逻辑（黑盒，按其 API 契约测）。

## 12. 实现前对齐点（写实现计划前必须核查）

1. **模板 `spec` 字段对齐 QwenPaw Pod 配置 API**：核查 workpaw-ui / workpaw-web 中 Agent / MCP / Skill 的类型定义与 workpaw-web 对 Pod 配置 API 的调用（路径、请求体字段），确保三类模板 `spec` 与 Pod API 契约一致，否则 apply 无法工作。
2. **Pod 提权令牌**：确认 control-plane 现有 `GetConnectInfo` 读取的 `qwenpaw-token-{name}` Secret 中的 token 能用于 Pod 配置 API 写操作（workpaw-web 用同 token 直连 Pod 改配置已验证），确认 Pod 配置 API 鉴权方式（Bearer）。
3. **GORM auto-migrate → golang-migrate 路径**：v1 用 auto-migrate，仓库内预留 `db/migrations/` 目录与初始 migration，便于 v2 切换。
4. **策略字段对齐 CRD spec**：确认 `QwenPawInstance` CRD 的 `spec` 中资源/超时字段名，确保 `policies` 表字段能正确写入 CRD。
5. **CRD status 字段**：确认 `QwenPawInstance` status 是否暴露 lastActiveAt 等字段；列表与总览的"最后活跃"依赖此字段，若 CRD 不提供则改由审计日志最近事件推导。
6. **JWT RS256 密钥与 JWKS**：确认 RS256 私钥来源（K8s Secret 或环境变量）、轮换策略、JWKS 端点对三端的可访问性；三端（含 Tauri）验签库选型。
7. **OIDC 配置热加载**：确认 Go OIDC 库（如 `coreos/go-oidc`）支持运行时替换 provider 配置，或 control-plane 重建 OIDC service 实例。
8. **client_secret 加密主密钥**：确认 `WORKPAW_DB_SECRET_KEY` 部署方式（K8s Secret 注入），密钥轮换对存量加密字段的影响。

## 13. 横切约定

- **i18n**：v1 仅中文，i18next 框架保留。
- **多租户**：v1 单企业单租户，未来多企业需在各表加 `tenant_id`。
- **健康检查**：`GET /health` 返回 `{db, k8s, oidc}` 各依赖状态，供运维与 K8s 探针。
- **Pod 侧审计身份**：admin 代用户操作时，Pod 配置 API 见到的是用户 token（用户身份），admin 身份只在 control-plane `audit_logs` 记录。可接受，不要求 Pod 侧感知 admin。
- **CSRF**：Bearer JWT（localStorage），无 cookie session，无 CSRF 风险。
- **速率限制**：v1 不做；v2 对 `/audit-logs/export`、`/templates/*/apply` 加速率限制。

## 14. v2 待定（不在本 spec 实现范围）

- `apply_jobs` 表结构、worker 并发与重试策略、幂等键设计。
- Prometheus 接入：指标来源（cadvisor / kube-state-metrics）、仪表盘指标集、刷新频率。
- 批量应用模板到多用户的 UI 与任务列表。
- access token 黑名单 / 主动撤销（v1 靠短 TTL + refresh 撤销）。
- 细粒度角色（只读管理员等）。
- cursor 分页。

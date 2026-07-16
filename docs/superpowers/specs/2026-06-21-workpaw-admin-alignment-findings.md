# workpaw-admin/console 对齐点核查结果

> 日期：2026-06-21
> 对应 spec：`2026-06-21-workpaw-admin/console-design.md` §12（实现前对齐点）
> 目的：写实现计划前必须确认的 8 项对齐点，提供真实字段名、路径与类型名

## 1. 模板 `spec` 字段对齐 QwenPaw Pod 配置 API

### 核查内容
Agent / MCP / Skill 三类模板 `spec` jsonb 字段与 QwenPaw Pod 配置 API 契约是否一致。

### 文件读取
- `workpaw-web/src/api/types/agents.ts`
- `workpaw-web/src/api/types/mcp.ts`
- `workpaw-web/src/api/types/skill.ts`
- `workpaw-web/src/api/types/agent.ts`（`AgentsRunningConfig`）
- `workpaw-web/src/api/modules/agents.ts`
- `workpaw-web/src/api/modules/mcp.ts`
- `workpaw-web/src/api/modules/skill.ts`
- `workpaw-web/src/api/modules/agent.ts`
- `workpaw-ui/src/types/agent.ts`
- `workpaw-web/src/types/index.ts`

### 结论

**Agent 模板 `spec` 应存储字段（对应 `CreateAgentRequest` + `AgentProfileConfig`）**：
- `id?: string`
- `name: string`
- `description?: string`
- `workspace_dir?: string`
- `language?: string`
- `skill_names?: string[]`
- `active_model?: ModelSlotConfig | null`（`ModelSlotConfig { provider, model, base_url?, api_key?, temperature?, max_tokens? }`）
- `approval_level?: string`
- `channels?: unknown`
- `mcp?: unknown`
- `heartbeat?: unknown`
- `running?: AgentsRunningConfig`（完整运行时配置，见 `agent.ts`）
- `llm_routing?: unknown`
- `system_prompt_files?: string[]`
- `tools?: unknown`
- `security?: unknown`

Pod API：
- `POST /api/agents`（createAgent，body = `CreateAgentRequest`）
- `PUT /api/agents/:agentId`（updateAgent，body = `AgentProfileConfig`）
- `DELETE /api/agents/:agentId`
- `PATCH /api/agents/:agentId/toggle`（body `{ enabled: boolean }`）
- `PUT /api/agents/order`（body `{ agent_ids: string[] }`）

**MCP 模板 `spec` 应存储字段（对应 `MCPClientCreateRequest.client` / `MCPClientUpdateRequest`）**：
- `name: string`
- `description?: string`
- `enabled?: boolean`
- `transport?: "stdio" | "streamable_http" | "sse"`
- `url?: string`（remote MCP endpoint）
- `headers?: Record<string, string>`
- `command?: string`（stdio 启动命令）
- `args?: string[]`
- `env?: Record<string, string>`
- `cwd?: string`
- 创建时顶层还需 `client_key: string`（唯一标识）

Pod API：
- `GET /api/mcp`（listMCPClients）
- `POST /api/mcp`（createMCPClient，body = `MCPClientCreateRequest`）
- `PUT /api/mcp/:clientKey`（updateMCPClient，body = `MCPClientUpdateRequest`）
- `DELETE /api/mcp/:clientKey`
- `PATCH /api/mcp/toggle/:clientKey`
- `GET /api/mcp/tools/:clientKey`（listMCPTools）
- `PUT /api/mcp/tools/:clientKey`（updateMCPToolWhitelist，body `{ tools: string[] | null }`）
- OAuth 端点：`/mcp/oauth/start/:key`、`/mcp/oauth/status/:key`、`DELETE /mcp/oauth/:key`（admin 模板推送不涉及）

**Skill 模板 `spec` 应存储字段（对应 `SkillSpec`）**：
- `name: string`
- `description?: string`
- `version_text?: string`
- `content: string`（Markdown 正文）
- `source: string`
- `enabled?: boolean`
- `channels?: string[]`
- `tags?: string[]`
- `config?: Record<string, unknown>`
- `last_updated?: string`
- `emoji?: string`
- `installed_from?: string`

Pod API：
- `GET /api/skills`（listSkills，可选 header `X-Agent-Id`）
- `POST /api/skills`（createSkill，body `{ name, content, config, enable }`）
- `PUT /api/skills/save`（saveSkill，body `{ name, content, source_name?, config?, overwrite? }`）
- `DELETE /api/skills/:name`
- `POST /api/skills/:name/enable`、`POST /api/skills/:name/disable`
- `PUT /api/skills/:name/channels`（body `string[]`）、`PUT /api/skills/:name/tags`（body `string[]`）、`PUT /api/skills/:name/config`（body `{ config }`）
- Pool API（`/api/skills/pool/*`）用于 skill pool 管理，admin 模板推送场景使用 workspace 级 API 即可

**workpaw-ui `Agent` 类型**（`workpaw-ui/src/types/agent.ts`）仅为摘要：`{ id, name, description, avatar?, enabled }`，不用于 Pod 写操作，模板 `spec` 应以 workpaw-web 的 `AgentProfileConfig` / `CreateAgentRequest` 为准。

### 解锁
Plan 3（模板 spec 字段定义 + apply 逻辑 + 前端模板表单字段）。

---

## 2. Pod 提权令牌

### 核查内容
`GetConnectInfo` 读取的 `qwenpaw-token-{name}` Secret 的 token 是否能用于 Pod 配置 API 写操作，以及 Pod API 鉴权方式。

### 文件读取
- `workpaw-admin/internal/service/instance.go`（第 240–273 行，`GetConnectInfo`）
- `workpaw-web/src/stores/useInstanceStore.ts`
- `workpaw-web/src/lib/api.ts`（`createPodAgentApi`、`PodAgentApi`、`ApiClient.buildHeaders`）
- `workpaw-web/src/api/authHeaders.ts`

### 结论
确认：
- `instance.go:243` 构造 Secret 名：`qwenpaw-token-{instanceName(userID)}`
- `instance.go:251` 读取 key `api-token`
- `instance.go:269` 返回 `ConnectInfo{ IngressURL, APIToken }`
- workpaw-web `connectToPod`（`useInstanceStore.ts`）调用 `api.getConnectInfo()` 拿到 `{ ingress_url, api_token }` 后调 `createPodAgentApi(connectInfo.ingress_url, connectInfo.api_token)`
- `createPodAgentApi`（`lib/api.ts:223`）创建 `ApiClient`，`getToken: () => podToken`，所有请求带 `Authorization: Bearer ${podToken}`（`ApiClient.buildHeaders` 第 33–38 行）
- Pod 配置 API 鉴权方式：**Bearer token**，token 与 QwenPaw Pod 启动时写入 Secret 的 privilege token 一致

admin 模板 apply 操作可完全复用 `GetConnectInfo` 拿到的 `api_token` 直连 Pod 做写操作，与 workpaw-web 已验证的路径一致。

### 解锁
Plan 2（OIDC 热加载 + admin API）中的 apply 逻辑（取令牌直连 Pod）。

---

## 3. GORM auto-migrate → golang-migrate 路径

### 核查内容
确认 v1 用 GORM auto-migrate、仓库预留 `db/migrations/` 路径与初始 migration 的实现策略。

### 结论
这是 spec §6 已明确的工程策略决定，无需代码核查：
- v1：GORM `AutoMigrate()` 起步
- 仓库内预留 `db/migrations/` 目录与 `000001_init.up.sql` / `000001_init.down.sql` 初始文件
- v2 切换到 golang-migrate，auto-migrate 代码保留但仅在测试中调用

### 解锁
Plan 2（DB 层地基 + PostgreSQL schema）。

---

## 4. 策略字段对齐 CRD spec

### 核查内容
`QwenPawInstance` CRD 的 `spec` 字段名，确保 `policies` 表字段能正确写入 CRD。

### 文件读取
- `workpaw-operator/api/v1alpha1/qwenpawinstance_types.go`
- `workpaw-admin/internal/service/instance.go`（`ActivateInstance` 第 186–209 行）

### 结论

**CRD spec 字段映射**：

| `policies` 表字段 | CRD 路径 | Go 类型 | json tag | 单位 / 格式 |
|---|---|---|---|---|
| `idle_timeout_seconds` | `.spec.policy.idleTimeoutMinutes` | `int` | `idleTimeoutMinutes` | **CRD 是分钟，spec 是秒，需转换**（`seconds/60 → minutes`） |
| `scheduled_stop_policy(jsonb)` | `.spec.policy.scheduleStop` | `string` | `scheduleStop` | `HH:MM` 格式 |
| （jsonb 内 `scheduleStart`） | `.spec.policy.scheduleStart` | `string` | `scheduleStart` | `HH:MM` 格式 |
| `default_cpu_request` | `.spec.resources.cpu` | `string` | `cpu` | K8s quantity（如 `"500m"`、`"2000m"`） |
| `default_memory_request` | `.spec.resources.memory` | `string` | `memory` | K8s quantity（如 `"1Gi"`、`"4Gi"`） |
| `default_pvc_size` | `.spec.storage.size` | `string` | `size` | K8s quantity（如 `"10Gi"`） |

**关键注意点**：
- `policies.idle_timeout_seconds`（秒）与 CRD `idleTimeoutMinutes`（分钟）单位不一致，写入 CRD 时需 `seconds / 60`，读取时 `minutes * 60`。Plan 2 实现时务必处理。
- `instance.go:198` 现有代码 `ActivateInstance` 创建 CR 时写 `Policy.IdleTimeoutMinutes = s.cfg.Policy.DefaultIdleTimeoutMinutes`（config.yaml 值，已是分钟）——说明现有 config 已用分钟，`policies` 表改用秒是新设计决定，转换逻辑需加在 `policy_service.go`（Plan 2）。
- CRD 还有 `DesiredState string`（`Running`/`Stopped`）用于强制启停，直接修改 `.Spec.DesiredState` 即可。

**CRD status 字段**（见对齐点 5）。

### 解锁
Plan 2（policy 表 + admin 策略 API + CRD 写逻辑）。

---

## 5. CRD status 字段

### 核查内容
`QwenPawInstance` status 是否暴露 `lastActiveAt` / `currentState` / `ingressHost`。

### 文件读取
- `workpaw-operator/api/v1alpha1/qwenpawinstance_types.go`（第 88–115 行）
- `workpaw-admin/internal/service/instance.go`（`mapInstanceStatus` 第 280–305 行）

### 结论

**CRD status 字段**（`QwenPawInstanceStatus`）：

| 字段 | json tag | 类型 | 说明 |
|---|---|---|---|
| `CurrentState` | `currentState` | `string` | `Creating` / `Running` / `Stopped` / `Error`（Title case） |
| `PodName` | `podName` | `string` | Pod 名 |
| `PodIP` | `podIP` | `string` | Pod IP |
| `IngressHost` | `ingressHost` | `string` | Ingress hostname |
| `LastActiveAt` | `lastActiveAt` | `string` | 最后活跃时间戳（**已存在**） |
| `Conditions` | `conditions` | `[]metav1.Condition` | 标准 K8s conditions |

**关键发现**：`LastActiveAt` 已在 CRD status 中定义，control-plane `mapInstanceStatus` 也已读取（`instance.go:301`：`instance.Status.LastActiveAt`）。admin 用户列表的"最后活跃"可直接从 CRD 读取，**无需**回退到审计日志推导。Plan 2 不需要实现"从 audit_logs 推导 last active"的降级逻辑。

注：`LastActiveAt` 的实际更新由 workpaw-operator 负责（operator 侧逻辑未在本次核查范围内，但字段存在即表示 operator 会维护它）。

### 解锁
Plan 2（用户列表 + 总览统计）、Plan 3（用户详情页"最后活跃"展示）。

---

## 6. JWT RS256 密钥与 JWKS

### 核查内容
RS256 私钥来源、轮换策略、JWKS 端点对三端的可访问性、三端验签库选型。

### 文件读取
- `workpaw-admin/internal/service/jwt.go`（现有 HS256 实现）
- `workpaw-admin/internal/config/`（配置结构，间接）

### 决定（本任务确定，Task 4 实现）

**RS256 私钥来源**：
- 配置项：`jwt.private_key_path`（PEM 文件路径，PKCS#8 或 PKCS#1 均可）
- 生产部署：PEM 文件通过 K8s Secret mount 到 Pod，路径注入 config.yaml
- Debug 模式：若 `jwt.private_key_path` 为空，**在内存中生成 2048-bit RSA 临时密钥对**（tokens 在重启后失效，dev 环境可接受）
- 不轮换（v1 不做 key rotation，重启用新密钥，旧 token 失效；access token TTL 15min 可接受）

**kid 计算**：
- `kid = base64url(sha256(SPKI_DER_of_public_key))[:16]`
- 即：对公钥的 SubjectPublicKeyInfo ASN.1 DER 编码做 SHA-256，取结果的 base64url 编码的前 16 个字符

**JWKS 端点**：
- `GET /.well-known/jwks.json`，公开，无需认证
- 返回 `{"keys": [{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "...", "n": "...", "e": "..."}]}`
- 三端（web / admin / desktop）+ control-plane 自身均通过此端点获取公钥验签

**三端验签库选型**：
- web / admin（JS）：`jose` 库（`jose` npm 包，支持 JWKS client 自动缓存与轮换），或 `jwt-decode` + 手动 JWKS fetch
- desktop（Tauri webview）：同 web，使用同一 JS 库
- **具体 JS 库选型是 Plan 3 的任务**，此处仅记录需要选型，不决定

**现有 HS256 代码**（`jwt.go`）将被完全替换：`JWTService.secret []byte` → `privateKey *rsa.PrivateKey` + `publicKey *rsa.PublicKey` + `kid string`；`jwt.SigningMethodHS256` → `jwt.SigningMethodRS256`。

### 解锁
Plan 1 Task 4（RS256+JWKS 实现）的直接输入。

---

## 7. OIDC 配置热加载

### 核查内容
`coreos/go-oidc` 是否支持运行时替换 provider 配置。

### 文件读取
- `workpaw-admin/internal/service/oidc.go`（`NewOIDCService` 第 52–78 行）

### 结论
- `NewOIDCService(ctx, cfg, stateKey)` 创建全新的 `*OIDCService`，内部调用 `oidc.NewProvider(ctx, cfg.IssuerURL)` 做 HTTP discovery
- `oidc.NewProvider` 是无状态的 HTTP 调用，可在运行时任意时刻调用以创建新 provider
- **热加载方案**：实现 `OIDCServiceManager`（atomic.Value 或 sync.RWMutex 持有当前 `*OIDCService`），`PUT /api/admin/oidc/config` 后用新配置 `NewOIDCService()` 构造新实例，原子替换。后续 `/api/auth/login` 使用新实例。
- 替换过程中的 in-flight 请求：旧实例完成处理，新请求用新实例，无中断
- `stateKey`（HMAC key for OIDC state tokens）跨实例共享，重启不失效（in-flight state tokens 仍可用）

### 解锁
Plan 2（OIDC 集中管理 + 热加载）。

---

## 8. client_secret 加密主密钥

### 核查内容
`WORKPAW_DB_SECRET_KEY` 部署方式与密钥轮换对存量加密字段的影响。

### 结论

**部署方式**：
- K8s Secret 注入环境变量 `WORKPAW_DB_SECRET_KEY`
- 控制面启动时读取，缺失则拒绝启动（production）或生成临时 key 并告警（debug）
- 密钥长度：32 bytes（256-bit），用于 AES-256-GCM

**加密格式**：
- 存储格式：`base64(nonce || ciphertext || tag)`，nonce 12 bytes
- 解密时从 base64 解码后分离 nonce 与 ciphertext+tag，调用 AES-GCM Open

**密钥轮换**（v1 不做，记为 v2 开放问题）：
- v1 不支持在线轮换；改主密钥需手动重加密存量 `oidc_configs.client_secret_enc`
- v2 可引入 key version 前缀（如 `v1:<encrypted>`）支持多版本密钥并存与渐进轮换

**缺失处理**：
- production：`WORKPAW_DB_SECRET_KEY` 缺失 → control-plane 启动失败并日志告警
- debug：缺失 → 生成 32-byte 随机 key（仅内存，重启后旧加密字段失效，dev 环境可接受）

### 解锁
Plan 2（OIDC 配置表 + client_secret 加解密 + admin OIDC 配置 API）。

---

## 开放问题（留给后续 Plan）

1. **Plan 3（JS 验签库选型）**：`jose` vs `jwt-decode` + 手动 JWKS，需评估包体积、JWKS 缓存、与 workpaw-ui 现有依赖的契合度。
2. **Plan 3（Skill 模板推送的"source"字段）**：`SkillSpec.source` 字段语义（如 `"user"` / `"builtin"` / `"hub"` / `"template"`）需在 Plan 3 模板推送逻辑中明确，避免与 Pod 内置 source 冲突。
3. **Plan 2（idle_timeout 单位转换）**：`policies.idle_timeout_seconds` 与 CRD `idleTimeoutMinutes` 单位不一致，需显式转换，已记录在对齐点 4。
4. **v2（主密钥轮换）**：`WORKPAW_DB_SECRET_KEY` 轮换机制，已记录在对齐点 8。

---

## 文件读取清单

| 文件 | 对齐点 |
|---|---|
| `workpaw-web/src/api/types/agents.ts` | 1 |
| `workpaw-web/src/api/types/mcp.ts` | 1 |
| `workpaw-web/src/api/types/skill.ts` | 1 |
| `workpaw-web/src/api/types/agent.ts` | 1 |
| `workpaw-web/src/api/modules/agents.ts` | 1 |
| `workpaw-web/src/api/modules/mcp.ts` | 1 |
| `workpaw-web/src/api/modules/skill.ts` | 1 |
| `workpaw-web/src/api/modules/agent.ts` | 1 |
| `workpaw-ui/src/types/agent.ts` | 1 |
| `workpaw-web/src/types/index.ts` | 1 |
| `workpaw-web/src/stores/useInstanceStore.ts` | 2 |
| `workpaw-web/src/lib/api.ts` | 2 |
| `workpaw-web/src/api/authHeaders.ts` | 2 |
| `workpaw-admin/internal/service/instance.go` | 2, 4, 5 |
| `workpaw-operator/api/v1alpha1/qwenpawinstance_types.go` | 4, 5 |
| `workpaw-admin/internal/service/jwt.go` | 6 |
| `workpaw-admin/internal/service/oidc.go` | 7 |

# 首次登录等待体验优化 — 设计文档

- **状态**：Draft，待 review
- **日期**：2026-07-05
- **范围**：跨三仓 — `workpaw-desktop`（前端）/ `workpaw-admin`（后端）/ `workpaw-operator`（K8s）
- **关联**：承接 `2026-07-03-multi-enterprise-sso-design.md`（登录改造）与 `2026-07-03-workpaw-desktop-redesign.md`（桌面重设计）

---

## 1. 背景

用户**首次**登录 desktop 时，系统为其创建个人容器（QwenPaw Pod + Service + Ingress）并注入配置，这是一个耗时过程。当前用户在此期间面对一个**无进度的 spinner + 与真实进度无关的本地计时器文案**，180s 硬超时后只给「稍后再试」。本设计旨在：(a) 真实缩短首次等待；(b) 把等待过程变成可感知、可操作；(c) 用 warm pool 达到「命中即用」的一劳永逸终态。

---

## 2. 现状与根因（已通过代码核查确认）

### 2.1 真实时序（首次登录）

```
1. 浏览器 SSO 登录           ← 外部耗时；后端完全空闲（空窗被浪费）
2. deep link/loopback 回调 → setToken → isAuthenticated=true
3. App.tsx effect → fetchInstance() → GET /api/instance → status="not_found"
4. 自动 activate() → POST /api/instance/activate
   └─ control-plane 仅 k8sClient.Create 一个 CR（毫秒级返回 "creating"，fire-and-forget）
5. operator 异步 reconcile：Secret → StatefulSet(+PVC 10Gi) → Service → Ingress
   └─ Pod 由 StatefulSet controller 拉起：镜像拉取 + 容器启动
   └─ ReadinessProbe /api/agent/health，InitialDelay=60s（硬下限）
   └─ operator 每 10s RequeueAfter 才把 status 翻成 Running
6. ConfigReconciler 每 60s 一轮才把 agent/mcp/skill/provider 配置推进 Pod  ← 又最多 60s
7. 前端 pollUntilRunning：每 3s 轮询，看到 running → GET /api/instance/connect → 接入
```

### 2.2 关键证据（文件:行）

| 问题 | 证据 |
|---|---|
| 登录路径不创建容器（仅账号 upsert） | `workpaw-admin/internal/handler/auth.go:115-286`、`internal/service/account.go:39-117` |
| activate 是 fire-and-forget | `internal/service/instance.go:229-293`（只 `k8sClient.Create`，立即 return） |
| readiness 60s 硬下限 | `workpaw-operator/internal/controller/qwenpawinstance_controller.go:445-468` |
| operator 10s requeue | `qwenpawinstance_controller.go:702,720` |
| 配置同步 60s 轮询 | `workpaw-admin/internal/service/config_reconciler.go:68-89`，默认 `interval_seconds=60`（`internal/config/config.go:107-109`） |
| 前端假计时器 | `workpaw-desktop/src/components/ContainerGate.tsx:16-43`（本地 1s timer 驱动文案） |
| 前端 180s 硬超时轮询 | `workpaw-desktop/src/stores/useInstanceStore.ts:87-105`（60×3s） |
| 无 SSE/WebSocket 用于容器状态 | desktop 全局 `EventSource`/`WebSocket` 0 命中（SSE 仅用于 chat 流式） |
| 无任何预热/池化 | operator + control-plane `warmup|pool|prePull|standby` 0 命中 |

### 2.3 痛点归类

- **真的慢**：readiness 60s 硬下限 + 镜像拉取（无预热）+ 配置同步最多再 60s + SSO 期间后端空等。
- **体验差**：无进度 spinner + 假计时器文案（「1 分钟/30 秒」是产品假设）+ 180s 硬超时后只给「稍后再试」。

---

## 3. 目标 / 非目标

### 3.1 目标
- **T1（终态）**：warm pool 命中时，首次登录到可用 **< 10s**（不含用户在浏览器的 SSO 耗时）。
- **T2（过渡）**：warm pool 未上线前，Phase 1 使首次冷启动从 ~120s 降到 **~25-30s**，且等待过程展示**真实进度阶段**。
- **T3**：等待过程可操作——超时/失败有分类文案与可执行动作；支持「先离开，就绪后通知」。
- **T4**：warm pool 耗尽时自动降级到冷启动路径，前端体验一致。

### 3.2 非目标
- 不改 SSO/OIDC 认证本身（外部耗时不可控）。
- 不改 Pod 内 QwenPaw 应用（v1.1.12 锁定）的启动逻辑。
- 不在本期实现 idle/scheduled policy 的执行者（CRD 字段已存在但无执行器，属独立工作项）。
- 不改 chat/会话/onboarding 业务流程（仅在容器就绪时序上配合）。

### 3.3 假设（如与实际不符请 review 时指出）
- **部署规模**：多企业 / 中等并发；架构**可扩展优先**（从小规模起步，支持弹性扩展与降级到高并发）。
- **「可用」定义**：Pod Running + ingress 可达 + 该用户**专属配置（scope=user）已推送**。
- **实例与用户身份解耦**：实例 name 不再绑定 email 前缀（详见 §7 迁移）。

---

## 4. 总体架构与演进路线

三块**不是平行可选，而是分阶段演进**：

```
Phase 1（治标，先上线）              Phase 2（一劳永逸）
┌─────────────────────────┐        ┌─────────────────────────┐
│ A. 前端体验改造          │        │ C. warm pool             │
│ B. 后端提速精选          │  ───►  │   命中 → 首次 < 10s      │
│   首次 ~120s → ~25-30s  │        │   耗尽 → 降级回 Phase 1  │
└─────────────────────────┘        └─────────────────────────┘
        ▲                                     │
        └──────── A 长期保留 ◄────────────────┘ 作为 pool 耗尽/降级的兜底等待 UX
```

- **Phase 1 的 B「错峰预建」是过渡项**：warm pool 上线后退役（被 pool 的预建取代）。
- **A 在每个阶段都需要**：warm pool 命中时是短过渡；pool 耗尽时是冷启动等待。
- **B 的 startup probe / event-driven 配置同步是 warm pool 的基础设施**：warm 实例也要快速就绪、配置预推。

> **实现计划拆分**：本设计文档统一覆盖三阶段，但后续 `writing-plans` 将按 Phase 1A / 1B / 2 分别产出独立实现计划，分阶段交付。

---

## 5. Phase 1A — 前端体验改造（`workpaw-desktop`，纯前端）

### 5.1 真实进度阶段模型（替换假计时器）

定义统一阶段枚举，由后端真实状态驱动（非本地计时器）：

| 前端可见阶段 `stage` | 含义 | 后端来源（`phase`，见 §6.3） |
|---|---|---|
| `authenticating` | SSO 进行中 | 登录前，前端本地态 |
| `assigning` | 分配实例（领用 warm / 新建） | 后端 `GET /api/instance` 返回 `assignment` 字段（见 §8.2） |
| `starting` | 启动中（含拉镜像/调度/探针） | phase ∈ {pending, provisioning, scheduling, image_pulling, container_starting, probe_pending} |
| `configuring` | 推送用户专属配置 | phase = `config_syncing` |
| `ready` | 就绪 | phase = `running` |

`ContainerGate.tsx` 改造：
- 去掉本地 1s 计时器驱动的三档文案（`ContainerGate.tsx:16-43`）。
- 渲染**阶段步骤条**（5 步），当前步骤高亮 + 已完成步骤打勾；副文由 `stage` + `phase` 子状态派生（如 `starting` + `image_pulling` → 「正在拉取运行环境…」）。
- 保留兜底计时器**仅用于**「同一 stage 停滞过久」的文案递进（如 `starting` 超 40s → 「比你预期久了一点，仍在努力」），不再假装代表整体进度。

### 5.2 SSE 推送 + 轮询兜底

新增 control-plane 端点 `GET /api/instance/events`（SSE，见 §8.3）。desktop 新增 `src/lib/useInstanceEvents.ts`：
- 优先建立 SSE 订阅，收到 `phase` 变化事件即时更新 `useInstanceStore`。
- SSE 建立失败或中途断开 → 自动降级回 3s 轮询（沿用现有 `pollUntilRunning`）。
- 进入 `ready` 或超时后关闭 SSE。

`useInstanceStore.ts:87-105` 的 `pollUntilRunning`：
- 上限从 60×3s=180s 调整为**可配**（默认 240s，给提速后的冷启动留余量，且 warm pool 命中时根本走不到这里）。
- 超时不再只 set error，而是触发 §5.3 的分类兜底。

### 5.3 错误分类与可操作兜底

`ContainerGate.tsx` 错误态按 `error.code` 分支：

| code | 场景 | 文案 | 动作 |
|---|---|---|---|
| `pool_exhausted` | warm pool 耗尽，已降级冷启动 | 「当前注册人数较多，正在为你新开实例（约 30 秒）」 | 继续展示 starting 阶段 |
| `config_sync_failed` | 配置推送失败 | 「环境准备完成，最后一步配置未生效，正在重试」 | 后台指数退避重试；暴露「重试」 |
| `timeout` | 超 240s 未就绪 | 「准备时间过长，你可以先离开，就绪后通知你」 | 「先离开」+ 「重试」 |
| `disabled` | 账户被禁用 | 「你的账户已被管理员停用」 | 「联系管理员」 |
| `unreachable` | Pod 不可达 | 「实例启动异常」 | 「重试」+ 「联系管理员」 |

### 5.4 「先离开，就绪后通知」能力（新增）

- 用户点「先离开」→ desktop 进入 tray 后台；`useInstanceStore` 继续后台轮询（不阻塞 UI）。
- 就绪后通过 tray 通知（复用现有 approval/推送通知通道 `useInboxData.ts`、tray 实现）弹「AI 助手已就绪」。
- 实现依赖 §6.4 的「实例就绪事件」可被后台消费。

### 5.5 涉及文件（desktop）
- 改：`src/components/ContainerGate.tsx`、`src/stores/useInstanceStore.ts`、`src/App.tsx`（接入 SSE）
- 新增：`src/lib/useInstanceEvents.ts`、阶段映射工具 `src/lib/instanceStages.ts`
- 测试：`src/pages/Login.test.tsx` 当前与实现脱节（期望 dev-login 直连，实际走 OIDC），本阶段一并修正为 mock OIDC 回调

---

## 6. Phase 1B — 后端提速精选（`workpaw-admin` + `workpaw-operator`）

### 6.1 错峰预建（过渡项，warm pool 上线后退役）

在 `auth.go` 的 `Callback` 成功 `UpsertOnLogin` 之后，起 goroutine 异步调用 `InstanceService.ActivateInstance`：
- 对每次成功登录都异步触发 `ActivateInstance`；靠其内部幂等（「CR 已存在且 `DesiredState=Running` 则直接返回」，`instance.go:247-252`）避免重复建。首次登录真正节省时间；非首次仅多一次无害的幂等 K8s Get。
- 不依赖 Phase 2 的 `instance_assignments` 表（该表 Phase 2 才有），Phase 1 即可独立工作。
- 失败不阻塞登录（goroutine 内 recover + zap warn）。
- 位置：`workpaw-admin/internal/handler/auth.go` Callback 末尾、签发 JWT 之前/之后均可（不阻塞响应）。

### 6.2 startup probe 替换 readiness 60s initial delay（最大单点收益）

`workpawinstance_controller.go:445-468` 探针策略改为：
```
StartupProbe:
  httpGet /api/agent/health:8088
  periodSeconds: 5
  failureThreshold: 24        # 覆盖最长 120s 慢启动；startup 期间不计入 not-ready
ReadinessProbe:               # 去掉 InitialDelay（startup 通过后才开始 readiness）
  httpGet /api/agent/health:8088
  periodSeconds: 15
  failureThreshold: 3
LivenessProbe:                # 保留，InitialDelay 调到 10s（startup 已保证启动完成）
  httpGet /api/agent/health:8088
  initialDelaySeconds: 10
  periodSeconds: 30
```
- 收益：容器一启动完成（通常 5-15s）即被探活通过，不再吃 60s 硬下限。
- 回退：探针参数走 operator ConfigMap 配置（见 §10），可热更新回退。
- `podTemplateEqual`（`:514-540`）需把新探针字段纳入 hash 比对，避免 reconcile 死循环。

### 6.3 operator 暴露细粒度 phase（驱动前端真实进度）

CR `QwenPawInstanceStatus` 新增 `phase` 字段（`workpaw-operator/api/v1alpha1/qwenpawinstance_types.go`），operator 在 `updateStatus`（`controller.go:659-723`）从 Pod status 推导：

| phase | 推导条件 |
|---|---|
| `pending` | CR 已创建，Pod 尚未创建 |
| `provisioning` | Secret/StatefulSet/Service/Ingress 创建中 |
| `scheduling` | Pod 存在但未分配 node（`pod.spec.nodeName==""`） |
| `image_pulling` | ContainerStatuses 中 `state.waiting.reason` ∈ {Pending, ContainerCreating} 或 Pulling 事件 |
| `container_starting` | 容器已创建但 startup probe 未通过 |
| `probe_pending` | startup 通过，readiness 未通过 |
| `config_syncing` | Pod Ready==True 且 annotation `workpaw.dev/config-state=syncing`（ConfigReconciler 打，见 §6.4） |
| `running` | Pod Ready==True |
| `error` | 镜像拉取失败 / 崩溃循环 / 超时 |

phase 与 `currentState`（Creating/Running/Stopped/Error）并存：`currentState` 保留向后兼容，`phase` 是细粒度补充。

### 6.4 配置同步改 event-driven（Pod ready→配置就位 60s→秒级）

`ConfigReconciler`（`config_reconciler.go`）当前仅 60s ticker。增加触发源：
- 新增 `instance_ready_signal`：operator 在 phase 进入 `probe_pending`/`running` 时给 CR 打 annotation（如 `workpaw.dev/ready-for-config`），ConfigReconciler 用 controller-runtime watch 这个 annotation 变化，立即收敛该实例的 `desired_configs`。
- 收敛逻辑不变（复用 `converge`/`convergeOne`，已有 `AppliedSpecHash`+`AppliedPodUID` 幂等保护）。
- config 阶段标记（**不双写 phase**）：ConfigReconciler 不直接写 CR `phase`（避免与 operator 并发写 status 撞 K8s optimistic concurrency）。改为推送开始时给 CR 打 annotation `workpaw.dev/config-state=syncing`，该实例所有 `desired_configs` 进入 `applied` 后改为 `synced`。operator 在 `updateStatus` 读此 annotation 输出 `config_syncing`/`running`（见 §6.3）——**phase 唯一 writer 始终是 operator**。
- 兜底：60s ticker 保留，作为 watch 漏事件的安全网。

### 6.5 镜像预拉取（运维侧，可选，依赖集群）
- 显式给容器设 `ImagePullPolicy: IfNotPresent`（`controller.go:401-470`，纳入 hash 比对）。
- 推荐在节点上用 DaemonSet 预拉 `agentscope/qwenpaw:v1.1.12`（运维侧操作，不进 operator 代码）。本期 spec 标记为「建议」，不阻塞。

---

## 7. Phase 2 — warm pool（`workpaw-operator` + `workpaw-admin`）

### 7.1 核心难点与方案

**难点**：K8s 资源 name 不可变，而当前实例 name = `qwenpaw-{email前缀}`、ingress path = `/{username}`。warm pool 预建「匿名」实例，领用时若改名/改 path = 删了重建 = 又冷启动，等于白做。

**方案 Z（已定）**：解耦实例 name 与用户身份。
- 实例 name = `qwenpaw-{instanceID}`，instanceID 由 control-plane 生成（uuid），不再绑 email。
- ingress path = `/i/{instanceID}`，rewrite-target `/$2`（operator `ensureIngress`，`controller.go:585-656`）。
- **用户身份由 token 体现，不依赖 path**。
- control-plane 维护 `user → instanceID` 映射（Postgres 新表）。
- warm 实例领用时**只改 label + 注入专属 token，不动 name/path/ingress** → 毫秒级、零 K8s 抖动。

### 7.2 数据模型

**CR 字段**（`api/v1alpha1/qwenpawinstance_types.go`）：
```
spec:
  pooled: bool                 # true = 池中待命
  assigned_user: string        # 领用后写入用户 ID；空 = 可领
  enterprise_id: string        # 按企业分池
  instance_id: string          # 稳定 ID（= name 后缀，control-plane 生成）
status:
  phase: string                # §6.3
```

**Postgres 新表**（control-plane）：
```sql
CREATE TABLE instance_assignments (
  user_id        TEXT NOT NULL,
  instance_id    TEXT NOT NULL,
  enterprise_id  TEXT NOT NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  state          TEXT NOT NULL,           -- assigned | released
  PRIMARY KEY (user_id, instance_id)
);
CREATE INDEX idx_assignments_enterprise_pool ON instance_assignments(enterprise_id, state);
```

### 7.3 状态机

**pool 实例**（operator 维护）：
```
absent → provisioning → warming(running+通用配置已推) → assigned → (转为用户实例)
```
**用户实例**（领用后）：
```
assigned → config_syncing(scope=user 补推) → running → [stopped(保PVC)] → running(唤醒)
```

### 7.4 流程

**预建**（operator 后台 replenisher，新 controller 逻辑或复用 reconcile）：
- 每企业维持 `[min, max]` 个 `pooled=true && assigned_user=""` 且 status.phase=`warming`/可用的实例。
- 预建目标：Pod Running + **scope=all 通用配置预推到位**（复用 §6.4 event-driven）。
- 低于 `min` → 异步补充；补充并发受限（每企业同时最多 `replenish_concurrency` 个 in-flight），避免雪崩。
- warm 实例 token：预生成 uuid 写入其 Secret，领用时**不换 token**（token 仅用于该实例内部鉴权，用户身份在 control-plane 层校验）。注：领用后若需按用户隔离 Pod 内权限，再在此点注入用户身份 claim —— 本期 scope 不要求，保留扩展点。

**领用**（control-plane `ActivateInstance` 改造，`instance.go:229-293`）：
```
GET /api/instance（前端触发）
  → 查 instance_assignments where user_id=?
    命中且 state=assigned → 读该 CR，若 stopped 则唤醒（DesiredState=Running），返回 connect
    未命中 → 进入领用流程：
      SELECT 一个该企业 pooled=true && assigned_user="" 的 CR（FOR UPDATE SKIP LOCKED，防并发抢同一个）
      命中 → UPDATE assigned_user=uid，写 instance_assignments(state=assigned)
            → 触发 §6.4 立即补推 scope=user 专属配置（异步，秒级）
            → 返回 connect（ingress /i/{instanceID} + token）
      未命中（pool 耗尽）→ 降级：新建普通 CR（走 §6 的冷启动路径），前端收到 pool_exhausted 信号
```

**降级**：pool 耗尽 → 复用 Phase 1B 冷启动路径；前端按 §5.3 `pool_exhausted` 文案展示。operator replenisher 负责尽快把 pool 补回 `min`。

**回收**（用户停用，`deactivate`）：
- 该用户实例 StatefulSet replicas→0，**保留 PVC**（下次唤醒复用，走快路径）。
- **不回池**（PVC 有该用户数据，避免数据残留/越权风险）。
- pool 实例独立维护，不与用户 PVC 混。

### 7.5 容量策略（可配置，见 §10）
- `warm_pool.min_per_enterprise` / `max_per_enterprise`：常驻下限/上限。
- `warm_pool.replenish_concurrency`：单企业并发补充上限。
- `warm_pool.enabled`：特性开关，关闭时回退到 Phase 1B 冷启动（灰度安全网）。

---

## 8. 接口契约

### 8.1 `GET /api/instance`（扩展返回）
```json
{
  "status": "not_found|creating|running|stopped",
  "phase": "starting|config_syncing|running|...",   // 新增，§6.3
  "assignment": "warm_hit|cold|pending|reusing",     // 新增，前端 stage 派生用
  "ingress_url": "...",                               // running 时填充
  "created_at": "...", "last_active_at": "..."
}
```
（`api_token` 仍单独走 `/api/instance/connect`，不变。）

### 8.2 `POST /api/instance/activate`（语义不变，内部走领用）
返回同上；pool 耗尽时 `assignment=cold`。

### 8.3 `GET /api/instance/events`（新增，SSE）
- 响应 `text/event-stream`，鉴权沿用 Bearer JWT。
- 事件：
  ```
  event: phase\ndata: {"phase":"image_pulling","assignment":"cold"}\n\n
  event: ready\ndata: {"ingress_url":"..."}\n\n
  event: error\ndata: {"code":"pool_exhausted","message":"..."}\n\n
  ```
- 后端实现：watch 该用户实例 CR 的 status 变化，转发为 SSE 事件；连接关闭即停止 watch。

---

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| activate 时账户 disabled | 沿用 `ErrAccountDisabled`（`instance.go:233-235`），前端 `disabled` 文案 |
| 领用并发竞争同一 pool 实例 | SQL `FOR UPDATE SKIP LOCKED`；抢不到则尝试下一个；全无则降级冷启动 |
| 预建补充失败（集群资源不足） | zap warn + 退避重试；pool 低于 min 触发告警（可接现有审计/通知） |
| 配置推送失败 | ConfigReconciler 已有指数退避（`config_reconciler.go:313-316`）；前端 `config_sync_failed` 文案 + 手动重试端点 |
| SSE 断连 | 前端自动降级 3s 轮询 |
| startup probe 反复失败 | operator phase=`error` + 写入 `currentState=Error`；前端 `unreachable` 文案 |
| 用户「先离开」后实例就绪 | 后台轮询命中 → tray 通知（复用现有通道） |

---

## 10. 配置项（operator ConfigMap + control-plane config.yaml）

**operator**（ConfigMap `workpaw-operator-config`，热更新）：
- `startup_probe.period_seconds=5`、`failure_threshold=24`
- `readiness_probe.period_seconds=15`、`failure_threshold=3`
- `warm_pool.enabled=false`（默认关，灰度）
- `warm_pool.min_per_enterprise=2`、`max_per_enterprise=20`
- `warm_pool.replenish_concurrency=2`

**control-plane**（`config.yaml`）：
- `config_sync.interval_seconds=60`（保留为兜底安全网）
- `config_sync.event_driven_enabled=true`（新增）
- `instance.first_login_precreate=true`（§6.1 错峰预建开关）

---

## 11. 迁移方案（name 解耦）

- **新实例**：Phase 2 起所有新建 CR 走 `qwenpaw-{instanceID}` + `/i/{instanceID}`。
- **存量实例**：**懒迁移**——旧 `qwenpaw-{email前缀}` 实例保持原 name/path 直到该用户下次停用（自然销毁 Pod 保 PVC）；用户下次唤醒时若 PVC 仍在，沿用旧实例；若已销毁，则按新约定领用 warm 实例。
- **ingress 共存**：旧 `/{username}` rewrite 与新 `/i/{instanceID}` rewrite 在 nginx 层共存，无冲突。
- 控制开关：`warm_pool.enabled=false` 时完全不触发新路径，存量行为零变化。

---

## 12. 测试策略

- **operator**：
  - 单元：phase 推导（各 Pod status → 正确 phase）；startup/readiness 探针模板生成；warm replenisher 容量维持逻辑（mock K8s）。
  - 集成（dev K8s，参考 `2026-06-26-k8s-qwenpaw-dev-testing-design.md`）：冷启动 phase 推进时序；pool 预建→领用→配置补推；pool 耗尽降级；停用保 PVC 唤醒。
- **control-plane**：
  - 单元：`ActivateInstance` 领用分支（warm hit / cold / 并发竞争 mock）；`instance_assignments` 表读写；错峰预建幂等。
  - 集成：SSE 端点事件推送；event-driven 配置同步触发。
- **desktop**：
  - 单元：`stage` 由 `phase`+`assignment` 映射；SSE 断连降级轮询；错误 `code` → 文案分支。
  - 修正 `Login.test.tsx` 为 mock OIDC 回调。
  - e2e（手动）：首次登录走 warm hit / 冷启动两条路径，验证 stage 推进与就绪。

---

## 13. 风险与回退

| 风险 | 缓解 |
|---|---|
| startup probe 参数误判导致实例反复重启 | 参数走 ConfigMap 可热回退；保留较大 `failure_threshold` |
| name 解耦迁移影响存量用户 | 懒迁移 + `warm_pool.enabled` 开关；关闭即零变化 |
| warm pool 常驻资源成本 | `min/max` 可配；按企业预算；非高峰可调低 min |
| SSE 长连接对 control-plane 并发压力 | 单连接 watch 单 CR，开销低；保留轮询兜底；必要时加连接数限制 |
| pool 实例与用户身份解耦后鉴权泄漏 | token 仍 per-instance；用户身份在 control-plane 层校验后才返回 connect 信息；§7.4 保留按用户 claim 注入的扩展点 |

---

## 14. 未决项 / 延后

- warm pool 实例是否需要「按岗位/场景预装不同基础配置」（当前仅 scope=all 通用预推，scope=user 领用后补推）——待 Phase 2 上线后据延迟数据评估。
- idle/scheduled policy 执行者（CRD 字段已存在但无执行器）——独立工作项，不在本设计范围。
- 镜像预拉取 DaemonSet 的运维落地——标记为建议，不阻塞本期。

---

## 15. 已确认的关键决策（review 纪要）

| # | 决策 | 选定 |
|---|---|---|
| ① | warm pool 预建到什么状态 | Pod Running + scope=all 通用配置预推 |
| ② | 实例 name 是否解耦身份 | 是，改用 instanceID + `/i/{id}`（方案 Z） |
| ③ | 领用绑定方式 | control-plane 映射表绑定 user→instance，不动 K8s name/path；token 为 per-instance（预建时生成，领用不换，靠「不回池」保证 token↔用户一一对应） |
| ④ | warm pool 实现形态 | 复用 QwenPawInstance + `spec.pooled` label，不新增 CRD |
| ⑤ | 用户停用后实例去留 | 销毁 Pod 保 PVC，不回池 |
| ⑥ | Phase 1B 错峰预建做不做 | 做，作为 warm pool 上线前的过渡价值 |

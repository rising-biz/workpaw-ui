# Warm Pool 全面优化 — 设计文档

- **状态**：Draft，待 review
- **日期**：2026-07-05
- **范围**：跨两仓 — `workpaw-control-plane` / `workpaw-operator`
- **关联 spec**：`2026-07-05-first-login-wait-ux-design.md` §7 / §9 / §10 / §11 / §13 / §15
- **替代**：`2026-07-05-warm-pool.md`（Plan 4 实施计划，已执行完成，本设计为其优化版本）

---

## 1. 现状诊断

Plan 4 实现后，warm pool 核心逻辑分布如下：

| 组件 | 文件 | 职责 |
|------|------|------|
| operator | `pool.go` | 每次 reconcile 顺路补一个 CR（`replenish`） |
| control-plane | `warm_pool_replenisher.go` | 30s ticker 批量补到 min、超过 max 删除 |
| control-plane | `assignment.go` | 领用流程：查已有分配 -> 池领用 -> 冷启动降级 |

经完整代码审查，诊断出 **12 个缺陷**，按严重程度排列：

### 1.1 架构层（致命）

| # | 缺陷 | 证据 | 后果 |
|---|------|------|------|
| **D1** | 两套 replenish 独立运行 | operator `pool.go:84-152` vs control-plane `warm_pool_replenisher.go:120-201` | 竞态创建超出 max；维护者分不清"谁在管" |
| **D2** | operator replenish 绑死在 CR reconcile 上 | 只在 `qwenpawinstance_controller.go:194-196` 末尾调用 | 无 CR 的企业 -> 永不触发 -> 池永不建 |
| **D3** | control-plane 绕过 operator 创建 CR | `warm_pool_replenisher.go:243-289` 自己拼 CR + `k8sClient.Create` | 两条创建路径，初始化不一致（D2+D3 = operator 路径缺 `workpaw.io/pooled` label） |

### 1.2 正确性层（严重）

| # | 缺陷 | 证据 | 后果 |
|---|------|------|------|
| **D4** | 领用竞态无重试上限 | `assignment.go:145-207` for-loop 无计数、无退避 | 高并发下可能把所有候选试一遍然后冷启动，丧失池的意义 |
| **D5** | 领用不优先挑 warming | `assignment.go:135-142` 排序 key 是 `poolStateRank`（只看 CurrentState=="Running"） | 用户可能领到 Pod Ready 但 scope=all 配置还没推的实例——拿到的瞬间不是真正可用 |
| **D6** | `ReplenishConcurrency` 定义了从未使用 | operator `pool.go:33` 字段存在，`poolConfig()` 解析了，`replenish()` 里完全没用到 | 死代码；也暴露了 operator replenish 从未考虑并发 |

### 1.3 运维/可靠性层

| # | 缺陷 | 证据 | 后果 |
|---|------|------|------|
| **D7** | 无池健康检查 | 不存在任何扫池实例 Pod 状态的逻辑 | CrashLoopBackOff/ImagePullBackOff/卡 provisioning 的实例一直占坑到被领用（然后用户看 error）或被 max 淘汰 |
| **D8** | 无池实例最大存活时间 | `createPooledInstance` 创建后无过期机制 | 池实例运行数天后 scope=all 配置已过时，领用后要多等一轮 ConfigReconciler |
| **D9** | O(n) 全量 List | operator `pool.go:92-107` List 所有 CR 再内存过滤，不用 label selector | 实例数增长后每次检查成本线性上升 |
| **D10** | 零可观测性 | 搜遍两仓：无 prometheus metric、无 pool stat API、无结构化 pool event log | 池水位、命中率、冷启动频率全部不可知，问题靠猜 |

### 1.4 设计层

| # | 缺陷 | 证据 | 后果 |
|---|------|------|------|
| **D11** | Config scope=all 推送无事件驱动 | ConfigReconciler 60s 定时器，新池 CR 要等最多 60s | Pod Ready 后最久 60s 才到达 phase=warming |
| **D12** | Spec 字段与 Label 分离，operator 侧路径不写 label | operator 创建 CR（`pool.go:128-140`）不设 `Labels`；control-plane 创建（`warm_pool_replenisher.go:248-260`）设了 | operator 创建的池 CR 对 control-plane label-based 查询不可见 |

---

## 2. 架构目标

1. **单一池维护者**：operator 全权负责池 CR 的创建、删除、健康检查。control-plane 不再创建/删除池 CR（唯一例外：seed CR，见 §3.4）。
2. **<5s 池补充延迟**（池 CR 被领用后 -> 新池 CR 创建）：Watch 池 CR delete 事件 + 15s 定时兜底。
3. **<Pod startup + 5s 到达 phase=warming**：事件驱动 scope=all 配置推送。
4. **领用优先 warming**：优先把真正 ready（Pod Ready + scope=all 配置已同步）的实例分配给用户；若无 warming，直接取 running（pooled），不等待。
5. **新企业自动建池**：通过 seed CR 机制，无需人工干预。
6. **Disabled 企业不维护池**：control-plane 维护 ConfigMap 中的 enabled enterprise 列表，PoolReconciler 只为此列表中的企业维持池。
7. **生产可观测**：Prometheus metrics 覆盖池水位、命中率、冷启动率、健康回收。

---

## 3. 方案：职责归位 + 事件驱动

### 3.1 组件职责重划分

```
Control Plane (保留并优化):
  assignment.go
    poolAssign: 优先 warming > running(pooled) > cold start
    3 轮乐观锁重试，全失败 -> 降级 coldStart
    零候选人 -> 立即 coldStart（不等待）
    写 Prometheus counter (warm_hit/cold/reusing)

  config_reconciler.go
    Watch ready-for-config annotation on pooled CRs
    -> 事件驱动 push scope=all configs（取代等 60s ticker）
    已有 event_driven_enabled 路径，加 pooled watch

  enterprise.go / EnterpriseService (新增 seed 逻辑)
    企业创建/启用时创建 1 个 seed CR
    企业启用/禁用时更新 ConfigMap warm_pool.enterprises

  ConfigMap 维护:
    control-plane 写 warm_pool.enterprises = ["ent-id-1","ent-id-2",...]
    企业 CRUD 时更新此列表

  DELETE: warm_pool_replenisher.go (整个文件)
  DELETE: config.go WarmPoolConfig.ReplenishConcurrency

Operator (新增/修改):
  pool_reconciler.go (替代旧 pool.go)
    PoolReconciler: 独立 Reconciler，由 Manager 管理
    触发源（三合一）:
      a) Watch ConfigMap (pool 配置 + enterprise 列表变更)
      b) Watch QwenPawInstance + label predicate (pooled=true 的 create/delete)
      c) RequeueAfter 15s (安全网，兜底事件丢失)
    核心逻辑:
      1. 从 ConfigMap warm_pool.enterprises 读取 enabled 企业列表
      2. 对每企业: label-selector 计数 pooled+unassigned
      3. < min -> 批量 Create 到 min
      4. > max -> 删除最老的 (CreationTimestamp 排序)
      5. 健康检查 (见 §3.5)
      6. 最大存活时间检查 (见 §3.5)
    Prometheus metrics (operator 暴露 :8080/metrics)

  phase.go (修改)
    derivePhase: Pod Ready + config-state=synced + pooled=true -> phase="warming"

  qwenpawinstance_controller.go (修改)
    DELETE: reconcileRunning() 末尾的 replenish() 调用

  pool.go (重写)
    精简为 PoolConfig + poolConfig() 读 ConfigMap (供 PoolReconciler 复用)
    DELETE: 旧 replenish() 函数
```

### 3.2 完整数据流

#### Phase 0: 企业创建

```
Admin 创建/启用企业
  |
  v
Control-Plane EnterpriseService
  |-- DB: INSERT enterprise (enabled=true)
  |-- ConfigMap: 更新 warm_pool.enterprises，加入新企业 ID
  |-- K8s: CREATE 1 seed CR (pooled=true, labels 完整)
  |
  v
Operator PoolReconciler 发现新企业 + seed CR
  |-- 池计数 = 1 (seed), min = 2
  |-- CREATE 1 个额外池 CR -> 池 = 2
```

#### Phase 1: 池实例预热

```
PoolReconciler -> Create QwenPawInstance CR (pooled=true)
  |
  v
QwenPawInstance Reconciler (正常 reconcile 流程)
  |-- ensureTokenSecret
  |-- ensureStatefulSet -> Pod 创建
  |-- ensureService
  |-- ensureIngress (path: /i/{instanceID})
  |
  v
Pod 经历: Pending -> Scheduling -> ImagePulling -> ContainerCreating -> Ready
  |
  v
updateStatus: derivePhase:
  pod==nil        -> "provisioning"
  pod unscheduled -> "scheduling"
  pulling         -> "image_pulling"
  pod Ready       -> "running"  <-- 此时还没推配置
  |
  v
Operator 写 annotation: workpaw.dev/ready-for-config=true
  |
  v  <-- Event-driven: ConfigReconciler watches this annotation
ConfigReconciler (control-plane):
  |-- 检测到 ready-for-config=true
  |-- 判定 pooled=true && assigned-user=""
  |-- 只推 scope=all bindings (scope=user 跳过)
  |-- 推完写 annotation: workpaw.dev/config-state=synced
  |
  v
QwenPawInstance Reconciler 下次 reconcile (<=15s):
  derivePhase: pod Ready + config-state=synced + pooled=true
  -> phase = "warming"  <-- 可领用
```

#### Phase 2: 用户领用

```
用户 SSO 登录 -> activate -> AssignInstance
  |
  v
poolAssign (control-plane):
  |-- List pooled CRs (label: pooled=true, enterprise=X)
  |-- 过滤: assigned-user=""
  |-- 排序: phase=warming (最优) > phase=running (次优, pooled)
  |-- 挑第一个 -> Get latest -> 检查 assigned-user 仍为空
  |-- Update: set assigned-user label + assigned-at annotation
  |   |
  |   |-- Update 成功:
  |   |   |-- INSERT instance_assignments (state=assigned)
  |   |   |-- 触发 ConfigReconciler push scope=user configs
  |   |   +-- 返回 status: assignment=warm_hit
  |   |
  |   |-- Update 冲突 (别人抢了):
  |   |   +-- 试下一个候选人，最多 3 轮
  |   |
  |   +-- 3 轮全失败 / 零候选人: -> 降级 coldStart (不等待)
  |
  v
Operator PoolReconciler 检测到 count < min -> 补 1 个新池 CR
```

#### Phase 3: 池健康维护

```
PoolReconciler 每次 reconcile 执行:
  |-- 健康检查:
  |   - phase=error 持续 >2min -> Delete + 补新
  |   - phase=provisioning 持续 >5min -> Delete + 补新
  |   - Pod Ready + config-state!=synced 持续 >3min -> Delete + 补新
  |
  +-- 最大存活时间:
      - CR.CreationTimestamp > max_age_minutes (默认 30min)
      - -> 先 Create 1 个新池 CR，再 Delete 旧 CR (维持水位)
```

### 3.3 企业发现机制

**问题：** Operator 无 DB 访问，无法知道哪些企业是 enabled 的。

**解决：** Control-plane 在 `workpaw-operator-config` ConfigMap 中维护 `warm_pool.enterprises` key，值为 JSON string array：

```yaml
warm_pool.enterprises: '["550e8400-e29b-41d4-a716-446655440000","550e8400-e29b-41d4-a716-446655440001"]'
```

**更新时机：**

| 事件 | ConfigMap 操作 |
|------|---------------|
| 企业创建 (enabled=true) | 加入列表 |
| 企业启用 (false->true) | 加入列表 |
| 企业禁用 (true->false) | 从列表中移除 |
| 企业删除 | 从列表中移除 |

**容错：** ConfigMap 读取失败或 key 不存在时，PoolReconciler 退化为从 CR label 自动发现企业（当前行为），保证不因 ConfigMap 问题导致池维护完全停止。

**废弃企业的池清理：** 企业从 `warm_pool.enterprises` 移除后，PoolReconciler 在下一次 reconcile 中检测到该企业有池 CR 但不在列表中，**主动删除该企业所有 pooled+unassigned 的 CR**（已被用户领用的不删，用户还在用）。

### 3.4 Seed CR 设计

**问题：** 新企业零 CR -> PoolReconciler 无法发现 -> 池永远不会建，直到第一个用户冷启动。

**解决：** Enterprise 创建/启用时，control-plane 创建恰好 1 个 seed CR。Seed 是普通池 CR，标签完整，能被用户正常领用。

#### Seed CR 创建

由 control-plane `EnterpriseService` 在 DB 事务提交后调用。失败时仅 log warning（不回滚 DB 事务），PoolReconciler 的企业列表中有该企业但无 CR -> 会自动补到 min。

```go
func (s *EnterpriseService) CreateSeedInstance(ctx context.Context, ent *model.Enterprise) {
    instanceID := strings.ReplaceAll(uuid.New().String(), "-", "")
    cr := &workpawv1alpha1.QwenPawInstance{
        ObjectMeta: metav1.ObjectMeta{
            Name:      "qwenpaw-" + instanceID,
            Namespace: ent.Namespace,
            Labels: map[string]string{
                "workpaw.io/pooled":      "true",
                "workpaw.io/enterprise":  ent.ID.String(),
                "workpaw.io/instance-id": instanceID,
            },
            Annotations: map[string]string{
                "workpaw.dev/created-at": time.Now().UTC().Format(time.RFC3339),
                "workpaw.dev/pooled":     "true",
                "workpaw.dev/seed":       "true",
            },
        },
        Spec: workpawv1alpha1.QwenPawInstanceSpec{
            Image:        s.cfg.Kubernetes.QwenPawImage,
            DesiredState: "Running",
            InstanceID:   instanceID,
            Pooled:       true,
            EnterpriseID: ent.ID,
        },
    }
    if err := s.k8sClient.Create(ctx, cr); err != nil {
        s.logger.Warn("failed to create seed pool instance",
            zap.String("enterprise", ent.Name), zap.Error(err),
        )
        return
    }
}
```

#### 关键约束

- Seed 不作特殊标记（除了 `workpaw.dev/seed` annotation 用于审计），label 与普通池 CR 完全一致
- PoolReconciler 把 seed 算入池计数——seed 是有效的池 CR
- 用户正常领用 seed 后，PoolReconciler 补到 min
- 企业禁用时：ConfigMap 中移除该企业 -> PoolReconciler 删除其所有 pool+unassigned CR（含 seed）

### 3.5 池健康检查

#### 健康判定与动作

| 检测项 | 判定条件 | 动作 |
|--------|----------|------|
| Pod 故障 | `phase == "error"` 持续超过 `error_grace_period`（默认 2min） | 删除 CR；PoolReconciler 下轮补到 min |
| 卡 provisioning | `phase == "provisioning"` 持续超过 `provisioning_timeout`（默认 5min） | 删除 CR；PoolReconciler 下轮补到 min |
| Config 同步失败 | Pod Ready + `config-state != "synced"` 持续超过 `config_sync_timeout`（默认 3min） | 删除 CR；PoolReconciler 下轮补到 min |
| 实例超龄 | `now - CR.CreationTimestamp > max_age_minutes`（默认 30min） | **先建后删**：先 Create 新池 CR，再 Delete 旧 CR，保持水位不降 |

#### 持续时间的判定

PoolReconciler 不自建状态存储。利用 CR 上已有的时间信息：

- **phase=error 持续时间**：检查 `Status.Phase` 为 "error" 的 CR。operator 的 `updateStatus` 在 phase 变化时写 Status。PoolReconciler 需要知道 phase 何时变为 error。使用 CR 的 annotation `workpaw.dev/phase-changed-at`（由 operator updateStatus 在 phase 变化时写入 ISO8601 时间戳）。若此 annotation 不存在（旧 CR），保守处理：立即回收。
- **卡 provisioning 持续时间**：直接用 `CR.CreationTimestamp`。若 CR 创建超过 5min 仍 phase=provisioning，说明 Pod 一直没建出来。
- **config sync 失败持续时间**：使用 `workpaw.dev/ready-for-config` annotation 的写入时间（由 operator updateStatus 写入）。若此时间距今超过 3min 且 config-state 仍不是 synced，回收。
- **超龄**：直接用 `CR.CreationTimestamp`。

#### Operator phase.go 改动

`updateStatus` 在 phase 发生变化时，写入/更新 annotation `workpaw.dev/phase-changed-at`：

```go
// In updateStatus, after deriving phase:
if instance.Status.Phase != phase {
    if instance.Annotations == nil {
        instance.Annotations = map[string]string{}
    }
    instance.Annotations["workpaw.dev/phase-changed-at"] = time.Now().UTC().Format(time.RFC3339)
}
```

相应的 `workpaw.dev/ready-for-config` annotation 也需要带时间戳，改为 `workpaw.dev/ready-for-config=2026-07-05T10:30:00Z` 格式。

### 3.6 ConfigMap Schema

```yaml
# workpaw-operator-config ConfigMap -- warm pool 部分
warm_pool.enabled: "true"
warm_pool.min_per_enterprise: "2"
warm_pool.max_per_enterprise: "20"
warm_pool.max_age_minutes: "30"
warm_pool.reconcile_interval_seconds: "15"
warm_pool.error_grace_period_seconds: "120"
warm_pool.provisioning_timeout_seconds: "300"
warm_pool.config_sync_timeout_seconds: "180"
warm_pool.enterprises: '["ent-uuid-1","ent-uuid-2"]'

# 删除的字段:
# warm_pool.replenish_concurrency
```

### 3.7 Prometheus Metrics

#### Operator 暴露（`:8080/metrics`）

```
# 池水位
workpaw_pool_size{enterprise="ent-1",phase="warming"} 2
workpaw_pool_size{enterprise="ent-1",phase="provisioning"} 1
workpaw_pool_size{enterprise="ent-1",phase="running"} 0

# 池回收
workpaw_pool_recycles_total{enterprise="ent-1",reason="error"} 3
workpaw_pool_recycles_total{enterprise="ent-1",reason="max_age"} 12
workpaw_pool_recycles_total{enterprise="ent-1",reason="provisioning_timeout"} 1
workpaw_pool_recycles_total{enterprise="ent-1",reason="config_sync_timeout"} 0

# 预热延迟 (CR 创建 -> phase=warming)
workpaw_pool_warming_duration_seconds_bucket{enterprise="ent-1",le="30"} 5
workpaw_pool_warming_duration_seconds_bucket{enterprise="ent-1",le="60"} 8

# Reconciler 耗时
workpaw_pool_reconcile_duration_seconds{quantile="0.5"} 0.05
workpaw_pool_reconcile_duration_seconds{quantile="0.99"} 0.30
```

#### Control-Plane 暴露

```
# 领用结果
workpaw_assignment_total{enterprise="ent-1",result="warm_hit"} 142
workpaw_assignment_total{enterprise="ent-1",result="cold"} 8
workpaw_assignment_total{enterprise="ent-1",result="reusing"} 56
```

---

## 4. 实施计划概览

### 4.1 两仓变更清单

#### workpaw-operator

| 动作 | 文件 | 内容 |
|------|------|------|
| 新增 | `internal/controller/pool_reconciler.go` | `PoolReconciler` + `Reconcile` + 健康检查 + 超龄回收 + 废弃企业清理 |
| 新增 | `internal/controller/pool_reconciler_test.go` | PoolReconciler 单元测试 |
| 重写 | `internal/controller/pool.go` | 精简为 `PoolConfig` + `poolConfig()` |
| 修改 | `internal/controller/phase.go` | `warming` 分支 + phase-changed-at annotation |
| 修改 | `internal/controller/qwenpawinstance_controller.go` | 删除 `replenish()` 调用；phase 变化时写 phase-changed-at |
| 修改 | `cmd/main.go` | 注册 `PoolReconciler` 到 Manager |
| 新增 | `internal/metrics/pool.go` | Prometheus metrics |
| 修改 | `config/manager/manager.yaml` | pool 相关 env |

#### workpaw-control-plane

| 动作 | 文件 | 内容 |
|------|------|------|
| 删除 | `internal/service/warm_pool_replenisher.go` | 整个文件 |
| 修改 | `internal/service/assignment.go` | 优先 warming + 3 轮重试 + 无候选人直接 coldStart |
| 修改 | `internal/service/config_reconciler.go` | watch ready-for-config on pooled CRs (事件驱动) |
| 修改 | `internal/config/config.go` | 删除 `ReplenishConcurrency` |
| 修改 | `internal/service/enterprise.go` | 新增 `CreateSeedInstance` + ConfigMap 企业列表维护 |
| 修改 | `internal/handler/enterprise.go` | 企业创建/启用/禁用时调用 seed + ConfigMap |
| 新增 | `internal/metrics/assignment.go` | Prometheus assignment metrics |
| 修改 | `internal/router/router.go` | 删除 WarmPoolReplenisher 注入和启动 |

### 4.2 迁移步骤

**Step 1: operator 新增 PoolReconciler（与旧 replenish 共存）**

- 新增 `pool_reconciler.go`、metrics、phase 改动
- 旧 `replenish()` 保留运行，但加上日志标记 `[deprecated] pool replenish triggered via legacy path`
- 验证 PoolReconciler 正确维护池后，下一 PR 删除 `replenish()`

**Step 2: control-plane 删除 WarmPoolReplenisher + 优化领用**

- 删除 `warm_pool_replenisher.go`
- 优化 `poolAssign`（warming 优先 + 3 轮重试）
- 新增 ConfigMap `warm_pool.enterprises` 维护
- 事件驱动 config push

**Step 3: seed CR + 企业生命周期集成**

- `EnterpriseService.CreateSeedInstance`
- 企业创建/启用/禁用时更新 ConfigMap
- 端到端验证：创建企业 -> seed CR 出现 -> 池自动补到 min -> 用户登录领用

### 4.3 回滚策略

- `warm_pool.enabled=false` -> PoolReconciler 停止所有操作
- 旧 `replenish()` 在 Step 1 删除前仍可用
- control-plane 侧删除 `WarmPoolReplenisher` 后若需回滚，重启用旧 commit 部署即可

---

## 5. 测试策略

### 5.1 Operator 单元测试

| 测试场景 | 验证点 |
|----------|--------|
| 池为空 -> Create 到 min | 创建 min 个 CR，带正确 label |
| 池超 max -> 删最老的 | 5 个池 CR，max=3 -> 删最老的 2 个 |
| 只维护 warm_pool.enterprises 中的企业 | 列表外企业的池 CR 被清理 |
| ConfigMap 无 enterprises key -> 退化为自动发现 | label 扫描发现企业，正常维护 |
| 健康: error >2min -> 回收 | phase=error + phase-changed-at >2min -> Delete |
| 健康: error <2min -> 保留 | phase=error + phase-changed-at <2min -> 不删 |
| 健康: provisioning >5min -> 回收 | CreationTimestamp >5min + phase=provisioning -> Delete |
| 健康: config sync timeout -> 回收 | ready-for-config >3min + config-state!=synced -> Delete |
| 超龄: 先建后删 | >30min CR -> Create 新 + Delete 旧，水位不变 |
| ConfigMap 热更新 | 改 min/max -> 下一 reconcile 生效 |
| 废弃企业清理 | 企业从列表移除 -> 其 pool+unassigned CR 被删；assigned 不受影响 |

### 5.2 Control-Plane 单元测试

| 测试场景 | 验证点 |
|----------|--------|
| poolAssign 优先 warming | warming + running -> 挑 warming |
| poolAssign 无 warming 取 running | 只有 running -> 直接取，不等待 |
| poolAssign 3 轮重试上限 | 全被抢 -> 3 轮后 -> 降级 coldStart |
| poolAssign 零候选人 -> coldStart | 空池 -> 直接返回 error -> coldStart |
| seed CR 创建成功 | EnterpriseService.Create -> seed 存在 + label 正确 |
| seed CR 创建失败不阻塞 | K8s Create error -> enterprise 仍创建成功 + log warn |
| ConfigMap 企业列表更新 | 企业创建 -> warm_pool.enterprises 含新 ID |
| ConfigMap 企业禁用移除 | 企业禁用 -> warm_pool.enterprises 不含该 ID |

### 5.3 集成烟雾

- 两仓 build + vet + test 全绿
- operator fake K8s 环境验证 PoolReconciler 完整流程
- control-plane fake K8s client 验证 AssignInstance -> poolAssign -> warm_hit

---

## 6. 延后项（显式列出，避免 scope creep）

- 池分层（hot/warm/cold tiers）
- 基于历史领用速率的需求预测
- 时间感知伸缩（9:00 扩容/22:00 缩容）
- 池实例预装常用 agent/mcp/skill 模板
- `GET /api/admin/pool/stats` 管理 API
- 旧 email-prefix 实例的清理迁移（Plan 4 已延后）
- Per-enterprise pool config override（当前只支持全局 min/max）

---

## 7. Spec 自审

- 无 TBD/TODO/占位符
- 所有 ConfigMap key、metric name、phase string、annotation key 均为确定值
- 与现有 spec（`2026-07-05-first-login-wait-ux-design.md`）一致
- 架构边界清晰：operator 写（池 CR 生命周期），control-plane 读+领用+企业列表
- Seed CR 失败路径已考虑：log warning + 不阻塞企业创建 + PoolReconciler 自动补到 min
- 企业发现有两层兜底：ConfigMap 列表（主路径）-> CR label 自动发现（降级路径）
- 健康状况判定依赖的时间戳 annotation（phase-changed-at、ready-for-config）有旧 CR 兼容策略
- 领用不等待：无 warming 直接取 running -> 无候选人直接 coldStart，不引入额外延迟

# Phase 1B 提速精选 Implementation Plan (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首次冷启动从 ~120s 压到 ~25-30s——startup probe 干掉 readiness 60s 硬下限、event-driven 配置同步把 60s 配置段压到秒级、登录回调异步预建实例——并保持 spec §6.4 的 writer 边界与最佳实践。

**Architecture:**
- **operator 侧**（事件源 + 探针）：startup probe 替换 readiness 60s initial-delay；探针参数走 `workpaw-operator-config` ConfigMap 热更新（复用现有 CORS Watches 模式）；新探针/`ImagePullPolicy` 纳入 `podTemplateEqual` hash；Pod ready 时写 `workpaw.dev/ready-for-config=true` annotation。
- **control-plane 侧**（消费 + 推送）：引入 controller-runtime Manager（与 Gin 同进程），承载新的 `ConfigSyncReconciler` watch `QwenPawInstance` CR，annotation 变化触发按用户收敛（复用幂等 `convergeOne`），写 `workpaw.dev/config-state` annotation；60s ticker 保留为 safety-net。登录回调（auth Callback）异步 `ActivateInstance` 预建。
- **writer 边界**（spec §6.4，必须严守）：operator 写 `ready-for-config`；control-plane 写 `config-state`；operator 读 `config-state`（Plan 1 已在 `derivePhase` 接好）；control-plane 读 `ready-for-config`。两端的 annotation 写入都用 `client.MergeFrom` patch，避免互相覆盖。
- **复用摊销**：control-plane Manager 是 Plan 4 warm pool 的前置基础设施（warm pool 必须实时观察 pool CR 并 reconcile 领用），Plan 3 一次付清。

**Tech Stack:** Go, controller-runtime (manager + client + fake), Gin, GORM, Viper, Zap, QwenPawInstance CRD (workpawv1alpha1)。

**Spec:** `docs/superpowers/specs/2026-07-05-first-login-wait-ux-design.md` §6.1 / §6.2 / §6.4 / §6.5 / §9 / §10 / §13。

## Global Constraints

复制自 spec，所有任务隐含遵守：

- **不新增 CRD**：本期不引入任何新 CRD。所有新增（annotations、未来的 warm pool 字段）都挂在现有 `QwenPawInstance` 上（spec §15 ④）。control-plane 新 Manager 只是 watch 现有 CRD + 用原生 K8s `Lease` 做 leader election。
- **不改 Pod 内 QwenPaw 应用**（v1.1.12 锁定）的启动逻辑（spec §3.2）。
- **operator 始终是 `phase` 唯一 writer**；`config-state` annotation 由 control-plane 写；`ready-for-config` 由 operator 写（spec §6.4 / §9）。
- 探针参数走 operator ConfigMap `workpaw-operator-config`（与 CORS 同对象），热更新；缺失/解析失败 → 永不阻塞 reconcile，回退 spec §6.2 默认值（spec §10 / §13）。
- `podTemplateEqual` 必须把新增的探针字段与 `ImagePullPolicy` 纳入比对，避免 reconcile 死循环（spec §6.2）。
- 控制面新 Manager 的 watch 是**叠加项**，不替换 60s ticker（ticker 作为 watch 漏事件的 safety-net，spec §6.4）。
- 特性开关：`config_sync.event_driven_enabled`（默认 true）控制 Manager 启动；`instance.first_login_precreate`（默认 true）控制错峰预建；关闭即退回纯 ticker / 不预建（灰度安全网，spec §10 / §13）。
- **TDD**：每个任务先写失败测试再实现；frequent commits；DRY、YAGNI。
- **跨仓依赖**：control-plane `go.mod` 已有 operator 本地 replace（指向本地 operator 检出）。Plan 1（operator phase 字段）已 merge 到两个仓的 main，本地检出已含，control-plane 可直接编译。
- Go 测试中**新增的单测不得依赖 envtest**（本机缺 `/usr/local/kubebuilder/bin/etcd`）。需要 envtest 的内容放进 `_integration_test.go` 并以 `KUBEBUILDER_ASSETS` 未设时 skip。

## File Structure

**workpaw-operator**
- Modify `internal/controller/qwenpawinstance_controller.go` — `Config` struct、`DefaultConfig`、`desiredStatefulSet`（探针 + ImagePullPolicy）、`podTemplateEqual`、`updateStatus` / `setStoppedStatus`（annotation 写入）。
- Create `internal/controller/probes.go` — `ProbeConfig` 类型 + `DefaultProbeConfig()` + `(r *QwenPawInstanceReconciler) probeConfig(ctx)` ConfigMap 读取器。
- Create `internal/controller/probes_test.go` — 探针配置读取单测。
- Modify/Create `internal/controller/controller_test.go`（或新增 `template_test.go`）— `desiredStatefulSet` 探针/ImagePullPolicy + `podTemplateEqual` 漂移单测（fake client，无 envtest）。
- Create `internal/controller/annotation_test.go` — `ready-for-config` annotation 写入单测（fake client）。

**workpaw-admin**
- Modify `internal/config/config.go` — `InstanceConfig`（新）+ `ConfigSyncConfig` 扩展 + defaults。
- Modify `internal/service/instance.go` — 存 `restCfg` + `RESTConfig()` accessor。
- Modify `internal/service/config_reconciler.go` — `ConvergeUser(ctx, userID)` + `UserConfigState(ctx, userID)`。
- Create `internal/service/config_sync_controller.go` — `ConfigSyncReconciler`（controller-runtime Reconciler）+ `StartConfigSyncController(...)`（Manager 构造与启动）。
- Create `internal/service/config_sync_controller_test.go` — fake client 单测。
- Modify `internal/handler/auth.go` — `InstancePrecreator` 接口字段 + setter + Callback 异步预建。
- Modify `internal/router/router.go` — 注入 precreator、启动 Manager。
- Modify `cmd/serve.go` — signal-aware ctx + 优雅关停（Gin + Manager 共享生命周期）。

---

## Task 1: operator — ProbeConfig 类型 + ConfigMap 读取器

**Files:**
- Create: `workpaw-operator/internal/controller/probes.go`
- Create: `workpaw-operator/internal/controller/probes_test.go`
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`（`Config` struct `:47-75` + `DefaultConfig` `:80-104`）

**Interfaces:**
- Produces: `ProbeConfig` struct；`DefaultProbeConfig() ProbeConfig`；`(r *QwenPawInstanceReconciler) probeConfig(ctx context.Context) ProbeConfig`。Task 2 消费 `probeConfig(ctx)` 的返回值生成探针。

**背景：** 复用 CORS 的 ConfigMap-watch 模式（`corsOrigins()` `:244`，`SetupWithManager` `:759` 已 watch `workpaw-operator-config`），探针变化会触发 reconcile → `podTemplateEqual`（Task 3）检测漂移 → rolling update。

- [ ] **Step 1: 写失败测试** — `probes_test.go`

```go
package controller

import (
	"context"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestDefaultProbeConfig(t *testing.T) {
	got := DefaultProbeConfig()
	if got.StartupPeriodSeconds != 5 || got.StartupFailureThreshold != 24 {
		t.Fatalf("startup defaults = %+v, want {5,24}", got)
	}
	if got.ReadinessPeriodSeconds != 15 || got.ReadinessFailureThreshold != 3 {
		t.Fatalf("readiness defaults = %+v, want {15,3}", got)
	}
}

func newProbeReconciler(t *testing.T, objects ...runtime.Object) *QwenPawInstanceReconciler {
	t.Helper()
	s := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(s)
	_ = corev1.AddToScheme(s)
	cl := fake.NewClientBuilder().WithScheme(s).WithRuntimeObjects(objects...).Build()
	return &QwenPawInstanceReconciler{Client: cl, Scheme: s, Config: DefaultConfig()}
}

func TestProbeConfigFallbackWhenConfigMapMissing(t *testing.T) {
	r := newProbeReconciler(t)
	got := r.probeConfig(context.Background())
	if got != DefaultProbeConfig() {
		t.Fatalf("missing ConfigMap should fall back to defaults; got %+v", got)
	}
}

func TestProbeConfigOverrideFromConfigMap(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "workpaw-operator-config", Namespace: "workpaw-instances",
		},
		Data: map[string]string{
			"startup_probe_period_seconds":      "7",
			"startup_probe_failure_threshold":   "30",
			"readiness_probe_period_seconds":    "10",
			"readiness_probe_failure_threshold": "5",
		},
	}
	r := newProbeReconciler(t, cm)
	got := r.probeConfig(context.Background())
	if got.StartupPeriodSeconds != 7 || got.StartupFailureThreshold != 30 ||
		got.ReadinessPeriodSeconds != 10 || got.ReadinessFailureThreshold != 5 {
		t.Fatalf("ConfigMap override not applied; got %+v", got)
	}
}

func TestProbeConfigIgnoresBadInts(t *testing.T) {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name: "workpaw-operator-config", Namespace: "workpaw-instances",
		},
		Data: map[string]string{"startup_probe_period_seconds": "not-an-int"},
	}
	r := newProbeReconciler(t, cm)
	got := r.probeConfig(context.Background())
	// Bad value → fall back to default for that field only.
	if got.StartupPeriodSeconds != 5 {
		t.Fatalf("bad int should fall back to default 5; got %d", got.StartupPeriodSeconds)
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/zhangsan/workpaw/workpaw-operator
go test ./internal/controller/ -run 'TestDefaultProbeConfig|TestProbeConfig' -v
```
Expected: FAIL（`DefaultProbeConfig` undefined / `probeConfig` 方法不存在）。

- [ ] **Step 3: 实现** — 创建 `probes.go`

```go
package controller

import (
	"context"
	"strconv"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"
)

// ProbeConfig holds K8s probe tuning for the QwenPaw container. Values are
// hot-reloadable via the workpaw-operator-config ConfigMap (the same object
// the CORS watch uses), so probe params can change without an operator
// restart; a ConfigMap change triggers reconcile → podTemplateEqual drift
// detection → rolling update. Liveness params are intentionally fixed
// (startup probe guarantees the app is up before liveness starts).
type ProbeConfig struct {
	StartupPeriodSeconds      int32
	StartupFailureThreshold   int32
	ReadinessPeriodSeconds    int32
	ReadinessFailureThreshold int32
}

// DefaultProbeConfig returns the spec §6.2 defaults. Startup failureThreshold=24
// at period 5s covers a 120s slow start without counting against readiness.
func DefaultProbeConfig() ProbeConfig {
	return ProbeConfig{
		StartupPeriodSeconds:      5,
		StartupFailureThreshold:   24,
		ReadinessPeriodSeconds:    15,
		ReadinessFailureThreshold: 3,
	}
}

// probeConfig resolves the probe tuning for this reconcile. It reads the watched
// ConfigMap (same name/namespace as CORS: CORSConfigMapName / CORSConfigMapNamespace)
// and overrides per-field defaults from keys startup_probe_* / readiness_probe_*.
// Any miss / parse error falls back to r.Config.Probes for that field — never errors,
// so a missing or malformed ConfigMap never blocks reconcile (spec §13).
func (r *QwenPawInstanceReconciler) probeConfig(ctx context.Context) ProbeConfig {
	out := r.Config.Probes
	if r.Config.CORSConfigMapName == "" || r.Config.CORSConfigMapNamespace == "" {
		return out
	}
	cm := &corev1.ConfigMap{}
	if err := r.Get(ctx, types.NamespacedName{
		Name: r.Config.CORSConfigMapName, Namespace: r.Config.CORSConfigMapNamespace,
	}, cm); err != nil {
		return out
	}
	apply := func(key string, dst *int32) {
		if v, ok := cm.Data[key]; ok {
			if n, err := strconv.ParseInt(v, 10, 32); err == nil && n > 0 {
				*dst = int32(n)
			}
		}
	}
	apply("startup_probe_period_seconds", &out.StartupPeriodSeconds)
	apply("startup_probe_failure_threshold", &out.StartupFailureThreshold)
	apply("readiness_probe_period_seconds", &out.ReadinessPeriodSeconds)
	apply("readiness_probe_failure_threshold", &out.ReadinessFailureThreshold)
	return out
}

// livenessInitialDelaySeconds is fixed; startup probe makes a readiness-style
// initial delay unnecessary. Spec §6.2.
const livenessInitialDelaySeconds int32 = 10

// livenessPeriodSeconds is fixed per spec §6.2.
const livenessPeriodSeconds int32 = 30

// probeTimeoutSeconds is the per-probe HTTP timeout (consistent across probes).
const probeTimeoutSeconds int32 = 5

// ensure time imported for callers; referenced by annotation requeue in later tasks.
var _ = time.Second
```

- [ ] **Step 4: 改 `Config` struct + `DefaultConfig`** — 在 `qwenpawinstance_controller.go`

在 `Config` struct（`:47-75`）`CORSConfigMapKey` 字段后追加：
```go
	// Probes holds K8s probe tuning (hot-reloadable via the watched ConfigMap,
	// see probeConfig). Defaults come from DefaultProbeConfig().
	Probes ProbeConfig
```

在 `DefaultConfig()`（`:80-104`）的 `cfg := &Config{...}` 字面量里追加：
```go
		Probes: DefaultProbeConfig(),
```

- [ ] **Step 5: 跑测试确认通过**

```bash
go test ./internal/controller/ -run 'TestDefaultProbeConfig|TestProbeConfig' -v
```
Expected: PASS（4 个测试全过）。

- [ ] **Step 6: 全量 build**

```bash
go build ./...
```
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add internal/controller/probes.go internal/controller/probes_test.go internal/controller/qwenpawinstance_controller.go
git commit -m "feat(operator): ProbeConfig type + ConfigMap-driven probe tuning (§6.2)"
```

---

## Task 2: operator — StartupProbe + Readiness/Liveness 重塑 + ImagePullPolicy

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`（`desiredStatefulSet` 容器块 `:401-469`）
- Create/Modify: `workpaw-operator/internal/controller/template_test.go`

**Interfaces:**
- Consumes: Task 1 的 `probeConfig(ctx)`。
- Produces: `desiredStatefulSet` 产出的容器含 `StartupProbe`、重塑的 `ReadinessProbe`/`LivenessProbe`、`ImagePullPolicy: IfNotPresent`。

- [ ] **Step 1: 写失败测试** — `template_test.go`

```go
package controller

import (
	"context"
	"testing"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func newInstanceForTemplate() *workpawv1alpha1.QwenPawInstance {
	return &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Spec:       workpawv1alpha1.QwenPawInstanceSpec{Image: "agentscope/qwenpaw:v1.1.12", DesiredState: "Running"},
	}
}

func TestDesiredStatefulSetHasStartupProbeAndNoReadinessInitialDelay(t *testing.T) {
	r := newProbeReconciler(t) // Task 1 helper; uses DefaultProbeConfig
	sts, err := r.desiredStatefulSet(newInstanceForTemplate(), "alice", "")
	if err != nil {
		t.Fatalf("desiredStatefulSet: %v", err)
	}
	c := sts.Spec.Template.Spec.Containers[0]
	if c.StartupProbe == nil {
		t.Fatal("missing StartupProbe")
	}
	if c.StartupProbe.PeriodSeconds != 5 || c.StartupProbe.FailureThreshold != 24 {
		t.Errorf("startup probe = %+v, want period 5 / failure 24", c.StartupProbe)
	}
	if c.ReadinessProbe == nil || c.ReadinessProbe.InitialDelaySeconds != 0 {
		t.Errorf("readiness must have no initial delay; got %+v", c.ReadinessProbe)
	}
	if c.ReadinessProbe.PeriodSeconds != 15 || c.ReadinessProbe.FailureThreshold != 3 {
		t.Errorf("readiness = %+v, want period 15 / failure 3", c.ReadinessProbe)
	}
	if c.LivenessProbe == nil || c.LivenessProbe.InitialDelaySeconds != 10 {
		t.Errorf("liveness initial delay = %d, want 10", c.LivenessProbe.InitialDelaySeconds)
	}
}

func TestDesiredStatefulSetSetsImagePullPolicyIfNotPresent(t *testing.T) {
	r := newProbeReconciler(t)
	sts, err := r.desiredStatefulSet(newInstanceForTemplate(), "alice", "")
	if err != nil {
		t.Fatalf("desiredStatefulSet: %v", err)
	}
	c := sts.Spec.Template.Spec.Containers[0]
	if c.ImagePullPolicy != "IfNotPresent" {
		t.Errorf("ImagePullPolicy = %q, want IfNotPresent", c.ImagePullPolicy)
	}
}

// silence unused import in stub phase
var _ = context.Background
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/controller/ -run 'TestDesiredStatefulSet' -v
```
Expected: FAIL（`StartupProbe` 为 nil；`ImagePullPolicy` 为空）。

- [ ] **Step 3: 实现** — 替换 `desiredStatefulSet` 中的容器定义块（`:401-469` 之间的 `Containers: []corev1.Container{{ ... }}`）。

把现有 `ReadinessProbe`（`:445-456`）+ `LivenessProbe`（`:457-468`）整段替换为下面（并加 `ImagePullPolicy`）。先在 `desiredStatefulSet` 入口解析探针配置——把方法签名后的第一行（`labels := labelsForInstance(username)` 之前）加：

```go
	probes := r.probeConfig(ctx)
```

注意：`desiredStatefulSet` 当前签名不含 `ctx`（`func (r *QwenPawInstanceReconciler) desiredStatefulSet(instance *..., username, corsOrigins string) (*appsv1.StatefulSet, error)`）。**需要把 `ctx context.Context` 加为第一个参数**，并更新两个调用点（`:320` 和 `:345`，都是 `r.desiredStatefulSet(instance, username, r.corsOrigins(ctx))`）改为 `r.desiredStatefulSet(ctx, instance, username, r.corsOrigins(ctx))`。

容器定义（替换从 `ReadinessProbe:` 到 `LivenessProbe` 块结束，`:445-468`）：

```go
								ImagePullPolicy: corev1.PullIfNotPresent,
								ReadinessProbe: &corev1.Probe{
									ProbeHandler: corev1.ProbeHandler{
										HTTPGet: &corev1.HTTPGetAction{
											Path: "/api/agent/health",
											Port: intstr.FromInt(8088),
										},
									},
									// No InitialDelay: the StartupProbe gates readiness until the
									// app is up, so the old 60s hard floor (spec §2.1) is gone.
									PeriodSeconds:    probes.ReadinessPeriodSeconds,
									TimeoutSeconds:   probeTimeoutSeconds,
									FailureThreshold: probes.ReadinessFailureThreshold,
								},
								LivenessProbe: &corev1.Probe{
									ProbeHandler: corev1.ProbeHandler{
										HTTPGet: &corev1.HTTPGetAction{
											Path: "/api/agent/health",
											Port: intstr.FromInt(8088),
										},
									},
									InitialDelaySeconds: livenessInitialDelaySeconds,
									PeriodSeconds:       livenessPeriodSeconds,
									TimeoutSeconds:      10,
									FailureThreshold:    5,
								},
								StartupProbe: &corev1.Probe{
									ProbeHandler: corev1.ProbeHandler{
										HTTPGet: &corev1.HTTPGetAction{
											Path: "/api/agent/health",
											Port: intstr.FromInt(8088),
										},
									},
									PeriodSeconds:    probes.StartupPeriodSeconds,
									TimeoutSeconds:   probeTimeoutSeconds,
									FailureThreshold: probes.StartupFailureThreshold,
								},
```

> 顺序：`ImagePullPolicy` 紧跟 `Image:`/`Name:` 块之后（K8s 字段顺序无强约束，但保持可读）。删掉旧 `ReadinessProbe` 的 `InitialDelaySeconds: 60` 与旧 `LivenessProbe` 的 `InitialDelaySeconds: 120`。

- [ ] **Step 4: 跑测试确认通过**

```bash
go test ./internal/controller/ -run 'TestDesiredStatefulSet' -v
go build ./...
```
Expected: PASS + build OK。

- [ ] **Step 5: Commit**

```bash
git add internal/controller/qwenpawinstance_controller.go internal/controller/template_test.go
git commit -m "feat(operator): startup probe replaces readiness 60s initial-delay + ImagePullPolicy (§6.2/§6.5)"
```

---

## Task 3: operator — podTemplateEqual 纳入探针 + ImagePullPolicy

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`（`podTemplateEqual` `:523-540`）
- Modify: `workpaw-operator/internal/controller/template_test.go`

**背景：** 现有 `podTemplateEqual` 只比 Image/Resources/Env，**故意忽略** `imagePullPolicy` 等默认填充字段以避免循环（见注释 `:517-522`）。现在我们**显式**设置 `ImagePullPolicy` 与探针，必须把它们纳入比对，否则探针配置变化不会触发 rolling update（spec §6.2「`podTemplateEqual` 需把新探针字段纳入 hash 比对」）。

**Interfaces:** 无新公开符号；修正既有比较器。

- [ ] **Step 1: 写失败测试** — 追加到 `template_test.go`

```go
func TestPodTemplateEqualDetectsProbeAndImagePullPolicyDrift(t *testing.T) {
	r := newProbeReconciler(t)
	desired, err := r.desiredStatefulSet(context.Background(), newInstanceForTemplate(), "alice", "")
	if err != nil {
		t.Fatalf("desiredStatefulSet: %v", err)
	}
	// Identical → equal.
	if !podTemplateEqual(&desired.Spec.Template, &desired.Spec.Template) {
		t.Fatal("identical templates should be equal")
	}
	// Drift ImagePullPolicy → not equal.
	drifted := desired.DeepCopy()
	drifted.Spec.Template.Spec.Containers[0].ImagePullPolicy = "Always"
	if podTemplateEqual(&desired.Spec.Template, &drifted.Spec.Template) {
		t.Error("ImagePullPolicy drift not detected")
	}
	// Drift startup probe period → not equal.
	drifted2 := desired.DeepCopy()
	drifted2.Spec.Template.Spec.Containers[0].StartupProbe.PeriodSeconds = 99
	if podTemplateEqual(&desired.Spec.Template, &drifted2.Spec.Template) {
		t.Error("startup probe drift not detected")
	}
	// Defaulted live object (nil probes, defaulted imagePullPolicy) is NOT
	// falsely equal to our desired template that sets them explicitly — this
	// is the whole point: we want drift detection on the first reconcile so
	// existing StatefulSets get patched.
	defaulted := desired.DeepCopy()
	defaulted.Spec.Template.Spec.Containers[0].StartupProbe = nil
	if podTemplateEqual(&desired.Spec.Template, &defaulted.Spec.Template) {
		t.Error("nil startup probe should be detected as drift")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/controller/ -run 'TestPodTemplateEqualDetectsProbeAndImagePullPolicyDrift' -v
```
Expected: FAIL（当前 `podTemplateEqual` 不看探针/ImagePullPolicy）。

- [ ] **Step 3: 实现** — 替换 `podTemplateEqual` 函数体（`:523-540`）

```go
// podTemplateEqual reports whether the pod templates match on the fields this
// operator reconciles: image, resources, env, imagePullPolicy, and the three
// probes. Because we now SET imagePullPolicy and all probes explicitly on the
// desired template (rather than relying on K8s defaults), comparing them is
// correct and is what lets infra/probe config changes trigger a drift-patch
// rolling update. K8s-defaulted fields we do NOT set (terminationMessagePath,
// etc.) are still ignored.
func podTemplateEqual(a, b *corev1.PodTemplateSpec) bool {
	if len(a.Spec.Containers) != len(b.Spec.Containers) {
		return false
	}
	for i := range a.Spec.Containers {
		ca, cb := a.Spec.Containers[i], b.Spec.Containers[i]
		if ca.Image != cb.Image {
			return false
		}
		if ca.ImagePullPolicy != cb.ImagePullPolicy {
			return false
		}
		if !equality.Semantic.DeepEqual(ca.Resources, cb.Resources) {
			return false
		}
		if !equality.Semantic.DeepEqual(ca.Env, cb.Env) {
			return false
		}
		if !equality.Semantic.DeepEqual(ca.StartupProbe, cb.StartupProbe) {
			return false
		}
		if !equality.Semantic.DeepEqual(ca.ReadinessProbe, cb.ReadinessProbe) {
			return false
		}
		if !equality.Semantic.DeepEqual(ca.LivenessProbe, cb.LivenessProbe) {
			return false
		}
	}
	return true
}
```

- [ ] **Step 4: 跑测试确认通过 + build**

```bash
go test ./internal/controller/ -run 'TestPodTemplateEqual|TestDesiredStatefulSet' -v
go build ./...
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add internal/controller/qwenpawinstance_controller.go internal/controller/template_test.go
git commit -m "feat(operator): podTemplateEqual compares probes + imagePullPolicy for drift detection (§6.2)"
```

---

## Task 4: operator — ready-for-config annotation 写入

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`（`updateStatus` `:659-728`、`setStoppedStatus` `:731-753`）
- Create: `workpaw-operator/internal/controller/annotation_test.go`

**背景：** spec §6.4 要求 operator 在实例就绪（Pod ready）时给 CR 打 `workpaw.dev/ready-for-config=true`，作为 control-plane event-driven 配置同步的触发信号。annotation 写入必须用 `client.MergeFrom` patch（不能 `r.Update` 整个 metadata，否则会覆盖 control-plane 写的 `config-state` annotation——spec §6.4 writer 边界）。`setStoppedStatus` 清掉该 annotation（stopped 实例不应触发配置推送）。

**Interfaces:**
- Produces：CR metadata annotation `workpaw.dev/ready-for-config` ∈ {"true",""}；symbol `annReadyForConfig = "workpaw.dev/ready-for-config"`（const，供测试断言）。

- [ ] **Step 1: 写失败测试** — `annotation_test.go`

```go
package controller

import (
	"context"
	"testing"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const annReadyForConfig = "workpaw.dev/ready-for-config"

func newAnnotationReconciler(t *testing.T, objs ...runtime.Object) (*QwenPawInstanceReconciler, *fake.ClientBuilder) {
	t.Helper()
	s := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(s)
	_ = corev1.AddToScheme(s)
	_ = workpawv1alpha1.AddToScheme(s)
	b := fake.NewClientBuilder().WithScheme(s).WithRuntimeObjects(objs...)
	return &QwenPawInstanceReconciler{Client: b.Build(), Scheme: s, Config: DefaultConfig()}, b
}

// readyPodFor creates a StatefulSet + a Ready pod so updateStatus reaches the
// ready branch.
func readyPodFor(name string) (*corev1.StatefulSet, *corev1.Pod) {
	ssName := "qwenpaw-" + name
	podName := ssName + "-0"
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: podName, Namespace: "workpaw-instances"},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{
			{Type: corev1.PodReady, Status: corev1.ConditionTrue},
		}},
	}
	ss := &corev1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: ssName, Namespace: "workpaw-instances"}}
	return ss, pod
}

func TestUpdateStatusSetsReadyForConfigWhenPodReady(t *testing.T) {
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Spec:       workpawv1alpha1.QwenPawInstanceSpec{DesiredState: "Running"},
	}
	ss, pod := readyPodFor("alice")
	r, _ := newAnnotationReconciler(t, inst, ss, pod)
	if _, err := r.updateStatus(context.Background(), inst, "alice"); err != nil {
		t.Fatalf("updateStatus: %v", err)
	}
	got := &workpawv1alpha1.QwenPawInstance{}
	_ = r.Get(context.Background(), types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}, got)
	if got.Annotations[annReadyForConfig] != "true" {
		t.Fatalf("annotation = %q, want \"true\"", got.Annotations[annReadyForConfig])
	}
}

func TestSetStoppedStatusClearsReadyForConfig(t *testing.T) {
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name: "alice", Namespace: "workpaw-instances",
			Annotations: map[string]string{annReadyForConfig: "true", "workpaw.dev/config-state": "synced"},
		},
		Status: workpawv1alpha1.QwenPawInstanceStatus{CurrentState: "Running"},
	}
	r, _ := newAnnotationReconciler(t, inst)
	if _, err := r.setStoppedStatus(context.Background(), inst); err != nil {
		t.Fatalf("setStoppedStatus: %v", err)
	}
	got := &workpawv1alpha1.QwenPawInstance{}
	_ = r.Get(context.Background(), types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}, got)
	if _, ok := got.Annotations[annReadyForConfig]; ok {
		t.Fatal("ready-for-config should be cleared on stop")
	}
	// config-state must NOT be clobbered by the operator (writer boundary).
	if got.Annotations["workpaw.dev/config-state"] != "synced" {
		t.Fatal("operator must not touch control-plane's config-state annotation")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/controller/ -run 'TestUpdateStatusSetsReadyForConfig|TestSetStoppedStatusClearsReadyForConfig' -v
```
Expected: FAIL（annotation 未写入）。

- [ ] **Step 3: 实现** — 在 `updateStatus` 写 status 之后、return 之前加 annotation patch。

在 `qwenpawinstance_controller.go` 顶部 const 区（或 `probes.go` 末尾）加：
```go
const annReadyForConfig = "workpaw.dev/ready-for-config"
```

在 `updateStatus`（`:659-728`）中，找到写 status 的位置（`:711-720` `instance.Status.* = ...; r.Status().Update(...)`）。在 `r.Status().Update(ctx, instance)` 成功**之后**、函数末尾的 `if currentState == "Creating"` 判断**之前**，插入 annotation 同步逻辑：

```go
	// Signal the control-plane ConfigSyncReconciler that this pod is ready to
	// receive its user-scope config (spec §6.4). Patch only this annotation via
	// MergeFrom so we never clobber control-plane's config-state annotation.
	wantReady := "true"
	if currentState != "Running" {
		wantReady = "" // not ready → clear the signal
	}
	if inst.Annotations[annReadyForConfig] != wantReady {
		base := instance.DeepCopy()
		if instance.Annotations == nil {
			instance.Annotations = map[string]string{}
		}
		if wantReady == "" {
			delete(instance.Annotations, annReadyForConfig)
		} else {
			instance.Annotations[annReadyForConfig] = wantReady
		}
		if err := r.Patch(ctx, instance, client.MergeFrom(base)); err != nil {
			log.Error(err, "Failed to patch ready-for-config annotation")
			// Non-fatal: the ticker safety-net still drives config sync.
		}
	}
```

注意：`instance` 在 `updateStatus` 里已被 `Status().Update` 写过 status；其 `ObjectMeta` 仍是我们 Get 时的版本，Patch metadata 安全（status 是独立 subresource，`Patch` 默认不动 status）。若 `currentState == "Creating"` 且未变，上面 `wantReady=""` 且原 annotation 也空 → 不 patch。

在 `setStoppedStatus`（`:731-753`）的 `r.Status().Update(ctx, instance)` 成功之后、return 之前，加：
```go
	// Stopped instance must not signal ready-for-config (no pod to configure).
	if instance.Annotations[annReadyForConfig] != "" {
		base := instance.DeepCopy()
		delete(instance.Annotations, annReadyForConfig)
		if err := r.Patch(ctx, instance, client.MergeFrom(base)); err != nil {
			log.Error(err, "Failed to clear ready-for-config on stop")
		}
	}
```

> `client` 已在 import 中（`sigs.k8s.io/controller-runtime/pkg/client`，`:37`）。`client.MergeFrom` 来自该包。

- [ ] **Step 4: 跑测试确认通过 + build**

```bash
go test ./internal/controller/ -run 'TestUpdateStatusSetsReadyForConfig|TestSetStoppedStatusClearsReadyForConfig' -v
go test ./internal/controller/ -run 'TestDesiredStatefulSet|TestPodTemplateEqual|TestProbeConfig|TestDefaultProbeConfig' -v
go build ./...
```
Expected: PASS + build OK。

- [ ] **Step 5: Commit**

```bash
git add internal/controller/qwenpawinstance_controller.go internal/controller/annotation_test.go internal/controller/probes.go
git commit -m "feat(operator): write ready-for-config annotation on Pod ready (§6.4 event source)"
```

---

## Task 5: control-plane — config 字段扩展

**Files:**
- Modify: `workpaw-admin/internal/config/config.go`

**背景：** 新增 `InstanceConfig`（`first_login_precreate` 开关）+ `ConfigSyncConfig` 加 `EventDrivenEnabled` / `LeaderElectionEnabled`（spec §10）。defaults 在 `Load()` 里设。

**Interfaces:** 产 `Config.Instance`（`InstanceConfig`）、`Config.ConfigSync.EventDrivenEnabled`、`Config.ConfigSync.LeaderElectionEnabled`。Task 8/10 消费。

- [ ] **Step 1: 写失败测试** — 新增 `internal/config/config_test.go`

```go
package config

import "testing"

func TestDefaultsForPlan3(t *testing.T) {
	// Defaults are set in Load via SetDefault; verify the zero-value Config is
	// populated by exercising the viper defaults directly.
	v := newTestViper(t)
	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !cfg.Instance.FirstLoginPrecreate {
		t.Error("instance.first_login_precreate default = false, want true")
	}
	if !cfg.ConfigSync.EventDrivenEnabled {
		t.Error("config_sync.event_driven_enabled default = false, want true")
	}
}
```
> `newTestViper` 辅助：在同一个 `_test.go` 里定义，调用与 `Load()` 相同的一组 `viper.SetDefault(...)`（重构 §Step 3 的 defaults 进一个内部 `setDefaults(v)` 函数后，测试直接复用）。如果不想重构，测试可改为调用 `Load()` 并断言——但 `Load()` 读 `./config.yaml`，CI 可能没有。**推荐**：把 `Load()` 里的 `viper.SetDefault` 调用抽成 `setDefaults(v *viper.Viper)`，`Load()` 与测试都调用它。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
go test ./internal/config/ -run TestDefaultsForPlan3 -v
```
Expected: FAIL（`cfg.Instance` 字段不存在 → 编译失败）。

- [ ] **Step 3: 实现** — 改 `config.go`

(1) 在 `Config` struct（`:8-19`）加字段：
```go
	Instance          InstanceConfig          `mapstructure:"instance"`
```

(2) 在 `ConfigSyncConfig`（`:22-26`）加字段：
```go
	EventDrivenEnabled    bool `mapstructure:"event_driven_enabled"`
	LeaderElectionEnabled bool `mapstructure:"leader_election_enabled"`
```

(3) 新增类型（紧挨 `ConfigSyncConfig`）：
```go
// InstanceConfig holds per-instance behavioural toggles.
type InstanceConfig struct {
	// FirstLoginPrecreate async-triggers ActivateInstance on every successful
	// login (idempotent), front-loading CR creation to the SSO window so the
	// first GET /api/instance is more likely to hit an already-creating pod
	// (spec §6.1).
	FirstLoginPrecreate bool `mapstructure:"first_login_precreate"`
}
```

(4) 把 `Load()` 里的 `viper.SetDefault(...)` 调用抽成函数（紧邻 `Load` 之前）：
```go
func setDefaults(v *viper.Viper) {
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.mode", "release")
	v.SetDefault("jwt.expire_hours", 24)
	v.SetDefault("jwt.access_expire_minutes", 15)
	v.SetDefault("jwt.refresh_expire_days", 7)
	v.SetDefault("kubernetes.namespace", "workpaw-instances")
	v.SetDefault("kubernetes.qwenpaw_image", "agentscope/qwenpaw:v1.1.12")
	v.SetDefault("ingress.base_domain", "qwenpaw.workpaw.internal")
	v.SetDefault("ingress.class", "nginx")
	v.SetDefault("postgres.port", 5432)
	v.SetDefault("policy.default_idle_timeout_minutes", 30)
	v.SetDefault("policy.default_schedule_stop", "22:00")
	v.SetDefault("config_sync.enabled", true)
	v.SetDefault("config_sync.interval_seconds", 60)
	v.SetDefault("config_sync.concurrency", 4)
	v.SetDefault("config_sync.event_driven_enabled", true)
	v.SetDefault("config_sync.leader_election_enabled", false)
	v.SetDefault("instance.first_login_precreate", true)
	v.SetDefault("multi_enterprise.enabled", false)
	v.SetDefault("state_signing_key", "")
	v.SetDefault("postgres.sslmode", "disable")
	v.SetDefault("postgres.time_zone", "UTC")
}
```
`Load()` 里把原来那一坨 `viper.SetDefault(...)` 替换为 `setDefaults(viper)`。

(5) 测试辅助 `newTestViper`（放 `config_test.go`）：
```go
import "github.com/spf13/viper"

func newTestViper(t *testing.T) *viper.Viper {
	t.Helper()
	v := viper.New()
	setDefaults(v)
	return v
}
```

- [ ] **Step 4: 跑测试确认通过 + build**

```bash
go test ./internal/config/ -v
go build ./...
```
Expected: PASS + build OK。

- [ ] **Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(control-plane): config toggles for event-driven sync + first-login precreate (§6.1/§6.4/§10)"
```

---

## Task 6: control-plane — InstanceService 暴露 RESTConfig

**Files:**
- Modify: `workpaw-admin/internal/service/instance.go`（struct `:25-32`、`NewInstanceService` `:104-141`）

**背景：** control-plane 新 Manager 需要 `*rest.Config` 构造 `ctrl.NewManager`。`restCfg` 目前是 `NewInstanceService` 的局部变量（`:109`），存进 struct 并暴露 accessor（DRY，避免重复 kubeconfig 加载逻辑）。

**Interfaces:** 产 `(s *InstanceService) RESTConfig() *rest.Config`。Task 8 消费。

- [ ] **Step 1: 写失败测试** — `internal/service/instance_test.go`（若不存在则建）

```go
package service

import "testing"

func TestInstanceServiceExposesRESTConfig(t *testing.T) {
	// NewInstanceService falls back to ~/.kube/config; in environments without
	// it the constructor errors. We only assert the accessor compiles + returns
	// the stored value when construction succeeds.
	svc, err := NewInstanceService(nilCfg()) // nilCfg → helper returning a Config that triggers the in-cluster→file fallback
	if err != nil {
		t.Skipf("no kube config available in this env: %v", err)
	}
	if svc.RESTConfig() == nil {
		t.Fatal("RESTConfig() returned nil")
	}
}
```
> `nilCfg()` 辅助返回 `&config.Config{}`（Kubeconfig 空 → 走 InClusterConfig → 失败再走 ~/.kube/config）。若两段都失败则 `NewInstanceService` 返回 err，测试 skip。这样测试在无集群环境下不失败。

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/service/ -run TestInstanceServiceExposesRESTConfig -v
```
Expected: FAIL（`RESTConfig` undefined → 编译失败）。

- [ ] **Step 3: 实现**

(1) struct（`:25-32`）加字段：
```go
	restCfg       *rest.Config
```

(2) accessor（紧邻 `K8sClient()` `:61-63` 之后）：
```go
// RESTConfig returns the Kubernetes rest config used to build clients.
// Used to construct the event-driven config-sync Manager (§6.4).
func (s *InstanceService) RESTConfig() *rest.Config {
	return s.restCfg
}
```

(3) 在 `NewInstanceService` return 的字面量（`:136-140`）加：
```go
		restCfg: restCfg,
```

(4) `nilCfg()` 辅助放 `instance_test.go`：
```go
import "github.com/workpaw/workpaw-admin/internal/config"

func nilCfg() *config.Config { return &config.Config{} }
```

- [ ] **Step 4: 跑测试确认通过 + build**

```bash
go test ./internal/service/ -run TestInstanceServiceExposesRESTConfig -v
go build ./...
```
Expected: PASS（或 skip）+ build OK。

- [ ] **Step 5: Commit**

```bash
git add internal/service/instance.go internal/service/instance_test.go
git commit -m "feat(control-plane): expose InstanceService.RESTConfig for the config-sync Manager (§6.4)"
```

---

## Task 7: control-plane — ConfigReconciler 按用户收敛 + 状态查询

**Files:**
- Modify: `workpaw-admin/internal/service/config_reconciler.go`
- Modify/Create: `workpaw-admin/internal/service/config_reconciler_test.go`

**背景：** 现有 `converge`（`:144`）每 tick 处理**所有**用户的 stale DesiredConfig。event-driven 路径需要「只收敛某个用户」的入口（`ConvergeUser`）+「该用户所有启用 DesiredConfig 是否已 applied」的查询（`UserConfigState` → 写 `config-state` annotation 用）。复用幂等 `convergeOne`。

**Interfaces:**
- 产 `(r *ConfigReconciler) ConvergeUser(ctx, userID string)`、`(r *ConfigReconciler) UserConfigState(ctx, userID string) string`（"syncing"|"synced"）。Task 8 消费。

- [ ] **Step 1: 写失败测试** — `config_reconciler_test.go`

```go
package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// Use the existing test scaffolding (sqlite + fake lister) if present in the
// package; otherwise add a minimal one. The tests below assume a helper
// `newTestReconciler(t)` returning a ConfigReconciler backed by an in-memory
// DB seeded with one enabled binding + DesiredConfigs for a user.
func TestUserConfigStateSyncingThenSynced(t *testing.T) {
	r, userID := newTestReconcilerWithPendingDC(t) // seeds 1 pending DC for userID
	if got := r.UserConfigState(context.Background(), userID); got != "syncing" {
		t.Fatalf("before converge: state=%q want syncing", got)
	}
	// Force-mark applied (simulate a successful push) then re-check.
	markOneApplied(t, r, userID)
	if got := r.UserConfigState(context.Background(), userID); got != "synced" {
		t.Fatalf("after applied: state=%q want synced", got)
	}
}

func TestConvergeUserOnlyTouchesThatUser(t *testing.T) {
	r, a, b := newTestReconcilerTwoUsers(t) // both have a pending DC
	r.ConvergeUser(context.Background(), a)
	// user a's DC was attempted (status flipped from pending via convergeOne);
	// user b's DC untouched by THIS call.
	if touchedB := userDCStatus(r, b); touchedB == "applied" {
		t.Fatal("ConvergeUser(a) must not converge user b")
	}
}

var _ = uuid.Nil // keep import if unused in stub
```
> `newTestReconcilerWithPendingDC` / `newTestReconcilerTwoUsers` / `markOneApplied` / `userDCStatus` 是测试脚手架。**先看包内现有 `config_reconciler_test.go` 是否已有 sqlite+fake lister 工具**（Plan 1/配置同步 reconcile 工作很可能已建）。若有，复用；若无，新建最小脚手架：sqlite `gorm.Open` + 一个 fake `PodLister`（`PodUID` 返回 "pod-uid"，`ListInstanceUserIDs` 返回种子用户）+ 一个 fake `InstanceConnector`。`convergeOne` 在 PodUID 非空时会尝试 `push`；测试里让 connector 记录调用即可，不必真推。

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/service/ -run 'TestUserConfigState|TestConvergeUser' -v
```
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现** — 在 `config_reconciler.go` 紧随 `convergeOne`（`:177-200`）之后追加：

```go
// ConvergeUser pushes stale DesiredConfigs for a single user (idempotent).
// Called by the event-driven ConfigSyncReconciler when the operator signals
// ready-for-config; also reusable for on-demand triggers. Shares the same
// stale-detection predicate as converge() (applied-but-stale OR backoff-elapsed)
// so semantics are identical, just scoped to one user.
func (r *ConfigReconciler) ConvergeUser(ctx context.Context, userID string) {
	now := time.Now()
	var dcs []model.DesiredConfig
	r.db.WithContext(ctx).
		Where("target_user_id = ?", userID).
		Where("binding_id IN (?)",
			r.db.Model(&model.TemplateBinding{}).Where("enabled = ?", true).Select("id")).
		Where("status = ? OR (status != ? AND (next_retry_at IS NULL OR next_retry_at <= ?))",
			"applied", "applied", now).
		Find(&dcs)
	// Per-user there are typically 1-3 DCs (agent/mcp/skill); sequential push
	// is fine and avoids re-plumbing the concurrency pool for a scoped call.
	for i := range dcs {
		r.convergeOne(ctx, &dcs[i])
	}
}

// UserConfigState reports whether all of a user's enabled DesiredConfigs are
// applied. Returns "synced" when none are pending/failed, else "syncing".
// Drives the workpaw.dev/config-state annotation the operator's derivePhase
// reads (spec §6.4).
func (r *ConfigReconciler) UserConfigState(ctx context.Context, userID string) string {
	var pending int64
	r.db.WithContext(ctx).
		Model(&model.DesiredConfig{}).
		Where("target_user_id = ?", userID).
		Where("binding_id IN (?)",
			r.db.Model(&model.TemplateBinding{}).Where("enabled = ?", true).Select("id")).
		Where("status != ?", "applied").
		Count(&pending)
	if pending > 0 {
		return "syncing"
	}
	return "synced"
}
```

- [ ] **Step 4: 跑测试确认通过 + build**

```bash
go test ./internal/service/ -run 'TestUserConfigState|TestConvergeUser' -v
go build ./...
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add internal/service/config_reconciler.go internal/service/config_reconciler_test.go
git commit -m "feat(control-plane): ConfigReconciler.ConvergeUser + UserConfigState (§6.4)"
```

---

## Task 8: control-plane — ConfigSyncReconciler（controller-runtime）+ Manager 启动

**Files:**
- Create: `workpaw-admin/internal/service/config_sync_controller.go`
- Create: `workpaw-admin/internal/service/config_sync_controller_test.go`

**背景（核心机制）：** 引入 controller-runtime Manager（与 Gin 同进程，goroutine 启动）。`ConfigSyncReconciler` watch `QwenPawInstance` CR；当读到 operator 写的 `ready-for-config=true` → 调 `ConvergeUser(userID)`（userID 取自 CR label `workpaw.io/user-id`）→ 按 `UserConfigState` 把 `config-state` patch 成 syncing/synced；若仍 syncing，`RequeueAfter` 短轮询自愈，直到 synced。annotation 写入用 `MergeFrom`（不覆盖 operator 的 `ready-for-config`）。leader election 由 config 控制（HA 时只一个 reconcile）。60s ticker 仍是 safety-net。

**Interfaces:**
- 产 `ConfigSyncReconciler`、`StartConfigSyncController(cfg, instanceSvc, rec, logger, ctx) error`。Task 9 调用 `StartConfigSyncController`。

- [ ] **Step 1: 拉依赖（如缺）**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
go get github.com/go-logr/zapr@latest 2>/dev/null || true
go mod tidy
```
> `controller-runtime`（含 `ctrl.NewManager`）已在 go.mod（`pkg/client` 同模块）。`go-logr/zapr` 把 zap 桥接到 logr（Manager logger）。

- [ ] **Step 2: 写失败测试** — `config_sync_controller_test.go`（fake client）

```go
package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	corev1 "k8s.io/api/core/v1" // for condition if needed
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const (
	annReadyForConfigCP = "workpaw.dev/ready-for-config"
	annConfigState      = "workpaw.dev/config-state"
)

func newSyncReconciler(t *testing.T, objs ...runtime.Object) (*ConfigSyncReconciler, *fake.ClientBuilder) {
	t.Helper()
	s := runtime.NewScheme()
	_ = clientgoscheme.AddToScheme(s)
	_ = workpawv1alpha1.AddToScheme(s)
	rec, _ := newTestReconcilerEmpty(t) // empty DB; ConvergeUser/UserConfigState no-op
	b := fake.NewClientBuilder().WithScheme(s).WithRuntimeObjects(objs...)
	return &ConfigSyncReconciler{
		Client:    b.Build(),
		Scheme:    s,
		Reconciler: rec,
	}, b
}

func TestSyncReconcilerPatchesConfigStateWhenReadyForConfigTrue(t *testing.T) {
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name: "alice", Namespace: "workpaw-instances",
			Labels:      map[string]string{"workpaw.io/user-id": "user-1"},
			Annotations: map[string]string{annReadyForConfigCP: "true"},
		},
	}
	r, _ := newSyncReconciler(t, inst)
	res, err := r.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}})
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	got := &workpawv1alpha1.QwenPawInstance{}
	_ = r.Get(context.Background(), types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}, got)
	if got.Annotations[annConfigState] == "" {
		t.Fatal("config-state annotation not patched")
	}
	// Empty DB → UserConfigState returns "synced" (no pending DCs).
	if got.Annotations[annConfigState] != "synced" {
		t.Errorf("config-state = %q, want synced (empty DB)", got.Annotations[annConfigState])
	}
	if res.RequeueAfter != 0 {
		t.Errorf("synced should not requeue; got RequeueAfter=%v", res.RequeueAfter)
	}
}

func TestSyncReconcilerIgnoresInstanceNotReadyForConfig(t *testing.T) {
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{
			Name: "alice", Namespace: "workpaw-instances",
			Labels: map[string]string{"workpaw.io/user-id": "user-1"}, // no ready-for-config
		},
	}
	r, _ := newSyncReconciler(t, inst)
	_, err := r.Reconcile(context.Background(), ctrl.Request{NamespacedName: types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}})
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	got := &workpawv1alpha1.QwenPawInstance{}
	_ = r.Get(context.Background(), types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}, got)
	if _, ok := got.Annotations[annConfigState]; ok {
		t.Fatal("must not write config-state before ready-for-config")
	}
}

var _ = corev1.Pod{}       // keep import
var _ = uuid.Nil           // keep import
```
> `newTestReconcilerEmpty(t)` 返回一个空 DB 的 `*ConfigReconciler`（复用 Task 7 脚手架的 sqlite 构造器，不种子任何 DC）。`UserConfigState` 在空 DB 上 → `synced`。

- [ ] **Step 3: 跑测试确认失败**

```bash
go test ./internal/service/ -run 'TestSyncReconciler' -v
```
Expected: FAIL（`ConfigSyncReconciler` undefined）。

- [ ] **Step 4: 实现** — 创建 `config_sync_controller.go`

```go
package service

import (
	"context"
	"fmt"
	"time"

	"github.com/go-logr/zapr"
	"go.uber.org/zap"
	"k8s.io/apimachinery/pkg/runtime"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"

	"github.com/workpaw/workpaw-admin/internal/config"
)

// Annotation keys shared with the operator (writer boundary, spec §6.4):
//   - workpaw.dev/ready-for-config : written by OPERATOR when Pod is ready.
//   - workpaw.dev/config-state     : written by CONTROL-PLANE (this reconciler).
const (
	annReadyForConfig = "workpaw.dev/ready-for-config"
	annConfigState    = "workpaw.dev/config-state"
	labelUserID       = "workpaw.io/user-id"
)

// ConfigSyncReconciler reacts to QwenPawInstance annotation changes: when the
// operator signals ready-for-config=true, it immediately converges that user's
// config (collapsing the 60s config leg to ~seconds) and writes config-state
// (syncing|synced), which the operator's derivePhase reads. While still
// syncing it short-requeues to self-heal; the 60s ticker stays as a safety-net
// for missed watch events (spec §6.4).
type ConfigSyncReconciler struct {
	client.Client
	Scheme     *runtime.Scheme
	Reconciler *ConfigReconciler
}

// +kubebuilder:rbac:groups=workpaw.workpaw.io,resources=qwenpawinstances,verbs=get;list;watch;update;patch
// +kubebuilder:rbac:groups=workpaw.workpaw.io,resources=qwenpawinstances/finalizers,verbs=update

func (r *ConfigSyncReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)
	inst := &workpawv1alpha1.QwenPawInstance{}
	if err := r.Get(ctx, req.NamespacedName, inst); err != nil {
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}
	// Only act on the operator's ready signal.
	if inst.Annotations[annReadyForConfig] != "true" {
		return ctrl.Result{}, nil
	}
	userID := inst.Labels[labelUserID]
	if userID == "" {
		logger.Info("ready-for-config set but no workpaw.io/user-id label; skipping", "instance", req.NamespacedName)
		return ctrl.Result{}, nil
	}

	// Idempotent per-user push (existing convergeOne).
	r.Reconciler.ConvergeUser(ctx, userID)

	// Reflect progress in the config-state annotation the operator reads.
	state := r.Reconciler.UserConfigState(ctx, userID)
	if inst.Annotations[annConfigState] == state {
		// No annotation change; still requeue if not synced so a backoff retry
		// gets re-evaluated without depending on the watch firing again.
		if state != "synced" {
			return ctrl.Result{RequeueAfter: 15 * time.Second}, nil
		}
		return ctrl.Result{}, nil
	}
	base := inst.DeepCopy()
	if inst.Annotations == nil {
		inst.Annotations = map[string]string{}
	}
	inst.Annotations[annConfigState] = state
	if err := r.Patch(ctx, inst, client.MergeFrom(base)); err != nil {
		logger.Error(err, "patch config-state annotation", "state", state, "instance", req.NamespacedName)
		return ctrl.Result{}, err
	}
	logger.Info("config-state updated", "instance", req.NamespacedName, "state", state)
	if state != "synced" {
		return ctrl.Result{RequeueAfter: 15 * time.Second}, nil
	}
	return ctrl.Result{}, nil
}

// SetupWithManager registers the reconciler for QwenPawInstance changes.
func (r *ConfigSyncReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&workpawv1alpha1.QwenPawInstance{}).
		Named("config-sync").
		Complete(r)
}

// StartConfigSyncController builds a controller-runtime Manager that watches
// QwenPawInstance CRs and drives event-driven config sync alongside the
// existing 60s ticker reconciler. Runs in a goroutine cancelled by ctx.
// Leader election is configurable for HA deployments.
func StartConfigSyncController(ctx context.Context, cfg *config.Config, instanceSvc *InstanceService, rec *ConfigReconciler, logger *zap.Logger) error {
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		return fmt.Errorf("add clientgo scheme: %w", err)
	}
	if err := workpawv1alpha1.AddToScheme(scheme); err != nil {
		return fmt.Errorf("add workpaw scheme: %w", err)
	}

	opts := ctrl.Options{
		Scheme: scheme,
		Logger: zapr.NewLogger(logger),
		// Leader election: when enabled, only one replica runs the reconcile loop.
		LeaderElection:   cfg.ConfigSync.LeaderElectionEnabled,
		LeaderElectionID: "workpaw-admin-config-sync.leader",
	}
	// When leader election is OFF, metrics/health servers default bind addrs are
	// disabled to avoid clashing with the Gin server / other managers.
	opts.Metrics = nil

	mgr, err := ctrl.NewManager(instanceSvc.RESTConfig(), opts)
	if err != nil {
		return fmt.Errorf("new manager: %w", err)
	}
	if err := (&ConfigSyncReconciler{
		Client:     mgr.GetClient(),
		Scheme:     mgr.GetScheme(),
		Reconciler: rec,
	}).SetupWithManager(mgr); err != nil {
		return fmt.Errorf("setup config-sync reconciler: %w", err)
	}
	go func() {
		if err := mgr.Start(ctx); err != nil {
			logger.Error(err, "config-sync manager stopped")
		}
	}()
	logger.Info("Config-sync controller manager started",
		zap.Bool("leader_election", cfg.ConfigSync.LeaderElectionEnabled))
	return nil
}
```

> 注意：`opts.Metrics = nil` 在 controller-runtime v0.24 需要 import `metricsserver`；若直接赋 nil 编译报错，则用 `opts.Metrics = metricsserver.Options{BindAddress: "0"}`（禁用 metrics server，避免与 Gin 端口/其他 manager 冲突）。**实施时按编译结果二选一**。同理 `HealthProbeBindAddress` 默认 `:8081`，与 operator 的 probe 端口无关但可能与 control-plane 其他东西冲突 → 显式留空。

- [ ] **Step 5: 跑测试确认通过 + build**

```bash
go test ./internal/service/ -run 'TestSyncReconciler' -v
go build ./...
```
Expected: PASS。如果 `opts.Metrics = nil` 编译失败，按 Step 4 注释改 `metricsserver.Options{BindAddress:"0"}`（import `metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"`），再 build。

- [ ] **Step 6: Commit**

```bash
git add internal/service/config_sync_controller.go internal/service/config_sync_controller_test.go go.mod go.sum
git commit -m "feat(control-plane): controller-runtime ConfigSyncReconciler + Manager for event-driven config sync (§6.4)"
```

---

## Task 9: control-plane — router 启动 Manager + serve.go 优雅关停

**Files:**
- Modify: `workpaw-admin/internal/router/router.go`（ConfigReconciler 块 `:293-307`）
- Modify: `workpaw-admin/cmd/serve.go`

**背景：** 在现有 `go reconciler.Run(...)` 旁启动 Manager（受 `event_driven_enabled` 开关控制）。serve.go 引入 signal-aware ctx，让 Gin 与 Manager 共享生命周期（最佳实践：优雅关停；且避免 `ctrl.SetupSignalHandler()` 全局信号重复注册）。

**Interfaces:** 消费 Task 8 的 `StartConfigSyncController`；消费 Task 5 的 config 开关。

- [ ] **Step 1: 改 router.go** — 把 `:293-307` 的 ConfigReconciler 块扩为同时启动 ticker + Manager：

```go
	// ConfigReconciler: declarative config sync to user Pods.
	if cfg.ConfigSync.Enabled && gdb != nil && instanceSvc != nil {
		reconciler := service.NewConfigReconciler(
			gdb, instanceSvc, instanceSvc, auditSvc, logger,
			time.Duration(cfg.ConfigSync.IntervalSeconds)*time.Second,
			cfg.ConfigSync.Concurrency, cryptoSvc,
		)
		go reconciler.Run(rootCtx) // rootCtx wired in serve.go (see Task 9 serve.go step)
		logger.Info("Config reconciler (ticker) started",
			zap.Int("interval_s", cfg.ConfigSync.IntervalSeconds),
			zap.Int("concurrency", cfg.ConfigSync.Concurrency),
		)

		// Event-driven overlay (spec §6.4): a controller-runtime Manager watches
		// QwenPawInstance CRs and triggers per-user converge on the operator's
		// ready-for-config signal, collapsing the 60s config leg to ~seconds.
		// The ticker above stays as a safety-net. Disable via config_sync.event_driven_enabled.
		if cfg.ConfigSync.EventDrivenEnabled {
			if err := service.StartConfigSyncController(rootCtx, cfg, instanceSvc, reconciler, logger); err != nil {
				logger.Warn("config-sync controller disabled (ticker still active)", zap.Error(err))
			}
		}
	}
```

> `rootCtx` 需要 `Setup` 拿到。改 `func Setup(cfg *config.Config, logger *zap.Logger) *gin.Engine` 签名为 `func Setup(ctx context.Context, cfg *config.Config, logger *zap.Logger) *gin.Engine`，把 `context.Background()`（`:302` 原值）替换为入参 `ctx`。serve.go 传 signal-aware ctx。`router.go` 顶部加 `import "context"`。

- [ ] **Step 2: 改 serve.go** — signal-aware ctx + 优雅关停 Gin：

```go
package cmd

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/workpaw/workpaw-admin/internal/config"
	"github.com/workpaw/workpaw-admin/internal/router"
	"github.com/workpaw/workpaw-admin/internal/service"
	"go.uber.org/zap"
)

// (Version, devMode, encryptSecretCmd 不变)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the Control Plane API server",
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return fmt.Errorf("failed to load config: %w", err)
		}
		logger, err := config.NewLogger(cfg)
		if err != nil {
			return fmt.Errorf("failed to create logger: %w", err)
		}
		defer logger.Sync()

		if devMode {
			cfg.Server.Mode = "debug"
		}

		logger.Info("Starting WorkPaw Control Plane",
			zap.Int("port", cfg.Server.Port),
			zap.String("mode", cfg.Server.Mode),
		)

		// Root ctx cancelled on SIGINT/SIGTERM — shared by the background
		// config-sync Manager and the HTTP server for graceful shutdown.
		rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		defer stop()

		r := router.Setup(rootCtx, cfg, logger)

		srv := &http.Server{
			Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
			Handler: r,
		}
		errCh := make(chan error, 1)
		go func() { errCh <- srv.ListenAndServe() }()

		select {
		case <-rootCtx.Done():
			logger.Info("Shutdown signal received")
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			return srv.Shutdown(shutdownCtx)
		case err := <-errCh:
			return err
		}
	},
}
```
> 其余 `versionCmd` / `encryptSecretCmd` / `init()` 保持原样。`service` import 若未在 serve.go 其他处用到且 encryptSecretCmd 已用，则保留。

- [ ] **Step 3: build + 跑既有测试**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
go build ./...
go test ./internal/router/ -run TestScenarioRoutesRegistered -v 2>&1 | tail -5   # pre-existing failure; tolerate
go test ./internal/service/ ./internal/config/ -v 2>&1 | tail -30
```
Expected: build OK；Plan 3 新测全过；`TestScenarioRoutesRegistered` 是预存在失败（Plan 1 ledger 已记，与本任务无关）。

- [ ] **Step 4: 手动冒烟（可选但推荐）**

```bash
# 启动 control-plane（dev 模式），观察日志有 "Config-sync controller manager started" 与 "Config reconciler (ticker) started"
cd /Users/zhangsan/workpaw/workpaw-admin && go run . serve --dev
# Ctrl+C 应在 ~10s 内优雅退出（"Shutdown signal received"），不卡死。
```

- [ ] **Step 5: Commit**

```bash
git add internal/router/router.go cmd/serve.go
git commit -m "feat(control-plane): start config-sync Manager + graceful shutdown shared by Gin + Manager (§6.4)"
```

---

## Task 10: control-plane — §6.1 错峰预建（auth Callback 异步 ActivateInstance）

**Files:**
- Modify: `workpaw-admin/internal/handler/auth.go`（struct `:19-30`、Callback `:115-225`）
- Modify: `workpaw-admin/internal/router/router.go`（注入 precreator）
- Create: `workpaw-admin/internal/handler/auth_precreate_test.go`

**背景：** spec §6.1：每次 OIDC 登录成功 `UpsertOnLogin` 之后，异步 `ActivateInstance`（靠其内部幂等「CR 已存在且 DesiredState=Running 直接返回」避免重复建）。失败不阻塞登录（goroutine + recover + zap warn + 30s timeout）。受 `instance.first_login_precreate` 开关控制。为解耦 + 可测，定义窄接口 `InstancePrecreator`（`*InstanceService` 已满足）。

**Interfaces:**
- 产 `service.InstancePrecreator` 接口（在 `service` 包，紧邻 `PodLister`）。
- 产 `(h *AuthHandler) SetInstancePrecreator(svc InstancePrecreator, enabled bool, logger *zap.Logger)`。

- [ ] **Step 1: 写失败测试** — `auth_precreate_test.go`

```go
package handler

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
)

type fakePrecreator struct {
	calls int32
}

func (f *fakePrecreator) ActivateInstance(ctx context.Context, userID, email string, enterpriseID uuid.UUID) (interface{}, error) {
	atomic.AddInt32(&f.calls, 1)
	return nil, nil
}

// Callers of the precreate path go through the package-internal helper so the
// test does not need a full Gin context / OIDC stack.
func TestMaybePrecreateInvokesWhenEnabled(t *testing.T) {
	fc := &fakePrecreator{}
	mc := &maybePrecreate{svc: fc, enabled: true}
	mc.fire(context.Background(), "user-1", "alice@example.com", uuid.New())
	mc.wait()
	if atomic.LoadInt32(&fc.calls) != 1 {
		t.Fatalf("calls=%d want 1", fc.calls)
	}
}

func TestMaybePrecreateNoopWhenDisabled(t *testing.T) {
	fc := &fakePrecreator{}
	mc := &maybePrecreate{svc: fc, enabled: false}
	mc.fire(context.Background(), "u", "a@example.com", uuid.New())
	mc.wait()
	if atomic.LoadInt32(&fc.calls) != 0 {
		t.Fatal("disabled precreate must not call ActivateInstance")
	}
}
```
> `maybePrecreate` 是 AuthHandler 内部小助手（封装 goroutine + recover + timeout + wait），便于单测。`fire` 启 goroutine，`wait` 等其完成（测试用；生产 fire-and-forget）。`fakePrecreator.ActivateInstance` 用 `interface{}` 返回匹配接口签名（Go 结构化类型——`InstancePrecreator` 接口方法签名要与 `*InstanceService.ActivateInstance` 一致：返回 `(*service.InstanceStatus, error)`；测试里 fake 返回 `(nil,nil)` 即可，但接口需精确签名——见 Step 3，fake 在测试里实现 `InstancePrecreator`，返回 `(*service.InstanceStatus, error)`）。

**修正 Step 1 fake 签名**——为精确匹配接口：
```go
import "github.com/workpaw/workpaw-admin/internal/service"

func (f *fakePrecreator) ActivateInstance(ctx context.Context, userID, email string, enterpriseID uuid.UUID) (*service.InstanceStatus, error) {
	atomic.AddInt32(&f.calls, 1)
	return nil, nil
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
go test ./internal/handler/ -run 'TestMaybePrecreate' -v
```
Expected: FAIL（`maybePrecreate` undefined）。

- [ ] **Step 3a: 定义接口** — `internal/service/instance.go` 紧邻 `PodLister` 接口之后：

```go
// InstancePrecreator is the narrow surface AuthHandler needs to async-trigger
// instance creation on login (spec §6.1). *InstanceService satisfies it.
type InstancePrecreator interface {
	ActivateInstance(ctx context.Context, userID, email string, enterpriseID uuid.UUID) (*InstanceStatus, error)
}
```

- [ ] **Step 3b: 实现 AuthHandler 字段 + 助手 + setter** — `auth.go`

(1) import 加 `"context"`、`"time"`、`"go.uber.org/zap"`、保留 `uuid`。struct（`:19-30`）加字段：
```go
	precreator  service.InstancePrecreator // nil = precreate not wired
	precreateOn bool
	preLog      *zap.Logger
```

(2) setter（紧邻 `NewAuthHandler` 之后）：
```go
// SetInstancePrecreator wires async first-login instance precreation (spec §6.1).
// When enabled is false the precreate path is a no-op. svc may be nil.
func (h *AuthHandler) SetInstancePrecreator(svc service.InstancePrecreator, enabled bool, logger *zap.Logger) {
	h.precreator = svc
	h.precreateOn = enabled && svc != nil
	h.preLog = logger
}
```

(3) 助手类型 + fire（文件末尾）：
```go
// maybePrecreate encapsulates the async precreate path so it is unit-testable
// without a full Gin/OIDC stack.
type maybePrecreate struct {
	svc     service.InstancePrecreator
	enabled bool
	log     *zap.Logger
	done    chan struct{}
}

func (m *maybePrecreator) fire(parent context.Context, userID, email string, enterpriseID uuid.UUID) {
	if m == nil || !m.enabled || m.svc == nil {
		return
	}
	m.done = make(chan struct{})
	go func() {
		defer func() {
			if r := recover(); r != nil && m.log != nil {
				m.log.Error("async precreate panic", zap.Any("recover", r))
			}
			close(m.done)
		}()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = parent // parent not used (request may be cancelled when response returns)
		if _, err := m.svc.ActivateInstance(ctx, userID, email, enterpriseID); err != nil && m.log != nil {
			m.log.Warn("async precreate failed", zap.String("user", userID), zap.Error(err))
		}
	}()
}

func (m *maybePrecreator) wait() {
	if m != nil && m.done != nil {
		<-m.done
	}
}
```
> 修正命名：类型名 `maybePrecreate`（struct）与方法接收器 `*maybePrecreator` 不一致——统一为 `type maybePrecreator struct` + `func (m *maybePrecreator) fire/wait`。测试用 `&maybePrecreator{svc: fc, enabled: true}`。

(4) 在 Callback（`:115-225`）里，`UpsertOnLogin` 成功返回后（即 `:213` 的 `}` 闭合 `if err != nil` 之后、`:215` injectMembershipRoles 之前或 token 生成之后均可——spec 说不阻塞响应，放 token 生成之后更接近响应返回点），插入：
```go
	// Async first-login precreate (spec §6.1): front-load CR creation so the
	// first GET /api/instance is more likely to hit an already-creating pod.
	// Idempotent (ActivateInstance no-ops when CR exists with DesiredState=Running).
	if h.precreator != nil {
		(&maybePrecreator{svc: h.precreator, enabled: h.precreateOn, log: h.preLog}).
			fire(c.Request.Context(), accountID.String(), user.Email, enterprise.ID)
	}
```

- [ ] **Step 4: router.go 注入 precreator** — 在 `instanceSvc` 构造后（`router.go` `:202-233` 块内、`instanceHandler` 创建附近）：
```go
		if authHandler != nil {
			authHandler.SetInstancePrecreator(instanceSvc, cfg.Instance.FirstLoginPrecreate, logger)
		}
```
> 需要 `authHandler` 在该处可见。检查 router.go 中 `authHandler` 的构造点是否在 instanceSvc 块之前；若在之后，把 SetInstancePrecreator 调用挪到 `authHandler` 构造之后即可。`cfg.Instance.FirstLoginPrecreate` 来自 Task 5。

- [ ] **Step 5: 跑测试确认通过 + build**

```bash
go test ./internal/handler/ -run 'TestMaybePrecreate' -v
go build ./...
```
Expected: PASS + build OK。

- [ ] **Step 6: Commit**

```bash
git add internal/handler/auth.go internal/handler/auth_precreate_test.go internal/service/instance.go internal/router/router.go
git commit -m "feat(control-plane): async first-login instance precreate on OIDC callback (§6.1)"
```

---

## Task 11: 跨仓验证 + ledger

**Files:**
- Modify: `.superpowers/sdd/progress-phase1b-speedups.md`（新建，ledger）

- [ ] **Step 1: operator 全量 build + 新单测**

```bash
cd /Users/zhangsan/workpaw/workpaw-operator
go build ./...
go vet ./internal/controller/...
go test ./internal/controller/ -run 'TestProbeConfig|TestDefaultProbeConfig|TestDesiredStatefulSet|TestPodTemplateEqual|TestUpdateStatusSetsReadyForConfig|TestSetStoppedStatusClearsReadyForConfig' -v
```
Expected: build OK，vet 干净，6 组测试全过。**不跑** envtest suite（`-run TestControllers` 缺 kubebuilder binary，已知环境问题）。

- [ ] **Step 2: control-plane 全量 build + 新单测**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
go build ./...
go vet ./...
go test ./internal/config/ ./internal/service/ ./internal/handler/ -run 'TestDefaultsForPlan3|TestInstanceServiceExposesRESTConfig|TestUserConfigState|TestConvergeUser|TestSyncReconciler|TestMaybePrecreate' -v
```
Expected: build OK，新测全过（`TestInstanceServiceExposesRESTConfig` 在无 kube 环境下 skip）。

- [ ] **Step 3: 预存在失败确认（非本 plan 引入）**

```bash
go test ./internal/router/ 2>&1 | grep -E 'FAIL|ok'   # TestScenarioRoutesRegistered 预存在
go test ./internal/handler/ -run TestAdminGetOIDC 2>&1 | tail -3   # OIDC DB-seed 预存在
```
Expected：仅这两处预存在失败（Plan 1 ledger 已记）。

- [ ] **Step 4: 写 ledger** — `.superpowers/sdd/progress-phase1b-speedups.md`

```markdown
# Plan 3 ledger: Phase 1B 提速精选

**Plan:** docs/superpowers/plans/2026-07-05-phase1b-speedups.md
**Spec:** §6.1 / §6.2 / §6.4 / §6.5

## Branches (待 finishing 决策)
- operator workpaw-operator/feature/phase1b-speedups (main..<HEAD>): N commits
- control-plane workpaw-admin/feature/phase1b-speedups (main..<HEAD>): N commits

## Tasks
- [x] Task 1 operator ProbeConfig + ConfigMap 读取 (<sha>)
- [x] Task 2 operator StartupProbe + Readiness/Liveness + ImagePullPolicy (<sha>)
- [x] Task 3 operator podTemplateEqual 纳入探针/ImagePullPolicy (<sha>)
- [x] Task 4 operator ready-for-config annotation (<sha>)
- [x] Task 5 control-plane config 字段 (<sha>)
- [x] Task 6 control-plane RESTConfig accessor (<sha>)
- [x] Task 7 control-plane ConvergeUser/UserConfigState (<sha>)
- [x] Task 8 control-plane ConfigSyncReconciler + Manager (<sha>)
- [x] Task 9 control-plane router 启动 Manager + 优雅关停 (<sha>)
- [x] Task 10 control-plane 错峰预建 (<sha>)

## Deferred / 顺手项
- envest 集成测试（startup→ready→annotation 时序）需 setup-envtest 安装 kubebuilder binary，本机缺；单测已用 fake client 覆盖逻辑。
- warm pool（§7 + §11 name 解耦）= Plan 4，复用本 plan 引入的 control-plane Manager。
```

- [ ] **Step 5: Commit ledger**

```bash
cd /Users/zhangsan/workpaw
git add .superpowers/sdd/progress-phase1b-speedups.md
git commit -m "docs(sdd): Plan 3 ledger (Phase 1B speedups)"
```

---

## Self-Review (Plan 3)

**Spec coverage:**
- §6.1 错峰预建 → Task 10 ✅
- §6.2 startup probe + ConfigMap 热更新 + podTemplateEqual hash → Task 1/2/3 ✅
- §6.4 event-driven 配置同步（operator 写 ready-for-config / control-plane 写 config-state / 60s ticker safety-net / MergeFrom 不互相覆盖 / event_driven_enabled 开关 / leader election）→ Task 4/7/8/9 ✅
- §6.5 ImagePullPolicy IfNotPresent → Task 2/3 ✅
- §9 错误处理（SSE 断连降级属 Plan 2；startup probe 反复失败 → operator phase=error，已在 Plan 1 derivePhase）→ 不需新代码 ✅
- §10 配置项（startup_probe.* / readiness_probe.* / warm_pool.* / event_driven_enabled / first_login_precreate）→ Task 1/5 ✅（warm_pool.* 留 Plan 4）
- §13 风险/回退（探针参数 ConfigMap 可热回退、特性开关关闭即零变化）→ Task 1/5/9 ✅

**Placeholder scan:** 已避免 "TBD/TODO/适当的错误处理"。两处「按编译结果二选一」（Task 8 metrics 选项）给出明确两条路径，非占位。envest 集成测试明确标为 deferred 并给出原因。

**Type consistency:** `ProbeConfig`（Task 1）→ `probes := r.probeConfig(ctx)`（Task 2）；`annReadyForConfig`（operator Task 4）与 `annReadyForConfig`（control-plane Task 8）key 字符串一致 `"workpaw.dev/ready-for-config"`；`ConvergeUser`/`UserConfigState`（Task 7）→ 调用点（Task 8）；`InstancePrecreator`（Task 10）签名与 `*InstanceService.ActivateInstance` 一致；`RESTConfig()`（Task 6）→ 调用点（Task 8）；`StartConfigSyncController`（Task 8）→ 调用点（Task 9）。✅

**Ambiguity:** writer 边界（operator 写 ready-for-config、control-plane 写 config-state、双方 MergeFrom 不覆盖）在 Task 4 / Task 8 / 全局约束三处一致陈述，无歧义。

# Plan 1: 实例状态细粒度化 + SSE 推送 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 operator 暴露细粒度的实例 `phase`，control-plane 透传 `phase`/`assignment` 并新增 SSE 端点，为前端「真实进度等待体验」（Plan 2）打基础。

**Architecture:** operator 在 `updateStatus` 从 Pod status 推导 `phase`（纯函数 `derivePhase`）写入 CR `.status.phase`；control-plane `mapInstanceStatus` 透传 `phase` 并派生 `assignment`；新增 `GET /api/instance/events` SSE 端点，轮询 CR 变化推送 `phase`/`ready`/`error` 事件（轮询式 SSE，1s 间隔，真 watch 留待后续优化）。

**Tech Stack:** Go — operator 用 controller-runtime + stdlib `testing` + `sigs.k8s.io/controller-runtime/pkg/client/fake`；control-plane 用 Gin + Zap + GORM，测试 stdlib `testing`。

**对应 spec：** `docs/superpowers/specs/2026-07-05-first-login-wait-ux-design.md` §6.3 / §8.1 / §8.3。

**两仓定位：**
- `workpaw-operator`：`/Users/zhangsan/workpaw/workpaw-operator`
- `workpaw-control-plane`：`/Users/zhangsan/workpaw/workpaw-control-plane`

## Global Constraints

- QwenPaw 镜像锁定 `agentscope/qwenpaw:v1.1.12`，不改 Pod 内应用。
- operator CR `currentState` 保持 TitleCase（`Creating`/`Running`/`Stopped`/`Error`）向后兼容；新增 `phase` 用 snake_case（前端友好）。
- 不引入新外部依赖；SSE 用 Gin 内置 `c.Writer`（`http.Flusher`），不引 SSE 库。
- 测试：operator 用 stdlib `testing`（参考 `internal/controller/desiredstatefulset_test.go` 的 `newReconcilerForTest` + `fake.NewClientBuilder`）；control-plane service 测试用 `testutil.NewTestDB`，纯逻辑测试直接构造最小 struct。
- 每个 Task 末尾 commit，commit 信息用 conventional commits（`feat(operator):` / `feat(control-plane):`）。

---

## File Structure

**operator（`workpaw-operator`）：**
- Modify: `api/v1alpha1/qwenpawinstance_types.go` — `QwenPawInstanceStatus` 加 `Phase` 字段
- Create: `internal/controller/phase.go` — `derivePhase(pod, configState)` 纯函数
- Create: `internal/controller/phase_test.go` — `derivePhase` 单元测试
- Modify: `internal/controller/qwenpawinstance_controller.go:658-723` — `updateStatus` 调用 `derivePhase` 写入 `status.phase`
- Modify: `internal/controller/qwenpawinstance_controller_test.go` — `updateStatus` 集成测试
- Regenerate: `config/crd/bases/*.yaml`（`make manifests`）

**control-plane（`workpaw-control-plane`）：**
- Modify: `internal/service/instance.go:85-91` — `InstanceStatus` 加 `Phase`/`Assignment` 字段
- Modify: `internal/service/instance.go:398-424` — `mapInstanceStatus` 填 `Phase`；新增 `deriveAssignment`
- Create: `internal/service/instance_status_test.go` — `mapInstanceStatus`/`deriveAssignment` 单元测试
- Create: `internal/handler/instance_events.go` — `InstanceStatusGetter` 接口 + `watchLoop` + `Events` handler
- Create: `internal/handler/instance_events_test.go` — `watchLoop` 单元测试（fake getter）
- Modify: `internal/router/router.go`（instance 路由组）— 注册 `GET /events`

---

## Task 1: operator — CR Status 添加 Phase 字段

**Files:**
- Modify: `workpaw-operator/api/v1alpha1/qwenpawinstance_types.go`
- Regenerate: `workpaw-operator/config/crd/bases/`

**Interfaces:**
- Produces: `QwenPawInstanceStatus.Phase string`（json `phase,omitempty`），供 Task 3 写入、control-plane 读取。

- [ ] **Step 1: 加 Phase 字段到 QwenPawInstanceStatus**

在 `api/v1alpha1/qwenpawinstance_types.go` 的 `QwenPawInstanceStatus` struct 里，紧邻 `CurrentState` 字段后加：

```go
// Phase is a fine-grained, snake_case lifecycle phase derived from the Pod
// status (e.g. "scheduling", "image_pulling", "config_syncing", "running").
// Unlike CurrentState (coarse, TitleCase), this drives the frontend progress UI.
// Empty until the reconciler derives it.
Phase string `json:"phase,omitempty"`
```

- [ ] **Step 2: 重新生成 CRD manifests**

Run（在 `workpaw-operator` 目录）:
```bash
make manifests
```
Expected: `config/crd/bases/workpaw.workpaw.com_qwenpawinstances.yaml` 的 `status.phase` 字段出现（搜 `phase:` 应能命中新增项）。

- [ ] **Step 3: 编译并跑现有测试确认无破坏**

Run:
```bash
go build ./... && go test ./api/... ./internal/controller/...
```
Expected: 编译通过，现有测试全绿（仅加字段不改变行为）。

- [ ] **Step 4: Commit**

```bash
git add api/v1alpha1/qwenpawinstance_types.go config/crd/bases/
git commit -m "feat(operator): add Phase field to QwenPawInstanceStatus"
```

---

## Task 2: operator — derivePhase 纯函数 + 单元测试（TDD）

**Files:**
- Create: `workpaw-operator/internal/controller/phase.go`
- Test: `workpaw-operator/internal/controller/phase_test.go`

**Interfaces:**
- Produces: `derivePhase(pod *corev1.Pod, configState string) string`，返回 `pending`/`scheduling`/`image_pulling`/`container_starting`/`config_syncing`/`running`/`error`。供 Task 3 调用。

- [ ] **Step 1: 写失败测试**

Create `internal/controller/phase_test.go`:

```go
package controller

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestDerivePhase(t *testing.T) {
	cases := []struct {
		name        string
		pod         *corev1.Pod
		configState string
		want        string
	}{
		{"nil pod", nil, "", "pending"},
		{"unscheduled", &corev1.Pod{Spec: corev1.PodSpec{}}, "", "scheduling"},
		{"image pulling", &corev1.Pod{
			Spec: corev1.PodSpec{NodeName: "n1"},
			Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
				State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}},
			}}},
		}, "", "image_pulling"},
		{"image pull backoff", &corev1.Pod{
			Spec: corev1.PodSpec{NodeName: "n1"},
			Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
				State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ImagePullBackOff"}},
			}}},
		}, "", "error"},
		{"container starting", &corev1.Pod{
			Spec:   corev1.PodSpec{NodeName: "n1"},
			Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{Ready: false}}},
		}, "", "container_starting"},
		{"running", &corev1.Pod{
			Spec: corev1.PodSpec{NodeName: "n1"},
			Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
				Type: corev1.PodReady, Status: corev1.ConditionTrue,
			}}},
		}, "", "running"},
		{"config syncing", &corev1.Pod{
			Spec: corev1.PodSpec{NodeName: "n1"},
			Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
				Type: corev1.PodReady, Status: corev1.ConditionTrue,
			}}},
		}, "syncing", "config_syncing"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := derivePhase(tc.pod, tc.configState); got != tc.want {
				t.Fatalf("derivePhase(%v,%q)=%q want %q", tc.pod, tc.configState, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./internal/controller/ -run TestDerivePhase -v
```
Expected: FAIL（`derivePhase` undefined）。

- [ ] **Step 3: 实现 derivePhase**

Create `internal/controller/phase.go`:

```go
package controller

import corev1 "k8s.io/api/core/v1"

// derivePhase maps a Pod's status to a fine-grained, snake_case phase string
// consumed by the frontend progress UI. configState is the value of the
// QwenPawInstance annotation workpaw.dev/config-state ("syncing" while the
// control-plane ConfigReconciler is pushing user configs). pod may be nil when
// the StatefulSet has not yet created it.
func derivePhase(pod *corev1.Pod, configState string) string {
	if pod == nil {
		return "pending"
	}
	if pod.Spec.NodeName == "" {
		return "scheduling"
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if w := cs.State.Waiting; w != nil {
			switch w.Reason {
			case "ImagePullBackOff", "ErrImagePull", "Failed", "CrashLoopBackOff":
				return "error"
			case "Pending", "ContainerCreating":
				return "image_pulling"
			}
		}
		if t := cs.State.Terminated; t != nil && t.ExitCode != 0 {
			return "error"
		}
	}
	for _, c := range pod.Status.Conditions {
		if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
			if configState == "syncing" {
				return "config_syncing"
			}
			return "running"
		}
	}
	return "container_starting"
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./internal/controller/ -run TestDerivePhase -v
```
Expected: PASS（7 个子用例全过）。

- [ ] **Step 5: Commit**

```bash
git add internal/controller/phase.go internal/controller/phase_test.go
git commit -m "feat(operator): add derivePhase to map Pod status to fine-grained phase"
```

---

## Task 3: operator — updateStatus 写入 phase + 集成测试

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go:658-723`
- Test: `workpaw-operator/internal/controller/qwenpawinstance_controller_test.go`

**Interfaces:**
- Consumes: `derivePhase` (Task 2)
- Produces: `updateStatus` 写入 `instance.Status.Phase`，control-plane 读取。

- [ ] **Step 1: 写失败测试**

Append to `internal/controller/qwenpawinstance_controller_test.go`:

```go
func TestUpdateStatusDerivesRunningPhase(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = workpawv1alpha1.AddToScheme(scheme)
	_ = corev1.AddToScheme(scheme)

	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Spec:       workpawv1alpha1.QwenPawInstanceSpec{DesiredState: "Running"},
	}
	// Pod name follows existing convention: qwenpaw-{username}-0
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "qwenpaw-alice-0", Namespace: "workpaw-instances"},
		Spec:       corev1.PodSpec{NodeName: "n1"},
		Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{
			Type: corev1.PodReady, Status: corev1.ConditionTrue,
		}}},
	}
	cl := fake.NewClientBuilder().WithScheme(scheme).WithObjects(inst, pod).
		WithStatusSubresource(&workpawv1alpha1.QwenPawInstance{}).Build()
	r := &QwenPawInstanceReconciler{Client: cl, Scheme: scheme, Config: &Config{BaseDomain: "qwenpaw.workpaw.internal"}}

	if _, err := r.updateStatus(context.Background(), inst, "alice"); err != nil {
		t.Fatalf("updateStatus: %v", err)
	}
	got := &workpawv1alpha1.QwenPawInstance{}
	if err := cl.Get(context.Background(), types.NamespacedName{Name: "alice", Namespace: "workpaw-instances"}, got); err != nil {
		t.Fatal(err)
	}
	if got.Status.Phase != "running" {
		t.Fatalf("phase=%q want running", got.Status.Phase)
	}
}
```

补 import（若文件顶部尚无）：`"context"`、`"sigs.k8s.io/controller-runtime/pkg/client/fake"`、`"k8s.io/apimachinery/pkg/types"`（`runtime`/`workpawv1alpha1`/`corev1`/`metav1` 已在 `desiredstatefulset_test.go` 同包用例中存在，按需补）。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./internal/controller/ -run TestUpdateStatusDerivesRunningPhase -v
```
Expected: FAIL（`got.Status.Phase` 为空，因为 updateStatus 还没写 phase）。

- [ ] **Step 3: 改 updateStatus 推导并写入 phase**

在 `qwenpawinstance_controller.go` 的 `updateStatus`（:658-723）中，做两处改动。

改动 A — 让 NotFound 时 phase 入口为 nil（把 `pod` 包成可空变量）。把现有：

```go
	if err := r.Get(ctx, podKey, pod); err != nil {
		if errors.IsNotFound(err) {
			currentState = "Creating"
		} else {
			return ctrl.Result{}, err
		}
	} else {
		podIP = pod.Status.PodIP
		// Check if pod is ready
		ready := false
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
				ready = true
				break
			}
		}
		if ready {
			currentState = "Running"
		} else {
			currentState = "Creating"
		}
	}
```

替换为：

```go
	var podForPhase *corev1.Pod
	if err := r.Get(ctx, podKey, pod); err != nil {
		if errors.IsNotFound(err) {
			currentState = "Creating"
		} else {
			return ctrl.Result{}, err
		}
	} else {
		podForPhase = pod
		podIP = pod.Status.PodIP
		// Check if pod is ready
		ready := false
		for _, cond := range pod.Status.Conditions {
			if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
				ready = true
				break
			}
		}
		if ready {
			currentState = "Running"
		} else {
			currentState = "Creating"
		}
	}
	phase := derivePhase(podForPhase, instance.Annotations["workpaw.dev/config-state"])
```

改动 B — 把 phase 纳入「变化判断」与赋值。把现有：

```go
	// Check if status actually changed to avoid unnecessary updates
	if instance.Status.CurrentState == currentState &&
		instance.Status.PodName == podName &&
		instance.Status.PodIP == podIP &&
		instance.Status.IngressHost == host {
		// No update needed; if still creating, requeue to check again
		if currentState == "Creating" {
			return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
		}
		return ctrl.Result{}, nil
	}

	instance.Status.CurrentState = currentState
	instance.Status.PodName = podName
	instance.Status.PodIP = podIP
	instance.Status.IngressHost = host
```

替换为：

```go
	// Check if status actually changed to avoid unnecessary updates
	if instance.Status.CurrentState == currentState &&
		instance.Status.Phase == phase &&
		instance.Status.PodName == podName &&
		instance.Status.PodIP == podIP &&
		instance.Status.IngressHost == host {
		// No update needed; if still creating, requeue to check again
		if currentState == "Creating" {
			return ctrl.Result{RequeueAfter: 10 * time.Second}, nil
		}
		return ctrl.Result{}, nil
	}

	instance.Status.CurrentState = currentState
	instance.Status.Phase = phase
	instance.Status.PodName = podName
	instance.Status.PodIP = podIP
	instance.Status.IngressHost = host
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./internal/controller/ -run TestUpdateStatusDerivesRunningPhase -v
```
Expected: PASS。

- [ ] **Step 5: 跑全量 controller 测试确认无回归**

Run:
```bash
go test ./internal/controller/...
```
Expected: PASS（含原有用例 + 新用例）。

- [ ] **Step 6: Commit**

```bash
git add internal/controller/qwenpawinstance_controller.go internal/controller/qwenpawinstance_controller_test.go
git commit -m "feat(operator): write derived phase to QwenPawInstance status in updateStatus"
```

---

## Task 4: control-plane — InstanceStatus 加 phase/assignment + mapInstanceStatus 填充（TDD）

**Files:**
- Modify: `workpaw-control-plane/internal/service/instance.go:85-91`（struct）与 `:398-424`（mapInstanceStatus）
- Test: `workpaw-control-plane/internal/service/instance_status_test.go`

**Interfaces:**
- Consumes: `QwenPawInstance.Status.Phase`（Task 1）
- Produces: `InstanceStatus.Phase` / `InstanceStatus.Assignment` JSON 字段，供 handler（含 Plan 2 前端）消费。

- [ ] **Step 1: 写失败测试**

Create `internal/service/instance_status_test.go`:

```go
package service

import (
	"testing"

	"github.com/google/uuid"
	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

func newMapStatusService() *InstanceService {
	return &InstanceService{cfg: &config.Config{Ingress: config.IngressConfig{BaseDomain: "qwenpaw.workpaw.internal", Port: 443}}}
}

func TestMapInstanceStatusPassesPhaseAndAssignment(t *testing.T) {
	s := newMapStatusService()
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Status:     workpawv1alpha1.QwenPawInstanceStatus{CurrentState: "Creating", Phase: "image_pulling"},
	}
	got := s.mapInstanceStatus(inst)
	if got.Phase != "image_pulling" {
		t.Fatalf("phase=%q want image_pulling", got.Phase)
	}
	if got.Assignment != "cold" {
		t.Fatalf("assignment=%q want cold (creating)", got.Assignment)
	}
}

func TestMapInstanceStatusRunningIsReusing(t *testing.T) {
	s := newMapStatusService()
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Status:     workpawv1alpha1.QwenPawInstanceStatus{CurrentState: "Running", Phase: "running"},
	}
	got := s.mapInstanceStatus(inst)
	if got.Assignment != "reusing" {
		t.Fatalf("assignment=%q want reusing (running)", got.Assignment)
	}
}

func TestDeriveAssignment(t *testing.T) {
	cases := []struct{ state, want string }{
		{"creating", "cold"},
		{"", "cold"},
		{"running", "reusing"},
		{"stopped", "reusing"},
	}
	for _, tc := range cases {
		if got := deriveAssignment(tc.state); got != tc.want {
			t.Fatalf("deriveAssignment(%q)=%q want %q", tc.state, got, tc.want)
		}
	}
}

// uuid is used by future tasks; keep import active.
var _ = uuid.Nil
```

> 注：`config.IngressConfig` 的字段名以仓库实际为准（`mapInstanceStatus` 用到 `s.cfg.Ingress.BaseDomain` 与 `s.cfg.Ingress.Port`）。若该 struct 名不同，按 `instance.go` 顶部 `config` 用法对齐。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./internal/service/ -run 'TestMapInstanceStatus|TestDeriveAssignment' -v
```
Expected: FAIL（`got.Phase`/`got.Assignment` 字段不存在、`deriveAssignment` undefined）。

- [ ] **Step 3: 扩展 InstanceStatus struct**

在 `internal/service/instance.go` 把：

```go
// InstanceStatus is the API-facing representation of an instance's state.
type InstanceStatus struct {
	Status     string `json:"status"`
	IngressURL string `json:"ingress_url"`
	CreatedAt  string `json:"created_at,omitempty"`
	LastActive string `json:"last_active_at,omitempty"`
}
```

替换为：

```go
// InstanceStatus is the API-facing representation of an instance's state.
type InstanceStatus struct {
	Status     string `json:"status"`
	Phase      string `json:"phase,omitempty"`     // fine-grained phase from operator (§6.3)
	Assignment string `json:"assignment,omitempty"` // warm_hit|cold|pending|reusing (§8.1)
	IngressURL string `json:"ingress_url"`
	CreatedAt  string `json:"created_at,omitempty"`
	LastActive string `json:"last_active_at,omitempty"`
}
```

- [ ] **Step 4: 新增 deriveAssignment 并在 mapInstanceStatus 填字段**

在 `internal/service/instance.go` 紧邻 `mapInstanceStatus` 上方新增：

```go
// deriveAssignment classifies how the instance is being provided to the user.
// Phase 1 (no warm pool): running/stopped → reusing (existing instance),
// anything else → cold (freshly created). warm_hit is added in Plan 4.
func deriveAssignment(currentState string) string {
	switch currentState {
	case "running", "stopped":
		return "reusing"
	default:
		return "cold"
	}
}
```

并在 `mapInstanceStatus`（`instance.go:398-424`）中，把：

```go
	status := &InstanceStatus{
		Status: state,
	}
```

替换为：

```go
	status := &InstanceStatus{
		Status:     state,
		Phase:      instance.Status.Phase,
		Assignment: deriveAssignment(state),
	}
```

- [ ] **Step 5: 跑测试确认通过**

Run:
```bash
go test ./internal/service/ -run 'TestMapInstanceStatus|TestDeriveAssignment' -v
```
Expected: PASS。

- [ ] **Step 6: 跑全量 service 测试确认无回归**

Run:
```bash
go test ./internal/service/...
```
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add internal/service/instance.go internal/service/instance_status_test.go
git commit -m "feat(control-plane): expose phase/assignment in InstanceStatus"
```

---

## Task 5: control-plane — SSE 端点 GET /api/instance/events（TDD）

**Files:**
- Create: `workpaw-control-plane/internal/handler/instance_events.go`
- Test: `workpaw-control-plane/internal/handler/instance_events_test.go`
- Modify: `workpaw-control-plane/internal/router/router.go`（instance 路由组）

**Interfaces:**
- Consumes: `service.InstanceService.GetInstance(ctx, email, enterpriseID) (*InstanceStatus, error)`（已存在，`*InstanceService` 自动满足 `InstanceStatusGetter` 接口）
- Produces: `GET /api/instance/events` SSE 流；事件 `phase` / `ready` / `error`。

- [ ] **Step 1: 写失败测试**

Create `internal/handler/instance_events_test.go`:

```go
package handler

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/workpaw/workpaw-control-plane/internal/service"
)

type fakeGetter struct {
	states []*service.InstanceStatus
	i      int
}

func (f *fakeGetter) GetInstance(_ context.Context, _ string, _ uuid.UUID) (*service.InstanceStatus, error) {
	if f.i >= len(f.states) {
		f.i = len(f.states) - 1
	}
	s := f.states[f.i]
	f.i++
	return s, nil
}

func TestWatchLoopEmitsPhaseThenReady(t *testing.T) {
	fg := &fakeGetter{states: []*service.InstanceStatus{
		{Status: "creating", Phase: "image_pulling", Assignment: "cold"},
		{Status: "creating", Phase: "image_pulling", Assignment: "cold"},
		{Status: "running", Phase: "running", Assignment: "reusing", IngressURL: "https://q/i/alice"},
	}}
	rr := httptest.NewRecorder()
	if err := watchLoop(context.Background(), fg, "alice@x.com", uuid.Nil, rr, 2*time.Millisecond); err != nil {
		t.Fatalf("watchLoop: %v", err)
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"phase":"image_pulling"`) {
		t.Fatalf("missing first phase event:\n%s", body)
	}
	if !strings.Contains(body, "event: ready") {
		t.Fatalf("missing ready event:\n%s", body)
	}
	if !strings.Contains(body, `"ingress_url":"https://q/i/alice"`) {
		t.Fatalf("missing ingress_url in ready event:\n%s", body)
	}
}

func TestWatchLoopStopsOnContextCancel(t *testing.T) {
	fg := &fakeGetter{states: []*service.InstanceStatus{{Status: "creating", Phase: "scheduling"}}}
	rr := httptest.NewRecorder()
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled
	if err := watchLoop(ctx, fg, "alice@x.com", uuid.Nil, rr, 10*time.Millisecond); err != nil {
		t.Fatalf("watchLoop: %v", err)
	}
	// should return promptly without ready event
	if strings.Contains(rr.Body.String(), "event: ready") {
		t.Fatal("should not emit ready on cancelled context")
	}
}
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
go test ./internal/handler/ -run TestWatchLoop -v
```
Expected: FAIL（`watchLoop` undefined）。

- [ ] **Step 3: 实现 watchLoop + Events handler + 接口**

Create `internal/handler/instance_events.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/workpaw/workpaw-control-plane/internal/middleware"
	"github.com/workpaw/workpaw-control-plane/internal/service"
)

// InstanceStatusGetter is the subset of *service.InstanceService that watchLoop
// needs. Declared as an interface so the handler is unit-testable with a fake.
type InstanceStatusGetter interface {
	GetInstance(ctx context.Context, email string, enterpriseID uuid.UUID) (*service.InstanceStatus, error)
}

// watchLoop polls the instance status through getter and writes Server-Sent
// Events to w until the instance becomes "running" (emits a final "ready"
// event) or ctx is cancelled. interval controls the poll cadence.
//
// This is a polling-based SSE (simple, no new dependency); a true K8s watch
// optimization is deferred. Events emitted:
//
//	event: phase   data: {"status":..,"phase":..,"assignment":..}
//	event: ready   data: {"ingress_url":..}
func watchLoop(ctx context.Context, getter InstanceStatusGetter, email string, enterpriseID uuid.UUID, w http.ResponseWriter, interval time.Duration) error {
	flusher, _ := w.(http.Flusher)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var lastStatus, lastPhase string
	for {
		st, err := getter.GetInstance(ctx, email, enterpriseID)
		if err == nil && (st.Status != lastStatus || st.Phase != lastPhase) {
			lastStatus, lastPhase = st.Status, st.Phase
			data, _ := json.Marshal(map[string]string{
				"status":     st.Status,
				"phase":      st.Phase,
				"assignment": st.Assignment,
			})
			fmt.Fprintf(w, "event: phase\ndata: %s\n\n", data)
			if flusher != nil {
				flusher.Flush()
			}
			if st.Status == "running" {
				rd, _ := json.Marshal(map[string]string{"ingress_url": st.IngressURL})
				fmt.Fprintf(w, "event: ready\ndata: %s\n\n", rd)
				if flusher != nil {
					flusher.Flush()
				}
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
	}
}

// Events streams the caller's instance status changes as SSE.
// GET /api/instance/events
func (h *InstanceHandler) Events(c *gin.Context) {
	claims := middleware.GetClaims(c)
	if claims == nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	enterpriseID := enterpriseIDFromClaims(claims)
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	_ = watchLoop(c.Request.Context(), h.instanceService, claims.Email, enterpriseID, c.Writer, 1*time.Second)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
go test ./internal/handler/ -run TestWatchLoop -v
```
Expected: PASS。

- [ ] **Step 5: 注册路由**

在 `internal/router/router.go` 中找到 instance 路由组（`GET /api/instance`、`POST /api/instance/activate` 等注册处，约 `router.go:224-231`），新增一行：

```go
instanceGroup.GET("/events", instanceHandler.Events)
```

（变量名 `instanceGroup` 与 `instanceHandler` 以该文件现有命名为准；若不同按实际对齐。）

- [ ] **Step 6: 编译并跑全量 handler 测试**

Run:
```bash
go build ./... && go test ./internal/handler/...
```
Expected: 编译通过，全绿。

- [ ] **Step 7: 手动冒烟（可选，需 dev 集群）**

启动 control-plane（`cd workpaw-control-plane && go run . serve --dev`），用一个 dev token 请求：
```bash
curl -N -H "Authorization: Bearer <dev-token>" https://127.0.0.1:8090/api/instance/events
```
Expected: 看到 `event: phase` 行随实例状态变化滚动，实例 running 后收到 `event: ready` 并关闭。

- [ ] **Step 8: Commit**

```bash
git add internal/handler/instance_events.go internal/handler/instance_events_test.go internal/router/router.go
git commit -m "feat(control-plane): add GET /api/instance/events SSE endpoint"
```

---

## Self-Review（计划作者已做）

**Spec 覆盖**：§6.3 phase 暴露 → Task 1/2/3；§8.1 GET 扩展返回 phase/assignment → Task 4；§8.3 SSE 端点 → Task 5。§6.3 的 `config_syncing` 分支由 `derivePhase` 读 annotation 实现，annotation 的写入方在 Plan 3（§6.4），此处 `derivePhase` 已支持，Plan 3 接上即生效——无 gap。

**占位符扫描**：无 TBD/TODO；所有代码步骤含完整可编译代码。

**类型一致性**：`derivePhase`、`Phase`、`Assignment`、`deriveAssignment`、`InstanceStatusGetter`、`watchLoop` 在各 Task 间签名一致；`*service.InstanceService` 满足 `InstanceStatusGetter`（`GetInstance` 签名匹配 `instance.go:53`）。

---

## Execution Handoff

Plan 1 完成后，Plan 2（前端真实进度体验）即可消费 `phase`/`assignment` 与 SSE 端点。Plan 3（提速）会写入 `workpaw.dev/config-state` annotation 让 `config_syncing` phase 生效。Plan 4（warm pool）扩展 `assignment` 增加 `warm_hit`。

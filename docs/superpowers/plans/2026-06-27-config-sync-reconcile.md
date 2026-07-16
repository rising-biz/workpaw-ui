# 配置同步声明式 Reconcile 实现计划 (Config Sync Reconcile)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 workpaw-admin 把配置(应用模板 agent/MCP/skill、infra 镜像/资源/CORS、provider api_key/base_url)以**声明式 reconcile** 的方式同步到各用户容器:Pod 重建自动恢复、模板更新自动重推、批量广播、部分失败带退避重试、infra 变更滚动更新——全部复用现有 `PodConfigClient` HTTP 通道(QwenPaw v1.1.12 黑盒唯一的配置面)。

**Architecture:** 在 control-plane 新增 `template_bindings`(管理员意图)+ `desired_configs`(每用户收敛态)两张表与一个后台 `ConfigReconciler` 循环,把现有 `PodConfigClient`/`Apply*` 当作 apply 原语复用;通过 `AppliedSpecHash`(模板内容变更)+ `AppliedPodUID`(Pod 重建)双重检测驱动重推;在 operator 侧把 `ensureStatefulSet` 改为对已存在 StatefulSet 的模板漂移做 patch(触发滚动更新),实现 infra 热更;新增 `ProviderTemplate` + `PodConfigClient.ConfigureProvider` 把模型密钥纳入同一 reconcile 框架。

**Tech Stack:** Go (Gin/Zap/Viper/Cobra), GORM + PostgreSQL (生产) / glebarez/sqlite (测试), controller-runtime/Kubebuilder (operator), QwenPaw v1.1.12 HTTP API(不可改)。

## Global Constraints

- QwenPaw 锁定 v1.1.12,是黑盒;**唯一配置面是 Pod 的 HTTP API**(`/api/agents`、`/api/mcp`、`/api/skills/save`、`/api/models/:id/config`),不得引入 file-watch/sidecar/init-container。
- 所有 Go 代码用 Gin/Zap/Viper/Cobra(control-plane)、Kubebuilder/controller-runtime(operator)。
- 数据库只有 PostgreSQL;GORM 模型 `AutoMigrate` 在 `internal/model/model.go:Migrate` 统一注册。
- JSON tag 一律 snake_case,匹配 admin 前端契约(`console/src/.../adminApi.ts` 是 spec)。
- 测试用 `testutil.NewTestDB(t, &model.X{}...)`(内存 SQLite)+ `httptest` Pod mock + `fakeConnector`(实现 `InstanceConnector`)。命令:`cd workpaw-admin && go test ./internal/...`。
- 运行控制面:`cd workpaw-admin && go run . serve --dev`(Viper 从 CWD 读 config.yaml)。
- operator:`cd workpaw-operator && make run` / `make manifests` / `make test`。
- 不要破坏现有 `POST /api/admin/templates/{agents|mcps|skills}/:id/apply` 同步 apply 的行为(保留为临时一次性推送;声明式走新的 `bindings`)。
- Pod 重建检测基于 Pod **UID**(StatefulSet Pod 名 `qwenpaw-{username}-0` 稳定,但 UID 变化)。

## File Structure

**control-plane (`workpaw-admin/`)**
- `internal/model/model.go` — Modify:新增 `TemplateBinding`、`DesiredConfig`、`ProviderTemplate`;注册进 `Migrate`。
- `internal/service/spec_hash.go` — Create:`specHash` 通用哈希 + uuid 排序辅助。
- `internal/service/pod_config.go` — Modify:新增 `ConfigureProvider`、`ListProviders`。
- `internal/service/template_apply.go` — Modify:抽取 push 原语(`pushAgentToPod`/`pushAgentWithCascade`/`pushMCPToPod`/`pushSkillToPod`/`pushProviderToPod`),`Apply*` 改为调用它们(行为不变)。
- `internal/service/instance.go` — Modify:新增 `ListInstanceUserIDs`、`PodUID`。
- `internal/service/binding.go` — Create:`TemplateBindingService`(CRUD + materialize 决策)。
- `internal/service/config_reconciler.go` — Create:`ConfigReconciler`(materialize + converge + 退避 + 并发)。
- `internal/service/template.go` — Modify:`ParseTemplateType` 增加 `provider(s)`;`TemplateService` 增加 provider CRUD 分支(若需)。
- `internal/config/config.go` — Modify:新增 `ConfigSyncConfig`。
- `internal/handler/admin_binding.go` — Create:bindings CRUD + desired-configs 列表 handler。
- `internal/router/router.go` — Modify:注册 binding 路由;启动 reconciler goroutine。
- 各 `*_test.go` — Create/Modify:对应单测。

**operator (`workpaw-operator/`)**
- `internal/controller/qwenpawinstance_controller.go` — Modify:抽取 `desiredStatefulSet(...)`,在 `ensureStatefulSet` 已存在分支对模板漂移做 patch(镜像/资源/env CORS)。

---

## Part A — Control Plane:声明式 Reconcile(应用模板 + provider)

### Task 1: 模型层 — TemplateBinding / DesiredConfig / ProviderTemplate

**Files:**
- Modify: `workpaw-admin/internal/model/model.go`
- Test: `workpaw-admin/internal/model/config_sync_test.go`

**Interfaces:**
- Produces: `model.TemplateBinding`、`model.DesiredConfig`、`model.ProviderTemplate` 三个 GORM 模型;`Migrate()` 会建表。

- [ ] **Step 1: 写失败测试**

```go
// internal/model/config_sync_test.go
package model

import "testing"

func TestConfigSyncTablesMigrate(t *testing.T) {
	db := testutil.NewTestDB(t,
		&TemplateBinding{}, &DesiredConfig{}, &ProviderTemplate{},
		&AgentTemplate{}, &MCPTemplate{}, &SkillTemplate{}, &TemplateApply{},
	)
	// AutoMigrate succeeded (NewTestDB calls it) — tables exist.
	for _, tbl := range []string{"template_bindings", "desired_configs", "provider_templates"} {
		if !db.Migrator().HasTable(tbl) {
			t.Fatalf("table %s not created", tbl)
		}
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/model/ -run TestConfigSyncTablesMigrate`
Expected: FAIL — `testutil` 未导入 / 类型未定义。

- [ ] **Step 3: 写模型**

在 `internal/model/model.go` 的 `SkillTemplate` 之后、`TemplateApply` 之前插入:

```go
// ProviderTemplate is a reusable model-provider definition (api_key/base_url/
// custom headers) applied centrally to users' Pods via PUT /api/models/:id/config.
// api_key is AES-GCM encrypted at rest (reuse the OIDC client-secret encryption).
type ProviderTemplate struct {
	ID          uuid.UUID              `gorm:"type:uuid;primaryKey" json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Spec        map[string]interface{} `gorm:"serializer:json" json:"spec"` // {provider_id, api_key?, base_url?, ...}
	CreatedBy   string                 `json:"created_by"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	DeletedAt   gorm.DeletedAt         `gorm:"index" json:"-"` // soft delete
}

// TemplateBinding is admin intent: "apply template T to {user|all}". It is the
// declarative source of truth the ConfigReconciler materializes into
// DesiredConfig rows and converges. Deleting a binding stops future convergence
// for its targets (the already-applied config is NOT removed from the Pod in
// v1 — QwenPaw v1.1.12 has no clean delete API).
type TemplateBinding struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	TemplateType  string    `gorm:"index:idx_binding" json:"template_type"` // agent|mcp|skill|provider
	TemplateID    uuid.UUID `gorm:"type:uuid;index:idx_binding" json:"template_id"`
	Scope         string    `json:"scope"`         // "user" | "all"
	TargetUserID  string    `json:"target_user_id"`  // set when Scope="user"
	TargetAgentID string    `json:"target_agent_id"` // for mcp/skill
	Enabled       bool      `gorm:"default:true" json:"enabled"`
	CreatedBy     string    `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// DesiredConfig is the per-user convergence state for one binding. The
// ConfigReconciler drives the Pod toward this state. Repush is triggered when
// AppliedSpecHash != current template hash (content changed) OR AppliedPodUID
// != current Pod UID (Pod rebuilt). This row IS the desired state — unlike
// TemplateApply, which is an append-only event log.
type DesiredConfig struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	BindingID      uuid.UUID  `gorm:"type:uuid;index" json:"binding_id"`
	TemplateType   string     `gorm:"index:idx_dc_target" json:"template_type"`
	TemplateID     uuid.UUID  `gorm:"type:uuid" json:"template_id"`
	TargetUserID   string     `gorm:"index:idx_dc_target" json:"target_user_id"`
	TargetAgentID  string     `json:"target_agent_id"`
	AppliedSpecHash string    `json:"applied_spec_hash"`
	AppliedPodUID  string     `json:"applied_pod_uid"`
	LastAppliedAt  *time.Time `json:"last_applied_at"`
	Status         string     `gorm:"index" json:"status"` // pending|applied|failed
	LastError      string     `json:"last_error"`
	RetryCount     int        `json:"retry_count"`
	NextRetryAt    *time.Time `gorm:"index" json:"next_retry_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}
```

更新 `Migrate`:

```go
func Migrate(gdb *gorm.DB) error {
	return gdb.AutoMigrate(
		&Account{}, &RefreshToken{}, &AuditLog{},
		&OIDCConfig{}, &Policy{},
		&AgentTemplate{}, &MCPTemplate{}, &SkillTemplate{}, &ProviderTemplate{},
		&TemplateApply{}, &TemplateBinding{}, &DesiredConfig{},
		&Scenario{},
	)
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/model/ -run TestConfigSyncTablesMigrate`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd workpaw-admin
git add internal/model/model.go internal/model/config_sync_test.go
git commit -m "feat(model): add TemplateBinding, DesiredConfig, ProviderTemplate tables"
```

---

### Task 2: specHash 工具

**Files:**
- Create: `workpaw-admin/internal/service/spec_hash.go`
- Test: `workpaw-admin/internal/service/spec_hash_test.go`

**Interfaces:**
- Produces: `func specHash(parts ...interface{}) string`、`func sortedUUIDStrings(ids []uuid.UUID) []string`。reconciler 用它计算模板当前内容指纹。

- [ ] **Step 1: 写失败测试**

```go
// internal/service/spec_hash_test.go
package service

import (
	"testing"

	"github.com/google/uuid"
)

func TestSpecHashStableForSameContent(t *testing.T) {
	a := specHash(map[string]interface{}{"name": "x", "url": "http://m"})
	b := specHash(map[string]interface{}{"url": "http://m", "name": "x"}) // different order
	if a != b {
		t.Fatalf("specHash not order-stable: %s != %s", a, b)
	}
	if a == "" {
		t.Fatal("specHash empty")
	}
}

func TestSpecHashDiffersOnContentChange(t *testing.T) {
	a := specHash(map[string]interface{}{"name": "x"})
	b := specHash(map[string]interface{}{"name": "y"})
	if a == b {
		t.Fatal("specHash should differ on content change")
	}
}

func TestSpecHashAgentIncludesLinkedIDs(t *testing.T) {
	id1 := uuid.New()
	id2 := uuid.New()
	ids := sortedUUIDStrings([]uuid.UUID{id2, id1}) // input unsorted
	if ids[0] > ids[1] {
		t.Fatal("sortedUUIDStrings did not sort")
	}
	spec := map[string]interface{}{"name": "a"}
	h1 := specHash(spec, ids)
	// same IDs different order → same hash
	h2 := specHash(spec, sortedUUIDStrings([]uuid.UUID{id1, id2}))
	if h1 != h2 {
		t.Fatal("agent hash not stable across ID order")
	}
	// different IDs → different hash
	h3 := specHash(spec, sortedUUIDStrings([]uuid.UUID{id1, uuid.New()}))
	if h1 == h3 {
		t.Fatal("agent hash should change when linked IDs change")
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestSpecHash`
Expected: FAIL — `specHash` undefined.

- [ ] **Step 3: 写实现**

```go
// internal/service/spec_hash.go
package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"

	"github.com/google/uuid"
)

// specHash returns a stable 16-char hex digest over the JSON encoding of its
// parts. json.Marshal sorts map keys, so map field order does not matter.
// Used to detect template content changes (drive declarative repush).
func specHash(parts ...interface{}) string {
	h := sha256.New()
	enc := json.NewEncoder(h)
	enc.SetEscapeHTML(false)
	for _, p := range parts {
		if err := enc.Encode(p); err != nil {
			return ""
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

// sortedUUIDStrings returns the string form of the UUIDs sorted ascending, so
// specHash is stable regardless of slice order.
func sortedUUIDStrings(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	sort.Strings(out)
	return out
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestSpecHash`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd workpaw-admin
git add internal/service/spec_hash.go internal/service/spec_hash_test.go
git commit -m "feat(service): add stable specHash for template change detection"
```

---

### Task 3: InstanceService — ListInstanceUserIDs + PodUID

**Files:**
- Modify: `workpaw-admin/internal/service/instance.go`
- Test: `workpaw-admin/internal/service/instance_reconcile_test.go`

**Interfaces:**
- Produces: `func (s *InstanceService) ListInstanceUserIDs(ctx context.Context) ([]string, error)`、`func (s *InstanceService) PodUID(ctx context.Context, userID string) (string, error)`。
- Consumes: 现有 `s.kubeClient`、`s.k8sClient`、`instanceName`、`s.cfg.Kubernetes.Namespace`。

- [ ] **Step 1: 写失败测试**

```go
// internal/service/instance_reconcile_test.go
package service

import (
	"context"
	"testing"
)

// InstanceService K8s methods need a live cluster; these are covered by the
// integration test in workpaw-dev-k8s-cluster. Here we assert the methods
// exist with the right signatures via a compile-time interface check.
func TestInstanceServiceReconcileAPIShape(t *testing.T) {
	var _ interface {
		ListInstanceUserIDs(ctx context.Context) ([]string, error)
		PodUID(ctx context.Context, userID string) (string, error)
	} = (*InstanceService)(nil)
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestInstanceServiceReconcileAPIShape`
Expected: FAIL — methods not defined.

- [ ] **Step 3: 写实现**

在 `internal/service/instance.go` 末尾(`mapInstanceStatus` 之后)追加:

```go
// ListInstanceUserIDs returns the user IDs (from the workpaw.io/user-id label)
// of all QwenPawInstance CRs in the managed namespace. Used by the
// ConfigReconciler to expand scope="all" bindings into per-user DesiredConfigs.
func (s *InstanceService) ListInstanceUserIDs(ctx context.Context) ([]string, error) {
	list := &workpawv1alpha1.QwenPawInstanceList{}
	if err := s.k8sClient.List(ctx, list, client.InNamespace(s.cfg.Kubernetes.Namespace)); err != nil {
		return nil, fmt.Errorf("list instances: %w", err)
	}
	out := make([]string, 0, len(list.Items))
	for i := range list.Items {
		if uid := list.Items[i].Labels["workpaw.io/user-id"]; uid != "" {
			out = append(out, uid)
		}
	}
	return out, nil
}

// PodUID returns the current UID of the user's running Pod, or "" if no pod
// exists (instance stopped / not yet created). The ConfigReconciler uses this
// to detect Pod rebuilds: a changed UID means the pod was recreated and its
// in-memory config is gone, so desired configs must be re-pushed.
func (s *InstanceService) PodUID(ctx context.Context, userID string) (string, error) {
	name := instanceName(userID)
	podName := fmt.Sprintf("qwenpaw-%s-0", name)
	pod, err := s.kubeClient.CoreV1().Pods(s.cfg.Kubernetes.Namespace).Get(
		ctx, podName, metav1.GetOptions{},
	)
	if err != nil {
		if apierrors.IsNotFound(err) {
			return "", nil // no running pod
		}
		return "", fmt.Errorf("get pod %s: %w", podName, err)
	}
	return string(pod.UID), nil
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestInstanceServiceReconcileAPIShape`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd workpaw-admin
git add internal/service/instance.go internal/service/instance_reconcile_test.go
git commit -m "feat(service): add InstanceService.ListInstanceUserIDs + PodUID for rebuild detection"
```

---

### Task 4: PodConfigClient — ConfigureProvider + ListProviders

**Files:**
- Modify: `workpaw-admin/internal/service/pod_config.go`
- Test: `workpaw-admin/internal/service/pod_config_provider_test.go`

**Interfaces:**
- Produces: `func (c *PodConfigClient) ListProviders(ctx context.Context) ([]PodProvider, error)`、`func (c *PodConfigClient) ConfigureProvider(ctx context.Context, providerID string, body map[string]interface{}) error`。
- Consumes: QwenPaw HTTP API `GET /api/models`、`PUT /api/models/:id/config`。

- [ ] **Step 1: 写失败测试**

```go
// internal/service/pod_config_provider_test.go
package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfigureProvider(t *testing.T) {
	var gotPath, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.Method + " " + r.URL.Path
		buf := make([]byte, 1024)
		n, _ := r.Body.Read(buf)
		gotBody = string(buf[:n])
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewPodConfigClient(nil, srv.URL, "tok")
	err := c.ConfigureProvider(context.Background(), "dashscope", map[string]interface{}{
		"provider_id": "dashscope",
		"api_key":     "sk-x",
		"base_url":    "https://dashscope.aliyuncs.com",
	})
	if err != nil {
		t.Fatalf("ConfigureProvider: %v", err)
	}
	if gotPath != "PUT /api/models/dashscope/config" {
		t.Fatalf("unexpected path: %s", gotPath)
	}
	var sent map[string]interface{}
	if err := json.Unmarshal([]byte(gotBody), &sent); err != nil {
		t.Fatal(err)
	}
	if _, ok := sent["provider_id"]; ok {
		t.Fatal("provider_id must be stripped from the wire body")
	}
	if sent["api_key"] != "sk-x" {
		t.Fatalf("api_key not forwarded: %v", sent["api_key"])
	}
}

func TestListProviders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/models" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{
			{"id": "dashscope", "api_key": "sk-******"},
		})
	}))
	defer srv.Close()

	c := NewPodConfigClient(nil, srv.URL, "tok")
	got, err := c.ListProviders(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "dashscope" {
		t.Fatalf("unexpected providers: %+v", got)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestConfigureProvider|TestListProviders"`
Expected: FAIL — `ConfigureProvider` / `PodProvider` undefined.

- [ ] **Step 3: 写实现**

在 `internal/service/pod_config.go` 的 `PodAgent` 结构定义之后追加类型,并在 `SaveSkill` 之后追加方法:

```go
// PodProvider represents a model provider returned by GET /api/models.
type PodProvider struct {
	ID     string `json:"id"`
	APIKey string `json:"api_key"` // masked ("sk-******") when set, "" when unset
}

// ListProviders calls GET /api/models and returns the provider list.
func (c *PodConfigClient) ListProviders(ctx context.Context) ([]PodProvider, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, c.readError(resp)
	}

	var providers []PodProvider
	if err := json.NewDecoder(resp.Body).Decode(&providers); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return providers, nil
}

// ConfigureProvider calls PUT /api/models/:providerID/config. The provider_id
// field is stripped from the body before sending (it is routing metadata, not
// part of the QwenPaw provider config payload).
func (c *PodConfigClient) ConfigureProvider(ctx context.Context, providerID string, body map[string]interface{}) error {
	wire := make(map[string]interface{}, len(body))
	for k, v := range body {
		if k == "provider_id" {
			continue
		}
		wire[k] = v
	}
	data, err := json.Marshal(wire)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPut,
		c.baseURL+"/api/models/"+providerID+"/config", bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return c.readError(resp)
	}
	return nil
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestConfigureProvider|TestListProviders"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd workpaw-admin
git add internal/service/pod_config.go internal/service/pod_config_provider_test.go
git commit -m "feat(service): add PodConfigClient.ConfigureProvider + ListProviders"
```

---

### Task 5: 抽取 push 原语,Apply* 复用(行为不变)

**Files:**
- Modify: `workpaw-admin/internal/service/template_apply.go`
- Test: `workpaw-admin/internal/service/template_apply_test.go`(已有,必须仍通过)

**Interfaces:**
- Produces: 包级函数 `pushAgentToPod`、`pushAgentWithCascade`、`pushMCPToPod`、`pushSkillToPod`、`pushProviderToPod`。`ApplyAgent/ApplyMCP/ApplySkill` 改为调用它们。
- Consumes: `PodConfigClient`、`model.*Template`、`*gorm.DB`(cascade 加载子模板)。

- [ ] **Step 1: 写失败测试(新增 push 原语直测)**

在 `internal/service/template_apply_test.go` 末尾追加:

```go
func TestPushAgentToPodCreatesWhenAbsent(t *testing.T) {
	var sawCreate bool
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{})
		case r.Method == http.MethodPost && r.URL.Path == "/api/agents":
			sawCreate = true
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": "a1"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer pod.Close()

	c := NewPodConfigClient(nil, pod.URL, "tok")
	id, err := pushAgentToPod(context.Background(), c, map[string]interface{}{"name": "New"})
	if err != nil || id != "a1" || !sawCreate {
		t.Fatalf("pushAgentToPod create path failed: id=%s err=%v create=%v", id, err, sawCreate)
	}
}

func TestPushAgentToPodUpdatesWhenPresent(t *testing.T) {
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{{"id": "a1", "name": "Dup"}})
		case r.Method == http.MethodPut && r.URL.Path == "/api/agents/a1":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer pod.Close()

	c := NewPodConfigClient(nil, pod.URL, "tok")
	id, err := pushAgentToPod(context.Background(), c, map[string]interface{}{"name": "Dup"})
	if err != nil || id != "a1" {
		t.Fatalf("update path failed: id=%s err=%v", id, err)
	}
}

func TestPushProviderToPodStripsIDAndPuts(t *testing.T) {
	var path string
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.Method + " " + r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer pod.Close()

	c := NewPodConfigClient(nil, pod.URL, "tok")
	if err := pushProviderToPod(context.Background(), c,
		map[string]interface{}{"provider_id": "ds", "api_key": "k"}); err != nil {
		t.Fatal(err)
	}
	if path != "PUT /api/models/ds/config" {
		t.Fatalf("unexpected path: %s", path)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestPushAgentToPod|TestPushProviderToPod"`
Expected: FAIL — `pushAgentToPod` undefined.

- [ ] **Step 3: 抽取 push 原语**

在 `internal/service/template_apply.go` 顶部(`record` 之前)追加:

```go
// pushAgentToPod pushes an agent spec to a Pod. Idempotent by spec.name:
// ListAgents match → Update, else Create. Returns the agent ID.
func pushAgentToPod(ctx context.Context, client *PodConfigClient, spec map[string]interface{}) (string, error) {
	agents, err := client.ListAgents(ctx)
	if err != nil {
		return "", err
	}
	specName, _ := spec["name"].(string)
	for _, a := range agents {
		if a.Name == specName {
			if err := client.UpdateAgent(ctx, a.ID, spec); err != nil {
				return "", err
			}
			return a.ID, nil
		}
	}
	return client.CreateAgent(ctx, spec)
}

// pushAgentWithCascade pushes an agent template AND its linked MCP/Skill
// templates to the Pod. Shared by the synchronous Apply path and the
// ConfigReconciler. NOTE: partial failure is not rolled back (v1 contract — a
// later retry re-pushes everything, idempotent on the Pod side).
func pushAgentWithCascade(ctx context.Context, db *gorm.DB, client *PodConfigClient, tmpl *model.AgentTemplate) (string, error) {
	agentID, err := pushAgentToPod(ctx, client, tmpl.Spec)
	if err != nil {
		return "", err
	}
	for _, mcpID := range tmpl.MCPTemplateIDs {
		var mcp model.MCPTemplate
		if err := db.WithContext(ctx).First(&mcp, "id = ?", mcpID).Error; err != nil {
			return agentID, fmt.Errorf("load mcp template %s: %w", mcpID, err)
		}
		if _, err := pushMCPToPod(ctx, client, mcp.Spec); err != nil {
			return agentID, fmt.Errorf("create mcp %s: %w", mcp.Name, err)
		}
	}
	for _, skillID := range tmpl.SkillTemplateIDs {
		var skill model.SkillTemplate
		if err := db.WithContext(ctx).First(&skill, "id = ?", skillID).Error; err != nil {
			return agentID, fmt.Errorf("load skill template %s: %w", skillID, err)
		}
		if err := pushSkillToPod(ctx, client, skill.Spec); err != nil {
			return agentID, fmt.Errorf("save skill %s: %w", skill.Name, err)
		}
	}
	return agentID, nil
}

// pushMCPToPod creates an MCP client on the Pod (idempotent per Pod side).
func pushMCPToPod(ctx context.Context, client *PodConfigClient, spec map[string]interface{}) (string, error) {
	return client.CreateMCP(ctx, spec)
}

// pushSkillToPod saves a skill on the Pod (idempotent per Pod side).
func pushSkillToPod(ctx context.Context, client *PodConfigClient, spec map[string]interface{}) error {
	return client.SaveSkill(ctx, spec)
}

// pushProviderToPod configures a model provider on the Pod. provider_id is
// pulled from the spec and used as the URL path; the rest is the config body.
func pushProviderToPod(ctx context.Context, client *PodConfigClient, spec map[string]interface{}) error {
	pid, _ := spec["provider_id"].(string)
	if pid == "" {
		return fmt.Errorf("provider template spec missing provider_id")
	}
	return client.ConfigureProvider(ctx, pid, spec)
}
```

- [ ] **Step 4: 改 ApplyAgent 复用 pushAgentWithCascade(行为不变)**

把 `ApplyAgent` 中从 `client := NewPodConfigClient(...)` 到级联 MCP/Skill 结束的那段(原 75–144 行)替换为:

```go
	client := NewPodConfigClient(nil, ingress, token)

	agentID, perr := pushAgentWithCascade(ctx, s.db, client, &tmpl)
	if perr != nil {
		msg := perr.Error()
		row := s.record(ctx, "agent", tid, tmpl.Name, targetUserID, agentID, "failed", msg, appliedBy)
		s.auditFailure(appliedBy, targetUserID, tid, tmpl.Name, msg)
		return row, fmt.Errorf("%w: %s", ErrPodUnreachable, msg)
	}
```

(`spec.name` 空检查保留在 pushAgentToPod 之前——`pushAgentToPod` 内部 ListAgents 后无匹配会走 CreateAgent;若 spec.name 为空,QwenPaw 会拒绝。为保持原有 400 行为,在调用 pushAgentWithCascade 前保留原校验:)

```go
	specName, _ := tmpl.Spec["name"].(string)
	if specName == "" {
		return nil, fmt.Errorf("agent template %s has no spec.name", tmpl.Name)
	}
	client := NewPodConfigClient(nil, ingress, token)
	agentID, perr := pushAgentWithCascade(ctx, s.db, client, &tmpl)
	...
```

把 `ApplyMCP` 中 `client := NewPodConfigClient(...)` 段替换为:

```go
	client := NewPodConfigClient(nil, ingress, token)
	if _, err := pushMCPToPod(ctx, client, tmpl.Spec); err != nil {
		msg := fmt.Sprintf("create mcp: %v", err)
		row := s.record(ctx, "mcp", tid, tmpl.Name, targetUserID, targetAgentID, "failed", msg, appliedBy)
		s.auditFailure(appliedBy, targetUserID, tid, tmpl.Name, msg)
		return row, fmt.Errorf("%w: %s", ErrPodUnreachable, msg)
	}
```

把 `ApplySkill` 中对应段替换为:

```go
	client := NewPodConfigClient(nil, ingress, token)
	if err := pushSkillToPod(ctx, client, tmpl.Spec); err != nil {
		msg := fmt.Sprintf("save skill: %v", err)
		row := s.record(ctx, "skill", tid, tmpl.Name, targetUserID, targetAgentID, "failed", msg, appliedBy)
		s.auditFailure(appliedBy, targetUserID, tid, tmpl.Name, msg)
		return row, fmt.Errorf("%w: %s", ErrPodUnreachable, msg)
	}
```

- [ ] **Step 5: 运行全部 template_apply 测试,确认通过(含原有)**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestApply|TestPush"`
Expected: PASS(原有 `TestApplyAgentSuccess` 等仍绿,新增 push 测试也绿)

- [ ] **Step 6: 提交**

```bash
cd workpaw-admin
git add internal/service/template_apply.go internal/service/template_apply_test.go
git commit -m "refactor(service): extract push primitives, reuse in Apply* (behavior unchanged)"
```

---

### Task 6: ConfigReconciler — materialize + converge + 退避 + 并发

**Files:**
- Create: `workpaw-admin/internal/service/config_reconciler.go`
- Create: `workpaw-admin/internal/service/config_reconciler_test.go`

**Interfaces:**
- Produces: `type ConfigReconciler struct{...}`、`func NewConfigReconciler(db, connector, audit, logger, interval, concurrency) *ConfigReconciler`、`func (r *ConfigReconciler) Run(ctx context.Context)`、`func (r *ConfigReconciler) ReconcileOnce(ctx context.Context) error`(测试用同步入口)。
- Consumes: `InstanceConnector`(ConnectInfo)、`PodLister`(ListInstanceUserIDs + PodUID)、`*gorm.DB`、`*AuditService`、push 原语、`specHash`。

- [ ] **Step 1: 写失败测试(materialize + converge 核心路径)**

```go
// internal/service/config_reconciler_test.go
package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/testutil"
)

// stubPodLister doubles InstanceService for reconcile tests.
type stubPodLister struct {
	users  []string
	uidFor map[string]string // userID -> pod UID
}

func (s *stubPodLister) ListInstanceUserIDs(ctx context.Context) ([]string, error) {
	return s.users, nil
}
func (s *stubPodLister) PodUID(ctx context.Context, userID string) (string, error) {
	return s.uidFor[userID], nil
}

func newReconcilerFixture(t *testing.T) (*ConfigReconciler, *httptest.Server, *int32) {
	t.Helper()
	var calls int32
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{})
		case r.Method == http.MethodPost && r.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": "a1"})
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(pod.Close)

	db := testutil.NewTestDB(t,
		&model.AgentTemplate{}, &model.MCPTemplate{}, &model.SkillTemplate{},
		&model.ProviderTemplate{}, &model.TemplateApply{}, &model.AuditLog{},
		&model.TemplateBinding{}, &model.DesiredConfig{},
	)

	conn := &fakeConnector{ingressURL: pod.URL, apiToken: "tok"}
	lister := &stubPodLister{users: []string{"u1"}, uidFor: map[string]string{"u1": "pod-uid-1"}}

	r := NewConfigReconciler(db, conn, lister, nil, nil, time.Second, 4)
	return r, pod, &calls
}

func TestReconcilePushesWhenStale(t *testing.T) {
	r, _, calls := newReconcilerFixture(t)

	// Seed an agent template + a user-scoped binding.
	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{
		ID: bindID, TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true,
	})

	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatalf("ReconcileOnce: %v", err)
	}

	var dc model.DesiredConfig
	if err := r.db.First(&dc).Error; err != nil {
		t.Fatalf("no DesiredConfig materialized: %v", err)
	}
	if dc.Status != "applied" {
		t.Fatalf("expected applied, got %s (err=%s)", dc.Status, dc.LastError)
	}
	if dc.AppliedPodUID != "pod-uid-1" || dc.AppliedSpecHash == "" {
		t.Fatalf("applied state not recorded: uid=%s hash=%s", dc.AppliedPodUID, dc.AppliedSpecHash)
	}
	if atomic.LoadInt32(calls) == 0 {
		t.Fatal("pod was not called")
	}
}

func TestReconcileSkipsWhenInSync(t *testing.T) {
	r, _, calls := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{
		ID: bindID, TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true,
	})

	// First reconcile: push + record.
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	first := atomic.LoadInt32(calls)

	// Second reconcile: in sync → no new pod calls.
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(calls) != first {
		t.Fatalf("reconcile re-pushed an in-sync config: %d -> %d", first, atomic.LoadInt32(calls))
	}
}

func TestReconcileRepushesOnPodRebuild(t *testing.T) {
	r, _, calls := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	r.db.Create(&model.TemplateBinding{
		ID: uuid.New(), TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true,
	})

	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	first := atomic.LoadInt32(calls)

	// Pod rebuilt → UID changes.
	r.podLister.(*stubPodLister).uidFor["u1"] = "pod-uid-2"
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(calls) == first {
		t.Fatal("reconcile did not re-push after pod rebuild")
	}
}

func TestReconcileRepushesOnTemplateUpdate(t *testing.T) {
	r, _, calls := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	r.db.Create(&model.TemplateBinding{
		ID: uuid.New(), TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true,
	})
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	first := atomic.LoadInt32(calls)

	// Template content changes (Save invokes the JSON serializer; raw
	// Update("spec", map) would bypass it).
	var tmpl model.AgentTemplate
	if err := r.db.First(&tmpl, "id = ?", tmplID).Error; err != nil {
		t.Fatal(err)
	}
	tmpl.Spec = map[string]interface{}{"name": "A", "description": "changed"}
	if err := r.db.Save(&tmpl).Error; err != nil {
		t.Fatal(err)
	}
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(calls) == first {
		t.Fatal("reconcile did not re-push after template update")
	}
}

func TestReconcileBackoffOnFailure(t *testing.T) {
	r, _, _ := newReconcilerFixture(t)
	// Point connector at an unreachable URL to force failure.
	r.connector.(*fakeConnector).ingressURL = "http://127.0.0.1:0" // invalid

	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	r.db.Create(&model.TemplateBinding{
		ID: uuid.New(), TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true,
	})
	if err := r.ReconcileOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	var dc model.DesiredConfig
	r.db.First(&dc)
	if dc.Status != "failed" || dc.RetryCount != 1 || dc.NextRetryAt == nil {
		t.Fatalf("expected failed+backoff, got status=%s retry=%d next=%v", dc.Status, dc.RetryCount, dc.NextRetryAt)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestReconcile`
Expected: FAIL — `ConfigReconciler` undefined.

- [ ] **Step 3: 写实现**

```go
// internal/service/config_reconciler.go
package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"go.uber.org/zap"

	"github.com/workpaw/workpaw-admin/internal/model"
)

// PodLister is the InstanceService surface the reconciler needs: enumerate
// running instances and read a Pod's UID (for rebuild detection).
// *InstanceService satisfies this.
type PodLister interface {
	ListInstanceUserIDs(ctx context.Context) ([]string, error)
	PodUID(ctx context.Context, userID string) (string, error)
}

// ConfigReconciler is the declarative convergence loop. Every tick it
// (1) materializes DesiredConfig rows from enabled TemplateBindings, then
// (2) pushes any stale DesiredConfig to its Pod (content change or rebuild),
// with bounded concurrency and exponential backoff on failure.
type ConfigReconciler struct {
	db          *gorm.DB
	connector   InstanceConnector
	podLister   PodLister
	audit       *AuditService
	logger      *zap.Logger
	interval    time.Duration
	concurrency int
}

func NewConfigReconciler(db *gorm.DB, connector InstanceConnector, podLister PodLister, audit *AuditService, logger *zap.Logger, interval time.Duration, concurrency int) *ConfigReconciler {
	if concurrency < 1 {
		concurrency = 4
	}
	if interval <= 0 {
		interval = 60 * time.Second
	}
	if logger == nil {
		logger = zap.NewNop()
	}
	return &ConfigReconciler{
		db: db, connector: connector, podLister: podLister, audit: audit,
		logger: logger, interval: interval, concurrency: concurrency,
	}
}

// Run blocks until ctx is cancelled, running ReconcileOnce every interval.
func (r *ConfigReconciler) Run(ctx context.Context) {
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		r.ReconcileOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// ReconcileOnce runs one materialize + converge pass. Exposed for tests.
func (r *ConfigReconciler) ReconcileOnce(ctx context.Context) error {
	if err := r.materialize(ctx); err != nil {
		r.logger.Warn("config reconcile: materialize failed", zap.Error(err))
	}
	return r.converge(ctx)
}

// materialize ensures DesiredConfig rows exist for every enabled binding's
// targets, and removes rows whose binding was disabled/deleted.
func (r *ConfigReconciler) materialize(ctx context.Context) error {
	var bindings []model.TemplateBinding
	if err := r.db.WithContext(ctx).Where("enabled = ?", true).Find(&bindings).Error; err != nil {
		return err
	}

	users, err := r.podLister.ListInstanceUserIDs(ctx)
	if err != nil {
		return fmt.Errorf("list instances: %w", err)
	}
	userSet := make(map[string]bool, len(users))
	for _, u := range users {
		userSet[u] = true
	}

	for _, b := range bindings {
		targets := []string{}
		if b.Scope == "all" {
			for u := range userSet {
				targets = append(targets, u)
			}
		} else if b.Scope == "user" && userSet[b.TargetUserID] {
			targets = []string{b.TargetUserID}
		}
		for _, uid := range targets {
			r.ensureDesiredConfig(ctx, b, uid)
		}
	}

	// Drop DesiredConfig rows whose binding is gone or disabled.
	r.db.WithContext(ctx).Where(
		"binding_id NOT IN (?)", r.db.Model(&model.TemplateBinding{}).Where("enabled = ?", true).Select("id"),
	).Delete(&model.DesiredConfig{})
	return nil
}

func (r *ConfigReconciler) ensureDesiredConfig(ctx context.Context, b model.TemplateBinding, userID string) {
	var dc model.DesiredConfig
	err := r.db.WithContext(ctx).Where("binding_id = ? AND target_user_id = ?", b.ID, userID).First(&dc).Error
	if err == nil {
		return // exists
	}
	if err != gorm.ErrRecordNotFound {
		r.logger.Warn("ensureDesiredConfig lookup", zap.Error(err))
		return
	}
	dc = model.DesiredConfig{
		ID: uuid.New(), BindingID: b.ID, TemplateType: b.TemplateType, TemplateID: b.TemplateID,
		TargetUserID: userID, TargetAgentID: b.TargetAgentID, Status: "pending",
	}
	r.db.WithContext(ctx).Create(&dc)
}

// converge pushes stale DesiredConfigs to their Pods with bounded concurrency.
func (r *ConfigReconciler) converge(ctx context.Context) error {
	now := time.Now()
	var dcs []model.DesiredConfig
	// Reconcile: applied-but-stale OR (not-applied AND backoff elapsed).
	r.db.WithContext(ctx).Where(
		"status = ? OR (status != ? AND (next_retry_at IS NULL OR next_retry_at <= ?))",
		"applied", "applied", now,
	).Find(&dcs)

	sem := make(chan struct{}, r.concurrency)
	var wg sync.WaitGroup
	for i := range dcs {
		dc := dcs[i]
		select {
		case <-ctx.Done():
			return ctx.Err()
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			r.convergeOne(ctx, &dc)
		}()
	}
	wg.Wait()
	return nil
}

func (r *ConfigReconciler) convergeOne(ctx context.Context, dc *model.DesiredConfig) {
	// Resolve current template content hash (skip if template deleted).
	currentHash, ok := r.currentSpecHash(ctx, dc)
	if !ok {
		return // template gone; leave as-is (will be cleaned by materialize)
	}

	podUID, err := r.podLister.PodUID(ctx, dc.TargetUserID)
	if err != nil || podUID == "" {
		return // instance stopped / not ready — skip this tick
	}

	// In sync?
	if dc.Status == "applied" && dc.AppliedSpecHash == currentHash && dc.AppliedPodUID == podUID {
		return
	}

	if err := r.push(ctx, dc); err != nil {
		r.markFailed(ctx, dc, err)
		return
	}
	r.markApplied(ctx, dc, currentHash, podUID)
}

// currentSpecHash returns the template's current content fingerprint. For agent
// templates the linked MCP/Skill IDs are included so adding/removing a linked
// child triggers repush. Returns ok=false if the template was deleted.
func (r *ConfigReconciler) currentSpecHash(ctx context.Context, dc *model.DesiredConfig) (string, bool) {
	switch dc.TemplateType {
	case "agent":
		var tmpl model.AgentTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", false
		}
		return specHash(tmpl.Spec, sortedUUIDStrings(tmpl.MCPTemplateIDs), sortedUUIDStrings(tmpl.SkillTemplateIDs)), true
	case "mcp":
		var tmpl model.MCPTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", false
		}
		return specHash(tmpl.Spec), true
	case "skill":
		var tmpl model.SkillTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", false
		}
		return specHash(tmpl.Spec), true
	case "provider":
		var tmpl model.ProviderTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", false
		}
		return specHash(tmpl.Spec), true
	}
	return "", false
}

// push resolves the Pod connection and pushes the template via the shared
// push primitives (no audit/apply row — the reconciler records state in
// desired_configs; admin intent is audited at binding-create time).
func (r *ConfigReconciler) push(ctx context.Context, dc *model.DesiredConfig) error {
	ingress, token, err := r.connector.ConnectInfo(ctx, dc.TargetUserID)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrPodUnreachable, err)
	}
	if token == "" {
		return ErrInstanceNotReady
	}
	client := NewPodConfigClient(nil, ingress, token)

	switch dc.TemplateType {
	case "agent":
		var tmpl model.AgentTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return err
		}
		_, err = pushAgentWithCascade(ctx, r.db, client, &tmpl)
		return err
	case "mcp":
		var tmpl model.MCPTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return err
		}
		_, err = pushMCPToPod(ctx, client, tmpl.Spec)
		return err
	case "skill":
		var tmpl model.SkillTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return err
		}
		return pushSkillToPod(ctx, client, tmpl.Spec)
	case "provider":
		var tmpl model.ProviderTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return err
		}
		return pushProviderToPod(ctx, client, tmpl.Spec)
	}
	return fmt.Errorf("unknown template type %s", dc.TemplateType)
}

func (r *ConfigReconciler) markApplied(ctx context.Context, dc *model.DesiredConfig, hash, podUID string) {
	now := time.Now()
	dc.AppliedSpecHash = hash
	dc.AppliedPodUID = podUID
	dc.Status = "applied"
	dc.LastError = ""
	dc.RetryCount = 0
	dc.NextRetryAt = nil
	dc.LastAppliedAt = &now
	dc.UpdatedAt = now
	r.db.WithContext(ctx).Save(dc)
}

func (r *ConfigReconciler) markFailed(ctx context.Context, dc *model.DesiredConfig, err error) {
	now := time.Now()
	dc.Status = "failed"
	dc.LastError = truncate(err.Error(), 512)
	dc.RetryCount++
	backoff := time.Duration(1<<uint(dc.RetryCount)) * time.Minute // 2,4,8… min
	if backoff > 30*time.Minute {
		backoff = 30 * time.Minute
	}
	next := now.Add(backoff)
	dc.NextRetryAt = &next
	dc.UpdatedAt = now
	r.db.WithContext(ctx).Save(dc)
	r.logger.Warn("config reconcile: push failed",
		zap.String("template_type", dc.TemplateType),
		zap.String("target_user_id", dc.TargetUserID),
		zap.Int("retry", dc.RetryCount), zap.Error(err))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/service/ -run TestReconcile -count=1`
Expected: PASS(5 个测试全绿)

- [ ] **Step 5: 提交**

```bash
cd workpaw-admin
git add internal/service/config_reconciler.go internal/service/config_reconciler_test.go
git commit -m "feat(service): add ConfigReconciler (materialize + converge + backoff)"
```

---

### Task 7: 配置 + 启动 reconciler goroutine

**Files:**
- Modify: `workpaw-admin/internal/config/config.go`
- Modify: `workpaw-admin/internal/router/router.go`

**Interfaces:**
- Produces: `config.ConfigSyncConfig`(`Enabled`/`IntervalSeconds`/`Concurrency`)。
- Consumes: `NewConfigReconciler`、`templateApplySvc`、`instanceSvc`、`auditSvc`。

- [ ] **Step 1: 加配置结构**

在 `config.go` 的 `Config` 结构加字段,并新增类型 + 默认值:

```go
type Config struct {
	Server     ServerConfig     `mapstructure:"server"`
	OIDC       OIDCConfig       `mapstructure:"oidc"`
	JWT        JWTConfig        `mapstructure:"jwt"`
	Kubernetes KubernetesConfig `mapstructure:"kubernetes"`
	Ingress    IngressConfig    `mapstructure:"ingress"`
	Postgres   PostgresConfig   `mapstructure:"postgres"`
	Policy     PolicyConfig     `mapstructure:"policy"`
	ConfigSync ConfigSyncConfig `mapstructure:"config_sync"`
}

// ConfigSyncConfig controls the declarative config reconciler.
type ConfigSyncConfig struct {
	Enabled        bool `mapstructure:"enabled"`
	IntervalSeconds int  `mapstructure:"interval_seconds"`
	Concurrency    int  `mapstructure:"concurrency"`
}
```

在 `Load()` 的 `SetDefault` 段加:

```go
	viper.SetDefault("config_sync.enabled", true)
	viper.SetDefault("config_sync.interval_seconds", 60)
	viper.SetDefault("config_sync.concurrency", 4)
```

- [ ] **Step 2: 在 router.Setup 启动 reconciler**

在 `router.go` 中 `templateApplySvc = service.NewTemplateApplyService(...)`(约 244 行)之后追加:

```go
	// ConfigReconciler: declarative config sync to user Pods. Runs in the
	// background; cancelled when the process exits. Only start when DB + K8s
	// are available (the same prerequisites as templateApplySvc).
	if cfg.ConfigSync.Enabled && gdb != nil && instanceSvc != nil {
		reconciler := service.NewConfigReconciler(
			gdb, instanceSvc, instanceSvc, auditSvc, logger,
			time.Duration(cfg.ConfigSync.IntervalSeconds)*time.Second,
			cfg.ConfigSync.Concurrency,
		)
		go reconciler.Run(context.Background())
		logger.Info("Config reconciler started",
			zap.Int("interval_s", cfg.ConfigSync.IntervalSeconds),
			zap.Int("concurrency", cfg.ConfigSync.Concurrency),
		)
	}
```

(`instanceSvc` 同时满足 `InstanceConnector` 与 `PodLister`,故两处传同一对象。)

确保 `router.go` 顶部 import 含 `"time"`、`"context"`(应已有 context;补 time 若缺)。

- [ ] **Step 3: 构建并冒烟**

Run: `cd workpaw-admin && go build ./...`
Expected: 编译通过。

Run(手动,需 dev Postgres + 集群):`cd workpaw-admin && go run . serve --dev`,观察日志含 `Config reconciler started`。
Expected: 启动日志出现该行;无 panic。

- [ ] **Step 4: 提交**

```bash
cd workpaw-admin
git add internal/config/config.go internal/router/router.go
git commit -m "feat(config): add ConfigSyncConfig; start ConfigReconciler in router.Setup"
```

---

### Task 8: Admin API — bindings CRUD + desired-configs 列表

**Files:**
- Create: `workpaw-admin/internal/service/binding.go`
- Create: `workpaw-admin/internal/handler/admin_binding.go`
- Modify: `workpaw-admin/internal/router/router.go`
- Test: `workpaw-admin/internal/handler/admin_binding_test.go`

**Interfaces:**
- Produces: `service.TemplateBindingService`(`Create`/`List`/`Delete`);`handler.AdminBindingHandler`(`Create`/`List`/`Delete`/`DesiredConfigs`)。
- 路由:`POST/GET /api/admin/bindings`、`DELETE /api/admin/bindings/:id`、`GET /api/admin/desired-configs`。

- [ ] **Step 1: 写失败测试(handler 层,用 testutil DB + gin)**

```go
// internal/handler/admin_binding_test.go
package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/service"
	"github.com/workpaw/workpaw-admin/internal/testutil"
)

func setupBindingRouter(t *testing.T) (*gin.Engine, *service.TemplateBindingService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := testutil.NewTestDB(t, &model.TemplateBinding{}, &model.AuditLog{})
	bs := service.NewTemplateBindingService(db, nil)
	h := NewAdminBindingHandler(bs, db)
	r := gin.New()
	r.POST("/api/admin/bindings", h.Create)
	r.GET("/api/admin/bindings", h.List)
	r.DELETE("/api/admin/bindings/:id", h.Delete)
	r.GET("/api/admin/desired-configs", h.DesiredConfigs)
	return r, bs
}

func TestBindingCreateListDelete(t *testing.T) {
	r, _ := setupBindingRouter(t)

	body, _ := json.Marshal(map[string]interface{}{
		"template_type": "agent", "template_id": "00000000-0000-0000-0000-000000000001",
		"scope": "all",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/admin/bindings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	// List
	req = httptest.NewRequest(http.MethodGet, "/api/admin/bindings", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d", w.Code)
	}
	var list []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("expected 1 binding, got %d", len(list))
	}
	id := list[0]["id"].(string)

	// Delete
	req = httptest.NewRequest(http.MethodDelete, "/api/admin/bindings/"+id, nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestBindingCreateRejectsUnknownType(t *testing.T) {
	r, _ := setupBindingRouter(t)
	body, _ := json.Marshal(map[string]interface{}{
		"template_type": "bogus", "template_id": "00000000-0000-0000-0000-000000000002",
		"scope": "all",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/admin/bindings", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown type, got %d", w.Code)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/handler/ -run TestBinding`
Expected: FAIL — `NewTemplateBindingService` / `NewAdminBindingHandler` undefined.

- [ ] **Step 3: 写 binding service**

```go
// internal/service/binding.go
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-admin/internal/model"
)

// TemplateBindingService manages admin config bindings (the declarative intent
// the ConfigReconciler converges). Creating a binding is the audited write;
// subsequent auto-pushes by the reconciler are not individually audited.
type TemplateBindingService struct {
	db    *gorm.DB
	audit *AuditService
}

func NewTemplateBindingService(db *gorm.DB, audit *AuditService) *TemplateBindingService {
	return &TemplateBindingService{db: db, audit: audit}
}

var validBindingTypes = map[string]bool{"agent": true, "mcp": true, "skill": true, "provider": true}

func (s *TemplateBindingService) Create(ctx context.Context, b *model.TemplateBinding, actor *WorkPawClaims) error {
	if !validBindingTypes[b.TemplateType] {
		return fmt.Errorf("%w: %s", ErrUnknownTemplateType, b.TemplateType)
	}
	if b.Scope != "user" && b.Scope != "all" {
		return errors.New("scope must be 'user' or 'all'")
	}
	if b.Scope == "user" && b.TargetUserID == "" {
		return errors.New("target_user_id required for scope=user")
	}
	if _, err := uuid.Parse(b.TemplateID.String()); err != nil {
		return fmt.Errorf("invalid template_id: %w", err)
	}
	b.ID = uuid.New()
	b.Enabled = true
	if err := s.db.WithContext(ctx).Create(b).Error; err != nil {
		return err
	}
	if s.audit != nil && actor != nil {
		s.audit.Log(actor, AuditEntry{
			Action: "binding.create", TargetType: "template",
			TargetID: b.TemplateID.String(),
			Detail: map[string]interface{}{
				"binding_id": b.ID.String(), "scope": b.Scope,
				"target_user_id": b.TargetUserID, "template_type": b.TemplateType,
			},
		}, "", "", "")
	}
	return nil
}

func (s *TemplateBindingService) List(ctx context.Context) ([]model.TemplateBinding, error) {
	var out []model.TemplateBinding
	err := s.db.WithContext(ctx).Order("created_at DESC").Find(&out).Error
	return out, err
}

func (s *TemplateBindingService) Delete(ctx context.Context, id string, actor *WorkPawClaims) error {
	bid, err := uuid.Parse(id)
	if err != nil {
		return fmt.Errorf("invalid id: %w", err)
	}
	if err := s.db.WithContext(ctx).Delete(&model.TemplateBinding{}, "id = ?", bid).Error; err != nil {
		return err
	}
	// Cascade: drop materialized DesiredConfigs so convergence stops.
	s.db.WithContext(ctx).Where("binding_id = ?", bid).Delete(&model.DesiredConfig{})
	if s.audit != nil && actor != nil {
		s.audit.Log(actor, AuditEntry{
			Action: "binding.delete", TargetType: "binding", TargetID: id,
			Detail: map[string]interface{}{}, // intentionally minimal: reconcile state follows
		}, "", "", "")
	}
	return nil
}
```

- [ ] **Step 4: 写 handler**

```go
// internal/handler/admin_binding.go
package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/service"
)

type AdminBindingHandler struct {
	bindingSvc *service.TemplateBindingService
	db         *gorm.DB
}

func NewAdminBindingHandler(bindingSvc *service.TemplateBindingService, db *gorm.DB) *AdminBindingHandler {
	return &AdminBindingHandler{bindingSvc: bindingSvc, db: db}
}

type bindingRequest struct {
	TemplateType  string `json:"template_type"`
	TemplateID    string `json:"template_id"`
	Scope         string `json:"scope"`
	TargetUserID  string `json:"target_user_id"`
	TargetAgentID string `json:"target_agent_id"`
}

func (h *AdminBindingHandler) Create(c *gin.Context) {
	if h.bindingSvc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "binding service not configured")
		return
	}
	var body bindingRequest
	if err := c.ShouldBindJSON(&body); err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	tid, err := uuid.Parse(body.TemplateID)
	if err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", "invalid template_id")
		return
	}
	b := &model.TemplateBinding{
		TemplateType: body.TemplateType, TemplateID: tid, Scope: body.Scope,
		TargetUserID: body.TargetUserID, TargetAgentID: body.TargetAgentID,
	}
	var actor *service.WorkPawClaims
	if claims := middleware.GetClaims(c); claims != nil {
		actor = claims
	}
	if err := h.bindingSvc.Create(c.Request.Context(), b, actor); err != nil {
		if errors.Is(err, service.ErrUnknownTemplateType) {
			adminError(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		adminError(c, http.StatusInternalServerError, "create_error", err.Error())
		return
	}
	c.JSON(http.StatusCreated, b)
}

func (h *AdminBindingHandler) List(c *gin.Context) {
	if h.bindingSvc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "binding service not configured")
		return
	}
	items, err := h.bindingSvc.List(c.Request.Context())
	if err != nil {
		adminError(c, http.StatusInternalServerError, "list_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *AdminBindingHandler) Delete(c *gin.Context) {
	if h.bindingSvc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "binding service not configured")
		return
	}
	var actor *service.WorkPawClaims
	if claims := middleware.GetClaims(c); claims != nil {
		actor = claims
	}
	if err := h.bindingSvc.Delete(c.Request.Context(), c.Param("id"), actor); err != nil {
		adminError(c, http.StatusBadRequest, "delete_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DesiredConfigs returns the convergence state of every materialized config —
// admin observability for "is this user's pod in sync?".
func (h *AdminBindingHandler) DesiredConfigs(c *gin.Context) {
	var dcs []model.DesiredConfig
	q := h.db.WithContext(c.Request.Context()).Order("updated_at DESC")
	if uid := c.Query("user_id"); uid != "" {
		q = q.Where("target_user_id = ?", uid)
	}
	if err := q.Find(&dcs).Error; err != nil {
		adminError(c, http.StatusInternalServerError, "query_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, dcs)
}
```

> **注意:** handler 取 actor 复用现有 `middleware.GetClaims(c)`(见 `admin_template.go:286`)。`admin_binding.go` 需 import `"github.com/workpaw/workpaw-admin/internal/middleware"`。`adminError` 已在 `handler/admin.go:66` 定义,直接可用。

- [ ] **Step 5: 注册路由**

在 `router.go` 的 admin group 内(`templates` 路由附近)追加:

```go
		// Config bindings (declarative sync intent) + convergence status.
		bindingSvc := service.NewTemplateBindingService(gdb, auditSvc)
		bindH := handler.NewAdminBindingHandler(bindingSvc, gdb)
		adminGroup.POST("/bindings", bindH.Create)
		adminGroup.GET("/bindings", bindH.List)
		adminGroup.DELETE("/bindings/:id", bindH.Delete)
		adminGroup.GET("/desired-configs", bindH.DesiredConfigs)
```

(放在 `if gdb != nil` 块内,确保 `gdb` 非空。)

- [ ] **Step 6: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/handler/ -run TestBinding`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
cd workpaw-admin
git add internal/service/binding.go internal/handler/admin_binding.go internal/handler/admin_binding_test.go internal/router/router.go
git commit -m "feat(admin): add bindings CRUD + desired-configs status endpoints"
```

---

### Task 9: ProviderTemplate 纳入模板 CRUD(ParseTemplateType + TemplateService)

**Files:**
- Modify: `workpaw-admin/internal/service/template.go`(`ParseTemplateType` + 分发)
- Test: `workpaw-admin/internal/service/template_test.go`(若已有则追加用例)

**Interfaces:**
- Produces:`ParseTemplateType` 接受 `provider(s)`;`TemplateService.List/Get/Create/Update/Delete` 覆盖 provider。
- Consumes:`model.ProviderTemplate`。

- [ ] **Step 1: 定位现有 ParseTemplateType**

Run: `cd workpaw-admin && grep -n "func ParseTemplateType\|ErrUnknownTemplateType\|switch" internal/service/template.go | head -20`

- [ ] **Step 2: 写失败测试**

在 `internal/service/template_test.go` 追加(若无该文件则新建,package service,用 testutil.NewTestDB;需 import `context`、`github.com/google/uuid`、`model`、`testutil`):

```go
func TestParseTemplateTypeProvider(t *testing.T) {
	tt, err := ParseTemplateType("providers")
	if err != nil || tt != ProviderTemplateType {
		t.Fatalf("providers -> %v err=%v", tt, err)
	}
}

func TestTemplateServiceProviderCRUD(t *testing.T) {
	db := testutil.NewTestDB(t, &model.ProviderTemplate{})
	svc := NewTemplateService(db)

	spec := map[string]interface{}{"provider_id": "dashscope", "api_key": "k"}
	id, err := svc.Create(context.Background(), ProviderTemplateType, "DS", "d", spec, nil, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if id == uuid.Nil {
		t.Fatal("empty id")
	}

	got, err := svc.List(context.Background(), ProviderTemplateType)
	if err != nil {
		t.Fatal(err)
	}
	rows, ok := got.([]model.ProviderTemplate)
	if !ok || len(rows) != 1 {
		t.Fatalf("list: type=%T len=%d", got, len(rows))
	}
	if rows[0].Name != "DS" {
		t.Fatalf("name: %s", rows[0].Name)
	}
}
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestParseTemplateTypeProvider|TestTemplateServiceProviderCRUD"`
Expected: FAIL — `TemplateTypeProvider` undefined / provider 分支缺失。

- [ ] **Step 4: 实现 provider 分支**

在 `template.go` 常量段(紧挨 `SkillTemplateType` 之后)加:

```go
	ProviderTemplateType TemplateType = "provider"
```

`ParseTemplateType` 的 switch 加:

```go
	case "provider", "providers":
		return ProviderTemplateType, nil
```

`List`(约 :65)、`Get`(:92)、`Create`(:115)、`Update`(:163)、`Delete` 的 `switch t` 各加一个分支,操作 `model.ProviderTemplate`。`Create` 分支示例(签名 `(ctx, t, name, description, spec, mcpIDs, skillIDs, createdBy) (uuid.UUID, error)`,provider 不用 mcpIDs/skillIDs):

```go
	case ProviderTemplateType:
		row := model.ProviderTemplate{
			ID: id, Name: name, Description: description, Spec: spec, CreatedBy: createdBy,
		}
		return id, s.db.WithContext(ctx).Create(&row).Error
```

`List` 分支:`rows := []model.ProviderTemplate{}; ...; return rows, nil`。`Get/Update/Delete` 照搬 `MCPTemplateType` 分支把类型换成 `model.ProviderTemplate`。

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd workpaw-admin && go test ./internal/service/ -run "TestParseTemplateTypeProvider|TestTemplateServiceProviderCRUD"`
Expected: PASS

- [ ] **Step 6: 全量回归 + 提交**

Run: `cd workpaw-admin && go test ./...`
Expected: PASS

```bash
cd workpaw-admin
git add internal/service/template.go internal/service/template_test.go
git commit -m "feat(service): support provider templates in ParseTemplateType + TemplateService"
```

---

## Part B — Operator:infra 热更(StatefulSet 模板漂移 patch)

### Task 10: ensureStatefulSet 对已存在 StatefulSet 做模板 patch

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`
- Test: `workpaw-operator/internal/controller/qwenpawinstance_controller_test.go`(envtest 或对 desiredStatefulSet 的纯函数测)

**Interfaces:**
- Produces:`func (r *QwenPawInstanceReconciler) desiredStatefulSet(instance, username) (*appsv1.StatefulSet, error)`(抽取现有构造),`ensureStatefulSet` 已存在分支改为比较并 patch `Spec.Template`(镜像/resources/env CORS)。
- Consumes:现有 `r.Config`、`controllerutil`、`resource`、`intstr`。

- [ ] **Step 1: 写失败测试(纯函数:desiredStatefulSet 含 CORS env + image)**

```go
// internal/controller/qwenpawinstance_controller_test.go
package controller

import (
	"testing"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func newReconcilerForTest(t *testing.T, cors string) *QwenPawInstanceReconciler {
	t.Helper()
	scheme := runtime.NewScheme()
	_ = workpawv1alpha1.AddToScheme(scheme)
	cl := fake.NewClientBuilder().WithScheme(scheme).Build()
	return &QwenPawInstanceReconciler{
		Client: cl, Scheme: scheme,
		Config: &Config{BaseDomain: "qwenpaw.workpaw.internal", CORSOrigins: cors},
	}
}

func TestDesiredStatefulSetInjectsCORSAndImage(t *testing.T) {
	r := newReconcilerForTest(t, "http://localhost:5173")
	inst := &workpawv1alpha1.QwenPawInstance{
		ObjectMeta: metav1.ObjectMeta{Name: "alice", Namespace: "workpaw-instances"},
		Spec: workpawv1alpha1.QwenPawInstanceSpec{Image: "agentscope/qwenpaw:v1.1.12", DesiredState: "Running"},
	}
	sts, err := r.desiredStatefulSet(inst, "alice")
	if err != nil {
		t.Fatal(err)
	}
	c := sts.Spec.Template.Spec.Containers[0]
	if c.Image != "agentscope/qwenpaw:v1.1.12" {
		t.Fatalf("image: %s", c.Image)
	}
	foundCORS := false
	for _, e := range c.Env {
		if e.Name == "QWENPAW_CORS_ORIGINS" && e.Value == "http://localhost:5173" {
			foundCORS = true
		}
	}
	if !foundCORS {
		t.Fatal("CORS env not injected")
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd workpaw-operator && go test ./internal/controller/ -run TestDesiredStatefulSet`
Expected: FAIL — `desiredStatefulSet` undefined。

- [ ] **Step 3: 抽取 desiredStatefulSet**

把 `ensureStatefulSet` 中从 `labels := labelsForInstance(username)` 到 `return r.Create(ctx, sts)` 之前的整段 StatefulSet 构造(含 CORS append)抽到新方法:

```go
// desiredStatefulSet builds the StatefulSet the operator wants to exist for
// this instance. Shared by the create path and the drift-patch path so both
// use identical template construction.
func (r *QwenPawInstanceReconciler) desiredStatefulSet(instance *workpawv1alpha1.QwenPawInstance, username string) (*appsv1.StatefulSet, error) {
	// ... (move the existing construction body here verbatim, including the
	// CORS env append block at the end, but WITHOUT the r.Create call) ...
	// Keep controllerutil.SetControllerReference here too.
	return sts, nil
}
```

(把现有 300–442 行的构造体搬进此方法;`ensureStatefulSet` 改为调用它。)

- [ ] **Step 4: 改 ensureStatefulSet 已存在分支做 patch**

替换 `ensureStatefulSet` 已存在分支(原"only syncs replicas then return")为:

```go
	existing := &appsv1.StatefulSet{}
	if err := r.Get(ctx, stsKey, existing); err == nil {
		// Already exists — scale to 1 if needed, then patch the pod template
		// if it drifted (image / resources / env incl. CORS). A template patch
		// triggers a rolling update, giving infra config hot-reload without
		// deleting the StatefulSet (the old manual workaround).
		var one int32 = 1
		replicasChanged := existing.Spec.Replicas == nil || *existing.Spec.Replicas != one

		desired, err := r.desiredStatefulSet(instance, username)
		if err != nil {
			return err
		}
		templateDrifted := !podTemplateEqual(&existing.Spec.Template, &desired.Spec.Template)

		if !replicasChanged && !templateDrifted {
			return nil
		}
		if replicasChanged {
			existing.Spec.Replicas = &one
		}
		if templateDrifted {
			existing.Spec.Template = desired.Spec.Template
			log.Info("Patching StatefulSet template (infra drift)", "statefulset", stsName)
		}
		if err := r.Update(ctx, existing); err != nil {
			return err
		}
		return nil
	} else if !errors.IsNotFound(err) {
		return err
	}

	// Not found — create.
	desired, err := r.desiredStatefulSet(instance, username)
	if err != nil {
		return err
	}
	log.Info("Creating StatefulSet", "statefulset", stsName)
	return r.Create(ctx, desired)
}

// podTemplateEqual reports whether two pod templates are equivalent for the
// fields we reconcile (image, resources, env). We compare by JSON marshalling
// the container slice for simplicity and stability.
func podTemplateEqual(a, b *corev1.PodTemplateSpec) bool {
	if len(a.Spec.Containers) != len(b.Spec.Containers) {
		return false
	}
	for i := range a.Spec.Containers {
		ca, _ := json.Marshal(a.Spec.Containers[i])
		cb, _ := json.Marshal(b.Spec.Containers[i])
		if string(ca) != string(cb) {
			return false
		}
	}
	return true
}
```

> 这把 CORS 变为可热更新:改 operator `WORKPAW_OPERATOR_CORS_ORIGINS` env 后重启 operator,下次 reconcile 对每个已存在 StatefulSet 的 env 漂移做 patch → 滚动更新,不再需要手动删 StatefulSet。(operator `Config.CORSOrigins` 仍在启动时 `os.Getenv` 读一次——若要完全不重启 operator 即生效,需要 operator watch 一个 ConfigMap,属后续增强,本任务不纳入。)

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd workpaw-operator && go test ./internal/controller/ -run TestDesiredStatefulSet`
Expected: PASS

Run(回归):`cd workpaw-operator && go test ./...`
Expected: PASS

- [ ] **Step 6: 重新生成 manifests(若 RBAC/CRD 未变可跳过)**

Run: `cd workpaw-operator && make manifests`
Expected: 无 diff(本任务不改 CRD/RBAC)。

- [ ] **Step 7: 提交**

```bash
cd workpaw-operator
git add internal/controller/qwenpawinstance_controller.go internal/controller/qwenpawinstance_controller_test.go
git commit -m "feat(operator): patch StatefulSet template on drift (infra hot-update)"
```

---

## 验证清单(整体回归)

- [ ] `cd workpaw-admin && go test ./...` 全绿。
- [ ] `cd workpaw-operator && go test ./...` 全绿。
- [ ] 手动(dev 集群):
  1. admin console 创建一个 agent 模板 → POST `/api/admin/bindings` `{template_type:"agent", template_id, scope:"all"}`。
  2. 等一个 reconcile 间隔 → GET `/api/admin/desired-configs?user_id=<u>` 看到 `status:"applied"`。
  3. `kubectl delete pod qwenpaw-<user>-0`(模拟重建)→ 等下一个 tick → desired-configs 的 `applied_pod_uid` 更新、Pod 上 agent 仍在(重建恢复)。
  4. 更新模板 spec → 下一个 tick 自动重推(desired-configs 的 `applied_spec_hash` 更新)。
  5. 改 operator `WORKPAW_OPERATOR_CORS_ORIGINS` + 重启 operator → StatefulSet 滚动更新(无需手动删)。
- [ ] admin console 前端(console/)为 bindings / desired-configs 增加页面与 adminApi.ts 类型(参考现有 templates 页面结构;JSON tag 以 adminApi.ts 为准)。

## 风险与取舍

- **provider api_key 明文存库**:`ProviderTemplate.Spec` 含 `api_key`。生产前应像 `OIDCConfig.ClientSecretEnc` 一样 AES-GCM 加密落库(复用现有加密工具)。本计划 Task 1 模型先不加密,**上线前必须补加密**(单独任务)。
- **scope=all 扇出风暴**:大量实例时一次 reconcile 并发推送受 `config_sync.concurrency` 限制(默认 4),不会打爆,但首播可能较慢;可调大并发或分批。
- **binding 删除不回收 Pod 配置**:v1 不从 Pod 删除已推 agent/mcp/skill(QwenPaw v1.1.12 无干净删除 API)。文档与 UI 需明示。
- **agent 级联 MCP/Skill 的独立更新**:agent 的 `currentSpecHash` 含 linked ID,但不含 linked 模板**内容**。单独更新一个 linked MCP 模板内容,若该 MCP 没有自己的 binding,不会触发 agent 重推。建议:需要热更的 linked 子模板也单独建 binding(Task 9 之后的运营规范)。
- **operator CORS 仍需重启 operator 生效**:本计划把"重启后无需删 StatefulSet"修好,但"改 env 不重启即生效"需要 ConfigMap watch,列为后续。
- **Pod UID 检测依赖 `qwenpaw-{name}-0` 命名**:StatefulSet 保证该名稳定;若未来改 Pod 拓扑需同步改 `PodUID`。

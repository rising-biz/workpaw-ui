# Binding 删除回收 Pod 配置 (Config-Sync Reclaim)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 删除/禁用 binding 时,把已推送到各用户 Pod 的配置(agent/mcp/skill)回收(DELETE),而非只停掉收敛。已确认 QwenPaw v1.1.12 支持 DELETE(`/api/agents/{agentId}`、`/api/mcp/{client_key}`、`/api/skills/{skill_name}`)。

**Architecture:** 在 `PodConfigClient` 加 Delete 方法 + 带状态码的 `PodAPIError`;在 `ConfigReconciler` 加 `reclaim` 阶段——对 orphan DesiredConfig(binding 已删/禁用)按类型调 Pod DELETE,2xx/4xx 容错删行,5xx/网络错误保留行+退避重试;provider 不回收(删 provider 有破坏性);实例不在(PodUID 空)或模板已删 → 直接删行。reconcile 循环:materialize(种子)→ reclaim(回收 orphan)→ converge(推送 enabled)。converge 只处理 enabled-binding 的行,reclaim 只处理 orphan 行,互不交叉。

**Tech Stack:** Go(Gin/Zap/Viper/Cobra + GORM);control-plane only。

## Global Constraints
- QwenPaw v1.1.12 黑盒;复用现有 `PodConfigClient` Bearer 认证 + `readError` 模式。
- 已确认 v1.1.12 DELETE 端点:`DELETE /api/agents/{agentId}`(404 不存在 / 400 default / 200)、`DELETE /api/mcp/{client_key:path}`(404 / 200)、`DELETE /api/skills/{skill_name}`(409 不可删 / 200)。
- 回收 best-effort:2xx 与 4xx(404/400/409)→ 视为已回收,删 DesiredConfig 行;5xx 或网络错误 → 保留行 + 指数退避重试。
- **provider 不回收**(删 custom provider 有破坏性风险)→ orphan provider 行直接删,不调 Pod。
- 实例不存在(PodUID "")或模板已删(拿不到 spec.name/client_key)→ 直接删行,不调 Pod。
- 不要破坏已合并的 reconciler(bindings/push/encryption/CORS)/非回收路径行为。
- 测试用 testutil.NewTestDB(内存 SQLite)+ httptest Pod mock + fakeConnector。
- JSON tag snake_case。

---

## Task 13: Binding 删除回收 (control-plane)

**Files:**
- Modify: `internal/service/pod_config.go`(新增 `PodAPIError` + `DeleteAgent`/`DeleteMCP`/`DeleteSkill`)
- Modify: `internal/service/config_reconciler.go`(`reclaim` 阶段;`materialize` 去掉 orphan 硬删;`converge` 限定 enabled-binding;`reclaimOne`/`deleteAgentByName`/`reclaimKeys`/`tolerable`/`markReclaimFailed` helper)
- Modify: `internal/service/config_reconciler_test.go`(回收用例)
- Create: `internal/service/pod_config_delete_test.go`(Delete 方法用例)

**Interfaces:**
- Consumes: 现有 `PodConfigClient.ListAgents`、`InstanceConnector`、`PodLister`、`specHash`、`model.DesiredConfig`/`TemplateBinding`。
- Produces: `PodAPIError{StatusCode int; Body string}`(实现 error);`(*PodConfigClient).DeleteAgent/DeleteMCP/DeleteSkill`;`(*ConfigReconciler).reclaim(ctx)`/`reclaimOne`。

### Steps

- [ ] **Step 1: 写失败测试 — PodConfigClient Delete 方法**

`internal/service/pod_config_delete_test.go`(package service):
```go
package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteAgent(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Method + " " + r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	c := NewPodConfigClient(nil, srv.URL, "tok")
	if err := c.DeleteAgent(context.Background(), "a1"); err != nil {
		t.Fatalf("DeleteAgent: %v", err)
	}
	if got != "DELETE /api/agents/a1" { t.Fatalf("got %s", got) }
}

func TestDeleteMethodsReturnPodAPIErrorOn4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict) // 409
		w.Write([]byte(`{"detail":"not deletable"}`))
	}))
	defer srv.Close()
	c := NewPodConfigClient(nil, srv.URL, "tok")
	err := c.DeleteSkill(context.Background(), "s1")
	if err == nil { t.Fatal("expected error") }
	var pe *PodAPIError
	if !errors.As(err, &pe) || pe.StatusCode != 409 {
		t.Fatalf("expected PodAPIError 409, got %v", err)
	}
}
```
(确保 import `errors`。)

- [ ] **Step 2: 运行确认失败** — `cd workpaw-control-plane && go test ./internal/service/ -run "TestDeleteAgent|TestDeleteMethodsReturnPodAPIErrorOn4xx"` → FAIL(`DeleteAgent`/`PodAPIError` 未定义)。

- [ ] **Step 3: 实现 — pod_config.go Delete 方法 + PodAPIError**

```go
// PodAPIError wraps a non-2xx Pod config API response with its status code,
// so callers (e.g. the reclaim path) can classify 4xx (tolerable) vs 5xx (retry).
type PodAPIError struct {
	StatusCode int
	Body       string
}

func (e *PodAPIError) Error() string {
	return fmt.Sprintf("pod config API returned %d: %s", e.StatusCode, e.Body)
}

// apiError reads the response body and returns a *PodAPIError.
func (c *PodConfigClient) apiError(resp *http.Response) *PodAPIError {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return &PodAPIError{StatusCode: resp.StatusCode, Body: string(body)}
}

// DeleteAgent calls DELETE /api/agents/:agentID.
func (c *PodConfigClient) DeleteAgent(ctx context.Context, agentID string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/api/agents/"+agentID, nil)
	if err != nil { return fmt.Errorf("build request: %w", err) }
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	resp, err := c.httpClient.Do(req)
	if err != nil { return fmt.Errorf("do request: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return c.apiError(resp) }
	return nil
}

// DeleteMCP calls DELETE /api/mcp/:clientKey.
func (c *PodConfigClient) DeleteMCP(ctx context.Context, clientKey string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/api/mcp/"+clientKey, nil)
	if err != nil { return fmt.Errorf("build request: %w", err) }
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	resp, err := c.httpClient.Do(req)
	if err != nil { return fmt.Errorf("do request: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return c.apiError(resp) }
	return nil
}

// DeleteSkill calls DELETE /api/skills/:skillName.
func (c *PodConfigClient) DeleteSkill(ctx context.Context, skillName string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/api/skills/"+skillName, nil)
	if err != nil { return fmt.Errorf("build request: %w", err) }
	req.Header.Set("Authorization", "Bearer "+c.apiToken)
	resp, err := c.httpClient.Do(req)
	if err != nil { return fmt.Errorf("do request: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return c.apiError(resp) }
	return nil
}
```
(现有方法仍用 `readError`,不改;Delete 方法用新的 `apiError` 返回 `*PodAPIError`。)

- [ ] **Step 4: 运行确认通过** — `go test ./internal/service/ -run "TestDeleteAgent|TestDeleteMethodsReturnPodAPIErrorOn4xx"` → PASS。

- [ ] **Step 5: 写失败测试 — reconciler 回收**

在 `config_reconciler_test.go` 追加(复用 `newReconcilerFixture` 风格,但需要能注入 binding + 制造 orphan):
```go
func TestReclaimDeletesPodConfigOnBindingGone(t *testing.T) {
	// fixture: agent template + binding (enabled) seeded; first reconcile pushes.
	r, pod, calls := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }
	first := atomic.LoadInt32(calls)

	// Disable the binding → DesiredConfig becomes orphan → reclaim must DELETE on Pod.
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	// Pod mock: handle DELETE /api/agents (ListAgents returns the agent so deleteAgentByName finds it).
	pod.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		atomic.AddInt32(calls, 1)
		switch {
		case req.Method == http.MethodGet && req.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{{"id": "a1", "name": "A"}})
		case req.Method == http.MethodDelete && req.URL.Path == "/api/agents/a1":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }
	if atomic.LoadInt32(calls) == first { t.Fatal("reclaim did not call the Pod") }
	// orphan DesiredConfig row removed.
	var n int64
	r.db.Model(&model.DesiredConfig{}).Where("binding_id = ?", bindID).Count(&n)
	if n != 0 { t.Fatalf("orphan DesiredConfig not removed: %d", n) }
}

func TestReclaimTolerates4xx(t *testing.T) {
	r, _, _ := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.SkillTemplate{ID: tmplID, Name: "S", Spec: map[string]interface{}{"name": "S"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "skill", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	r.ReconcileOnce(context.Background()) // push (skill save ok)
	// Point connector at a pod that returns 409 on skill DELETE.
	r.connector.(*fakeConnector).ingressURL = stub409SkillPod(t)
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	r.ReconcileOnce(context.Background())
	var n int64
	r.db.Model(&model.DesiredConfig{}).Where("binding_id = ?", bindID).Count(&n)
	if n != 0 { t.Fatalf("4xx should be tolerated and row removed: %d", n) }
}

func TestReclaimRetriesOn5xx(t *testing.T) {
	r, _, _ := newReconcilerFixture(t)
	tmplID := uuid.New()
	r.db.Create(&model.SkillTemplate{ID: tmplID, Name: "S", Spec: map[string]interface{}{"name": "S"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "skill", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	r.ReconcileOnce(context.Background())
	r.connector.(*fakeConnector).ingressURL = stub500SkillPod(t)
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	r.ReconcileOnce(context.Background())
	var dc model.DesiredConfig
	r.db.Where("binding_id = ?", bindID).First(&dc)
	if dc.Status != "reclaim_failed" || dc.NextRetryAt == nil {
		t.Fatalf("5xx should keep row + backoff: status=%s next=%v", dc.Status, dc.NextRetryAt)
	}
}

func TestReclaimSkipsProvider(t *testing.T) {
	r, pod, calls := newReconcilerFixture(t)
	pid := uuid.New()
	r.db.Create(&model.ProviderTemplate{ID: pid, Name: "P", Spec: map[string]interface{}{"provider_id": "ds"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "provider", TemplateID: pid,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	r.ReconcileOnce(context.Background()) // push provider (PUT config ok)
	before := atomic.LoadInt32(calls)
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	r.ReconcileOnce(context.Background())
	if atomic.LoadInt32(calls) != before { t.Fatal("provider reclaim must NOT call the Pod") }
	var n int64
	r.db.Model(&model.DesiredConfig{}).Where("binding_id = ?", bindID).Count(&n)
	if n != 0 { t.Fatalf("provider orphan row should be removed: %d", n) }
	_ = pod
}
```
(`stub409SkillPod`/`stub500SkillPod` 是测试辅助:返回 409/500 的 httptest server,处理 `/api/skills/save` PUT + `/api/skills/S` DELETE。可在测试文件内定义。)

- [ ] **Step 6: 运行确认失败** — `go test ./internal/service/ -run TestReclaim` → FAIL(`reclaim` 未实现 / orphan 仍被 materialize 硬删)。

- [ ] **Step 7: 实现 — config_reconciler.go reclaim 阶段**

(a) `materialize`:**删除**末尾的 orphan 硬删块(`r.db.Where("binding_id NOT IN (...)").Delete(&model.DesiredConfig{})`)——回收改由 reclaim 负责。

(b) `ReconcileOnce`:在 materialize 之后、converge 之前加 `r.reclaim(ctx)`:
```go
func (r *ConfigReconciler) ReconcileOnce(ctx context.Context) error {
	if err := r.materialize(ctx); err != nil {
		r.logger.Warn("config reconcile: materialize failed", zap.Error(err))
	}
	if err := r.reclaim(ctx); err != nil {
		r.logger.Warn("config reconcile: reclaim failed", zap.Error(err))
	}
	return r.converge(ctx)
}
```

(c) `converge`:查询限定 enabled-binding(避免对 orphan 行推送):
```go
r.db.WithContext(ctx).Where("binding_id IN (?)",
	r.db.Model(&model.TemplateBinding{}).Where("enabled = ?", true).Select("id"),
).Where(
	"status = ? OR (status != ? AND (next_retry_at IS NULL OR next_retry_at <= ?))",
	"applied", "applied", now,
).Find(&dcs)
```

(d) 新增 reclaim:
```go
func (r *ConfigReconciler) reclaim(ctx context.Context) error {
	now := time.Now()
	var orphans []model.DesiredConfig
	r.db.WithContext(ctx).Where("binding_id NOT IN (?)",
		r.db.Model(&model.TemplateBinding{}).Where("enabled = ?", true).Select("id"),
	).Where("next_retry_at IS NULL OR next_retry_at <= ?", now).Find(&orphans)

	sem := make(chan struct{}, r.concurrency)
	var wg sync.WaitGroup
	for i := range orphans {
		o := orphans[i]
		select {
		case <-ctx.Done():
			wg.Wait()
			return ctx.Err()
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func() { defer wg.Done(); defer func() { <-sem }(); r.reclaimOne(ctx, &o) }()
	}
	wg.Wait()
	return nil
}

func (r *ConfigReconciler) reclaimOne(ctx context.Context, dc *model.DesiredConfig) {
	podUID, err := r.podLister.PodUID(ctx, dc.TargetUserID)
	if err != nil || podUID == "" {
		r.db.WithContext(ctx).Delete(dc); return // instance gone
	}
	if dc.TemplateType == "provider" {
		r.db.WithContext(ctx).Delete(dc); return // provider reclaim skipped
	}
	name, clientKey, ok := r.reclaimKeys(ctx, dc)
	if !ok {
		r.db.WithContext(ctx).Delete(dc); return // template gone
	}
	ingress, token, err := r.connector.ConnectInfo(ctx, dc.TargetUserID)
	if err != nil || token == "" {
		r.markReclaimFailed(ctx, dc, err); return
	}
	client := NewPodConfigClient(nil, ingress, token)
	var derr error
	switch dc.TemplateType {
	case "agent":
		derr = r.deleteAgentByName(ctx, client, name)
	case "mcp":
		if clientKey == "" { r.db.WithContext(ctx).Delete(dc); return }
		derr = client.DeleteMCP(ctx, clientKey)
	case "skill":
		if name == "" { r.db.WithContext(ctx).Delete(dc); return }
		derr = client.DeleteSkill(ctx, name)
	}
	if derr == nil || tolerableReclaimErr(derr) {
		r.db.WithContext(ctx).Delete(dc); return
	}
	r.markReclaimFailed(ctx, dc, derr)
}

// reclaimKeys returns (agent/skill spec.name, mcp spec.client_key, ok). ok=false
// when the template was deleted (can't reclaim — give up).
func (r *ConfigReconciler) reclaimKeys(ctx context.Context, dc *model.DesiredConfig) (string, string, bool) {
	switch dc.TemplateType {
	case "agent":
		var t model.AgentTemplate
		if err := r.db.WithContext(ctx).First(&t, "id = ?", dc.TemplateID).Error; err != nil { return "", "", false }
		n, _ := t.Spec["name"].(string); return n, "", true
	case "mcp":
		var t model.MCPTemplate
		if err := r.db.WithContext(ctx).First(&t, "id = ?", dc.TemplateID).Error; err != nil { return "", "", false }
		k, _ := t.Spec["client_key"].(string); return "", k, true
	case "skill":
		var t model.SkillTemplate
		if err := r.db.WithContext(ctx).First(&t, "id = ?", dc.TemplateID).Error; err != nil { return "", "", false }
		n, _ := t.Spec["name"].(string); return n, "", true
	}
	return "", "", true
}

func (r *ConfigReconciler) deleteAgentByName(ctx context.Context, client *PodConfigClient, name string) error {
	if name == "" { return nil }
	agents, err := client.ListAgents(ctx)
	if err != nil { return err }
	for _, a := range agents {
		if a.Name == name { return client.DeleteAgent(ctx, a.ID) }
	}
	return nil // not found → already gone
}

// tolerableReclaimErr: 4xx (404/400/409) → already gone / not deletable → tolerate.
func tolerableReclaimErr(err error) bool {
	var pe *PodAPIError
	return errors.As(err, &pe) && pe.StatusCode >= 400 && pe.StatusCode < 500
}

func (r *ConfigReconciler) markReclaimFailed(ctx context.Context, dc *model.DesiredConfig, err error) {
	now := time.Now()
	dc.Status = "reclaim_failed"
	if err != nil { dc.LastError = truncate(err.Error(), 512) }
	dc.RetryCount++
	backoff := time.Duration(1<<uint(dc.RetryCount)) * time.Minute
	if backoff > 30*time.Minute { backoff = 30 * time.Minute }
	next := now.Add(backoff)
	dc.NextRetryAt = &next
	dc.UpdatedAt = now
	r.db.WithContext(ctx).Save(dc)
}
```
(确保 import `errors`、`sync`、`time`。)

- [ ] **Step 8: 运行确认通过** — `go test ./internal/service/ -run "TestReclaim"` → PASS(4 个回收用例)。再跑全 service 套件确认无回归(`TestReconcile*` 仍绿)。

- [ ] **Step 9: 全量回归 + gofmt + 提交** — `go test ./...`(预存 router 失败无关)+ `gofmt -w` 改动文件 + commit `feat: reclaim Pod config on binding delete/disable (agent/mcp/skill; provider skipped)`。

---

## 验证清单
- [ ] `cd workpaw-control-plane && go test ./...` 绿(预存 router 失败无关)。
- [ ] 手动:admin 建 agent binding(scope=user)→ reconcile 推送 → DELETE binding → 下个 reconcile 周期 Pod 上 `DELETE /api/agents/{id}` 被调用、agent 消失、DesiredConfig 行删除。
- [ ] 手动:skill binding 删除,Pod 上 skill 不可删(409)时 DesiredConfig 行仍删除(容忍)。
- [ ] 手动:Pod 不可达时 orphan 行标 `reclaim_failed` + 退避,Pod 恢复后下个周期回收成功删行。
- [ ] provider binding 删除:不调 Pod,直接删行(不破坏 provider)。

## 设计取舍
- **回收在 reconciler 后台做**(非 admin handler 同步):admin DELETE binding 立即返回(只删 binding 行);reconciler 下个周期回收。好处:不阻塞 admin、天然并发限流 + 退避重试。代价:回收有最长一个 interval(默认 60s)延迟。
- **provider 不回收**:删 custom provider 可能误删用户仍用的 provider;选择只停推不回收。如未来要回收,需区分"模板创建的 custom provider"与"用户既有 provider"。
- **agent 回收需 ListAgents 找 id**(DesiredConfig 不存 Pod 侧 agent id):多一次 GET,可接受。未来可在 markApplied 存 `AppliedResourceID` 省去 ListAgents。
- **模板已删 → 放弃回收**(拿不到 spec.name/client_key):orphan 行直接删。如需回收已删模板的配置,需在 binding 删前快照 spec(未来增强)。

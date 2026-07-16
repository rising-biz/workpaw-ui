# Reclaim 优化:AppliedResourceID + 日志 (Reclaim Polish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 优化 binding 回收:apply 时把 Pod 侧资源 ID(agent id / mcp client_key / skill name)存入 `DesiredConfig.AppliedResourceID`,回收时直接用它调 DELETE —— 省掉 agent 回收的额外 `ListAgents` GET,且**模板被删后仍能回收**(当前会因拿不到 spec 而放弃)。同时给回收的边界分支加日志。

**Architecture:** `push()` 改为返回 `(resourceID, error)`;`markApplied` 收 resourceID 并写入 `dc.AppliedResourceID`;`reclaimOne` 优先用 `dc.AppliedResourceID` 直接 DELETE(agent 直删、mcp/skill 直删),仅在 AppliedResourceID 为空(旧行/从未 apply 成功)时回退到 `reclaimKeys`(模板加载)+ `deleteAgentByName`(ListAgents)。各边界分支(provider 跳过 / 实例不在 / 模板已删 / 空 ID / 未知类型 / 容错 4xx)加 `r.logger` 日志。

**Tech Stack:** Go(Gin/Zap/Viper/Cobra + GORM);control-plane only。

## Global Constraints
- 不要破坏已合并的 reclaim/converge/materialize/encryption 行为;旧 DesiredConfig 行(AppliedResourceID 为空)回退到原回收路径,兼容。
- `AppliedResourceID` 对 agent = Pod 侧 agent id;对 mcp = client_key;对 skill = spec.name;provider 不回收(留空)。
- 回收仍 best-effort:2xx/4xx 容错删行,5xx/网络保留+退避。
- 测试用 testutil.NewTestDB + httptest + fakeConnector。
- JSON tag snake_case。

---

## Task 14: AppliedResourceID + 回收日志 (control-plane)

**Files:**
- Modify: `internal/model/model.go`(`DesiredConfig` 加 `AppliedResourceID`)
- Modify: `internal/service/config_reconciler.go`(`push` 返回 resourceID;`markApplied` 收 resourceID;`convergeOne` 传 resourceID;`reclaimOne` 优先用 AppliedResourceID + 日志)
- Modify: `internal/service/config_reconciler_test.go`(新用例:AppliedResourceID 直删 / 模板删后仍回收 / markApplied 存 ID)

**Interfaces:**
- Consumes: 现有 `pushAgentWithCascade`(返回 agentID)、`pushMCPToPod`(返回 client_key)、`pushSkillToPod`、`pushProviderToPod`、`reclaimKeys`、`deleteAgentByName`、`tolerableReclaimErr`。
- Produces: `DesiredConfig.AppliedResourceID`;`push(ctx, dc) (string, error)`;`markApplied(ctx, dc, hash, podUID, resourceID)`;重写 `reclaimOne`。

### Steps

- [ ] **Step 1: 写失败测试**

在 `config_reconciler_test.go` 追加:
```go
func TestReclaimUsesAppliedResourceIDForAgent(t *testing.T) {
	r, _, calls := newReconcilerFixture(t)
	// Pod mock: POST /api/agents returns id "a1"; track GET /api/agents (ListAgents).
	var sawList bool
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		atomic.AddInt32(calls, 1)
		switch {
		case req.Method == http.MethodGet && req.URL.Path == "/api/agents":
			sawList = true
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]string{})
		case req.Method == http.MethodPost && req.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": "a1"})
		case req.Method == http.MethodDelete && req.URL.Path == "/api/agents/a1":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(pod.Close)
	r.connector.(*fakeConnector).ingressURL = pod.URL

	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }

	var dc model.DesiredConfig
	r.db.Where("binding_id = ?", bindID).First(&dc)
	if dc.AppliedResourceID != "a1" { t.Fatalf("AppliedResourceID = %q, want a1", dc.AppliedResourceID) }

	sawList = false
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }
	if sawList { t.Fatal("reclaim must DELETE directly by AppliedResourceID, NOT ListAgents") }
}

func TestReclaimWorksAfterTemplateDeleted(t *testing.T) {
	r, _, _ := newReconcilerFixture(t)
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch {
		case req.Method == http.MethodPost && req.URL.Path == "/api/agents":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"id": "a1"})
		case req.Method == http.MethodDelete && req.URL.Path == "/api/agents/a1":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(pod.Close)
	r.connector.(*fakeConnector).ingressURL = pod.URL

	tmplID := uuid.New()
	r.db.Create(&model.AgentTemplate{ID: tmplID, Name: "A", Spec: map[string]interface{}{"name": "A"}})
	bindID := uuid.New()
	r.db.Create(&model.TemplateBinding{ID: bindID, TemplateType: "agent", TemplateID: tmplID,
		Scope: "user", TargetUserID: "u1", Enabled: true})
	r.ReconcileOnce(context.Background()) // push → AppliedResourceID="a1"

	// Delete the template, then disable the binding → reclaim must still work via AppliedResourceID.
	r.db.Delete(&model.AgentTemplate{}, "id = ?", tmplID)
	r.db.Model(&model.TemplateBinding{}).Where("id = ?", bindID).Update("enabled", false)
	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }
	var n int64
	r.db.Model(&model.DesiredConfig{}).Where("binding_id = ?", bindID).Count(&n)
	if n != 0 { t.Fatalf("reclaim should remove row even after template deleted: %d", n) }
}
```

- [ ] **Step 2: 运行确认失败** — `cd workpaw-admin && go test ./internal/service/ -run "TestReclaimUsesAppliedResourceIDForAgent|TestReclaimWorksAfterTemplateDeleted"` → FAIL(`AppliedResourceID` 字段不存在 / `push` 返回值不符)。

- [ ] **Step 3: 实现 — model 字段**

`internal/model/model.go` `DesiredConfig` 增加(放在 `AppliedPodUID` 附近):
```go
	AppliedResourceID string    `gorm:"column:applied_resource_id" json:"applied_resource_id"` // Pod-side id (agent id / mcp client_key / skill name); used to reclaim directly
```

- [ ] **Step 4: 实现 — push 返回 resourceID + markApplied 收 resourceID + convergeOne 传值**

`push` 签名改为 `(string, error)`,各分支返回 resourceID:
```go
func (r *ConfigReconciler) push(ctx context.Context, dc *model.DesiredConfig) (string, error) {
	ingress, token, err := r.connector.ConnectInfo(ctx, dc.TargetUserID)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrPodUnreachable, err)
	}
	if token == "" {
		return "", ErrInstanceNotReady
	}
	client := NewPodConfigClient(nil, ingress, token)
	switch dc.TemplateType {
	case "agent":
		var tmpl model.AgentTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", err
		}
		return pushAgentWithCascade(ctx, r.db, client, &tmpl)
	case "mcp":
		var tmpl model.MCPTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", err
		}
		return pushMCPToPod(ctx, client, tmpl.Spec)
	case "skill":
		var tmpl model.SkillTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", err
		}
		name, _ := tmpl.Spec["name"].(string)
		return name, pushSkillToPod(ctx, client, tmpl.Spec)
	case "provider":
		var tmpl model.ProviderTemplate
		if err := r.db.WithContext(ctx).First(&tmpl, "id = ?", dc.TemplateID).Error; err != nil {
			return "", err
		}
		if tmpl.APIKeyEnc != "" {
			if r.crypto == nil {
				return "", errors.New("crypto unavailable: cannot decrypt provider api_key")
			}
			plain, err := r.crypto.Decrypt(tmpl.APIKeyEnc)
			if err != nil {
				return "", fmt.Errorf("decrypt provider api_key: %w", err)
			}
			spec := copySpec(tmpl.Spec)
			spec["api_key"] = plain
			return "", pushProviderToPod(ctx, client, spec)
		}
		return "", pushProviderToPod(ctx, client, tmpl.Spec)
	}
	return "", fmt.Errorf("unknown template type %s", dc.TemplateType)
}
```

`convergeOne` 调用处:
```go
	resourceID, err := r.push(ctx, dc)
	if err != nil {
		r.markFailed(ctx, dc, err)
		return
	}
	r.markApplied(ctx, dc, currentHash, podUID, resourceID)
```

`markApplied` 加 resourceID 参数 + 写入:
```go
func (r *ConfigReconciler) markApplied(ctx context.Context, dc *model.DesiredConfig, hash, podUID, resourceID string) {
	now := time.Now()
	dc.AppliedSpecHash = hash
	dc.AppliedPodUID = podUID
	dc.AppliedResourceID = resourceID
	dc.Status = "applied"
	dc.LastError = ""
	dc.RetryCount = 0
	dc.NextRetryAt = nil
	dc.LastAppliedAt = &now
	dc.UpdatedAt = now
	r.db.WithContext(ctx).Save(dc)
}
```

- [ ] **Step 5: 实现 — reclaimOne 优先用 AppliedResourceID + 日志**

替换 `reclaimOne`:
```go
func (r *ConfigReconciler) reclaimOne(ctx context.Context, dc *model.DesiredConfig) {
	podUID, err := r.podLister.PodUID(ctx, dc.TargetUserID)
	if err != nil || podUID == "" {
		r.logger.Info("reclaim: instance gone, removing row",
			zap.String("target_user_id", dc.TargetUserID), zap.String("type", dc.TemplateType))
		r.db.WithContext(ctx).Delete(dc)
		return
	}
	if dc.TemplateType == "provider" {
		r.logger.Info("reclaim: provider skipped (destructive), removing row", zap.String("target_user_id", dc.TargetUserID))
		r.db.WithContext(ctx).Delete(dc)
		return
	}

	// Prefer the stored Pod-side resource ID (lets us reclaim directly, without
	// loading the template — so reclaim still works after the template is deleted).
	resourceID := dc.AppliedResourceID
	if resourceID == "" {
		// Old row (pre-AppliedResourceID) or never applied: fall back to template load.
		name, clientKey, ok := r.reclaimKeys(ctx, dc)
		if !ok {
			r.logger.Info("reclaim: template gone and no resource ID, removing row",
				zap.String("template_id", dc.TemplateID.String()))
			r.db.WithContext(ctx).Delete(dc)
			return
		}
		switch dc.TemplateType {
		case "agent", "skill":
			resourceID = name
		case "mcp":
			resourceID = clientKey
		}
	}

	ingress, token, err := r.connector.ConnectInfo(ctx, dc.TargetUserID)
	if err != nil || token == "" {
		r.markReclaimFailed(ctx, dc, err)
		return
	}
	client := NewPodConfigClient(nil, ingress, token)

	var derr error
	switch dc.TemplateType {
	case "agent":
		if dc.AppliedResourceID != "" {
			derr = client.DeleteAgent(ctx, dc.AppliedResourceID) // direct, no ListAgents
		} else {
			derr = r.deleteAgentByName(ctx, client, resourceID) // fallback: ListAgents match by name
		}
	case "mcp":
		if resourceID == "" {
			r.logger.Info("reclaim: empty mcp client_key, removing row", zap.String("target_user_id", dc.TargetUserID))
			r.db.WithContext(ctx).Delete(dc)
			return
		}
		derr = client.DeleteMCP(ctx, resourceID)
	case "skill":
		if resourceID == "" {
			r.logger.Info("reclaim: empty skill name, removing row", zap.String("target_user_id", dc.TargetUserID))
			r.db.WithContext(ctx).Delete(dc)
			return
		}
		derr = client.DeleteSkill(ctx, resourceID)
	default:
		r.logger.Warn("reclaim: unknown template type, removing row", zap.String("type", dc.TemplateType))
		r.db.WithContext(ctx).Delete(dc)
		return
	}

	if derr == nil || tolerableReclaimErr(derr) {
		if derr != nil {
			r.logger.Info("reclaim: tolerable error, removing row", zap.Error(derr))
		}
		r.db.WithContext(ctx).Delete(dc)
		return
	}
	r.markReclaimFailed(ctx, dc, derr)
}
```
(`reclaimKeys`、`deleteAgentByName`、`tolerableReclaimErr`、`markReclaimFailed` 保持不变,作为回退路径。)

- [ ] **Step 6: 运行确认通过** — `go test ./internal/service/ -run "TestReclaim"` → 全部 PASS(新 2 个 + 原 4 个回收 + 5 个 converge)。再跑全 service 套件确认无回归。

- [ ] **Step 7: 全量回归 + gofmt + 提交** — `go test ./...`(预存 router 失败无关)+ `gofmt -w` + commit `feat: store AppliedResourceID for direct reclaim + reclaim logging`。

---

## 验证清单
- [ ] `cd workpaw-admin && go test ./...` 绿(预存 router 失败无关)。
- [ ] 新测试:agent 回收**不调** ListAgents(直接 DELETE by id);模板删除后回收仍成功。
- [ ] 旧行兼容:AppliedResourceID 为空的行回退到 reclaimKeys+deleteAgentByName(原路径)。
- [ ] 回收各边界分支有日志(provider 跳过 / 实例不在 / 模板已删 / 空 ID / 未知类型 / 容错 4xx)。

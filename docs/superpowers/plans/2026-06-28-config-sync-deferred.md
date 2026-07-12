# 配置同步延后项实现计划 (Config-Sync Deferred Items)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 实现两个延后项 —— (A) provider `api_key` AES-GCM 静态加密;(B) operator CORS 热更新(ConfigMap watch,免重启)。第三项(删除 binding 回收 Pod 配置)因 QwenPaw v1.1.12 无 DELETE 端点而**阻塞**,本计划不含。

**Architecture:** (A) 复用现有 `CryptoService`(OIDC client_secret 同款 AES-256-GCM):`ProviderTemplate` 增加 `APIKeyEnc`(json:"-")落库,Create/Update 抽取 api_key 加密、Spec 不再含明文;Get/List 返回 masked `api_key`;reconciler push 时解密注入 Spec 再推 Pod。(B) operator `desiredStatefulSet` 改为接收 `corsOrigins` 参数,`r.corsOrigins(ctx)` 从指定 ConfigMap 读取(失败回退 env);`SetupWithManager` watch 该 ConfigMap,变更时 enqueue 全部 QwenPawInstance → 漂移 patch → 滚动更新。

**Tech Stack:** Go(Gin/Zap/Viper/Cobra + GORM);operator(Kubebuilder/controller-runtime);CryptoService(AES-256-GCM, key=WORKPAW_DB_SECRET_KEY)。

## Global Constraints

- QwenPaw v1.1.12 黑盒;唯一配置面 Pod HTTP API;不得引入 file-watch/sidecar/init-container。
- 复用现有 `service.CryptoService`(`Encrypt`/`Decrypt`,base64(nonce||ct||tag)),**不得**新造加密实现。
- `WORKPAW_DB_SECRET_KEY` 未设置时 `CryptoService` 为 ephemeral(重启失效);provider 加密路径在 `cryptoSvc == nil` 时返回 503(与 OIDC 一致)。
- JSON tag 一律 snake_case;`APIKeyEnc` 永不序列化(`json:"-"`);masked `api_key` 字段匹配 QwenPaw 契约(已配置 `"sk-******"`,未配置 `""`)。
- 测试用 `testutil.NewTestDB`(内存 SQLite)+ httptest;operator 用 `controller-runtime/pkg/client/fake`。
- 不要破坏已合并的 config-sync-reconcile 行为(reconciler / bindings / push 原语 / operator 漂移 patch)。
- operator ConfigMap RBAC 已有(`resources=configmaps,get;list;watch;...`),无需新增 RBAC。

---

## Task 11: Provider api_key AES-GCM 静态加密 (control-plane)

**Files:**
- Modify: `workpaw-control-plane/internal/model/model.go`(`ProviderTemplate` 加字段 + 改注释)
- Modify: `workpaw-control-plane/internal/service/template.go`(`NewTemplateService` 加 crypto;provider Create/Update 加密、Get/List masked)
- Modify: `workpaw-control-plane/internal/service/config_reconciler.go`(provider push 解密注入)
- Modify: `workpaw-control-plane/internal/router/router.go`(注入 cryptoSvc 到 TemplateService + ConfigReconciler)
- Modify: `workpaw-control-plane/internal/service/template_test.go`(provider 加密用例)
- Modify: `workpaw-control-plane/internal/service/config_reconciler_test.go`(provider push 解密用例)

**Interfaces:**
- Consumes: `service.CryptoService`(`Encrypt(string)(string,error)` / `Decrypt(string)(string,error)`),现有 `pushProviderToPod`。
- Produces: `NewTemplateService(db *gorm.DB, crypto *CryptoService)`(签名变更,新增 crypto 参数,可 nil);`NewConfigReconciler(..., crypto *CryptoService, ...)`(新增 crypto 参数);`ProviderTemplate.APIKeyEnc`/`APIKeyMasked` 字段。

### 设计要点
- `ProviderTemplate`:
  - `APIKeyEnc string \`json:"-" gorm:"column:api_key_enc"\`` —— 密文,永不序列化。
  - `APIKeyMasked string \`json:"api_key" gorm:"-"\`` —— 响应专用 masked 值,DB 不持久化。
  - 持久化的 `Spec` **不含** `api_key`。
- Create/Update(provider):输入 Spec 含 `api_key`(明文)→ `spec["api_key"]` 取出 → `crypto.Encrypt` → `APIKeyEnc`;从 Spec 删除 `api_key` 后落库。`crypto == nil` → 返回错误(handler 映射 503)。
- Get/List(provider):返回前,`APIKeyEnc != ""` → `APIKeyMasked = "sk-******"`,否则 `""`;确保 `APIKeyEnc` 为零值(防泄漏,虽 json:"-" 已挡)。
- Reconciler push(provider):加载模板 → 若 `APIKeyEnc != ""`,`crypto.Decrypt` → 明文 api_key → 注入到 Spec **副本**(不修改 DB 行)的 `api_key` 键 → `pushProviderToPod`(它 strip provider_id 后把 api_key 一并发给 QwenPaw)。`crypto == nil` 且 `APIKeyEnc != ""` → 返回错误(markFailed)。
- 路由:`NewTemplateService(gdb, cryptoSvc)`、`NewConfigReconciler(db, connector, podLister, audit, logger, interval, concurrency, cryptoSvc)`。cryptoSvc 可能为 nil(OIDC 也如此)。

### Steps
- [ ] **Step 1: 写失败测试 — provider Create 加密 + Get masked**

在 `template_test.go` 追加(用真实 `CryptoService`,envKey 用 32 字节固定串):

```go
func TestProviderTemplateAPIKeyEncryption(t *testing.T) {
	db := testutil.NewTestDB(t, &model.ProviderTemplate{})
	crypto, err := NewCryptoService(strings.Repeat("k", 32)) // 32-byte key
	if err != nil { t.Fatal(err) }
	svc := NewTemplateService(db, crypto)

	id, err := svc.Create(context.Background(), ProviderTemplateType, "DS", "d",
		map[string]interface{}{"provider_id": "dashscope", "api_key": "sk-real-123", "base_url": "https://x"},
		nil, nil, "")
	if err != nil { t.Fatal(err) }

	var row model.ProviderTemplate
	db.First(&row, "id = ?", id)
	if row.APIKeyEnc == "" { t.Fatal("APIKeyEnc not set") }
	if _, ok := row.Spec["api_key"]; ok { t.Fatal("api_key must be stripped from persisted Spec") }
	if row.APIKeyEnc == "sk-real-123" { t.Fatal("APIKeyEnc must be ciphertext, not plaintext") }

	// Get returns masked api_key, never the ciphertext.
	got, err := svc.Get(context.Background(), ProviderTemplateType, id)
	if err != nil { t.Fatal(err) }
	pt := got.(*model.ProviderTemplate)
	if pt.APIKeyEnc != "" { t.Fatal("APIKeyEnc leaked into Get response") }
	if pt.APIKeyMasked != "sk-******" { t.Fatalf("masked api_key = %q, want sk-******", pt.APIKeyMasked) }
	if _, ok := pt.Spec["api_key"]; ok { t.Fatal("api_key must not be in response Spec") }
}

func TestProviderTemplateAPIKeyMaskedEmptyWhenUnset(t *testing.T) {
	db := testutil.NewTestDB(t, &model.ProviderTemplate{})
	crypto, _ := NewCryptoService(strings.Repeat("k", 32))
	svc := NewTemplateService(db, crypto)
	id, _ := svc.Create(context.Background(), ProviderTemplateType, "DS", "d",
		map[string]interface{}{"provider_id": "dashscope"}, nil, nil, "")
	got, _ := svc.Get(context.Background(), ProviderTemplateType, id)
	pt := got.(*model.ProviderTemplate)
	if pt.APIKeyMasked != "" { t.Fatalf("want empty mask, got %q", pt.APIKeyMasked) }
}

func TestProviderTemplateCreateNoCryptoIsError(t *testing.T) {
	db := testutil.NewTestDB(t, &model.ProviderTemplate{})
	svc := NewTemplateService(db, nil) // no crypto
	_, err := svc.Create(context.Background(), ProviderTemplateType, "DS", "d",
		map[string]interface{}{"provider_id": "dashscope", "api_key": "sk-x"}, nil, nil, "")
	if err == nil { t.Fatal("expected error when crypto is nil and api_key provided") }
}
```

- [ ] **Step 2: 运行确认失败** — `cd workpaw-control-plane && go test ./internal/service/ -run TestProviderTemplate` → FAIL(`NewTemplateService` 签名不符 / APIKeyEnc 不存在)。

- [ ] **Step 3: 实现 — model + template.go**

`model.go` `ProviderTemplate` 增加:
```go
type ProviderTemplate struct {
	ID            uuid.UUID              `gorm:"type:uuid;primaryKey" json:"id"`
	Name          string                 `json:"name"`
	Description   string                 `json:"description"`
	Spec          map[string]interface{} `gorm:"serializer:json" json:"spec"` // NO api_key (stored encrypted in APIKeyEnc)
	APIKeyEnc     string                 `gorm:"column:api_key_enc" json:"-"`  // AES-GCM ciphertext; never serialized
	APIKeyMasked  string                 `gorm:"-" json:"api_key"`             // response-only: "sk-******" or ""
	CreatedBy     string                 `json:"created_by"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	DeletedAt     gorm.DeletedAt         `gorm:"index" json:"-"`
}
```
(更新该结构体 doc-comment:api_key 现以 AES-GCM 加密存于 APIKeyEnc,Spec 不含明文。)

`template.go`:
- `TemplateService` 加字段 `crypto *CryptoService`;`NewTemplateService(db *gorm.DB, crypto *CryptoService)`。
- provider Create 分支:调用 `encryptProviderAPIKey(s.crypto, &spec)` → 写 `APIKeyEnc`;row.Spec = spec(已 strip api_key)。
- provider Update 分支:若 fields 含 `spec` 且 spec 含 `api_key`,同上加密写 APIKeyEnc + strip;若 spec 不含 api_key 则保留原 APIKeyEnc(不覆盖)。
- provider Get/List 分支:返回前 `maskProviderAPIKey(row, s.crypto)`(只设 APIKeyMasked、清 APIKeyEnc)。
- 新增包级 helper:
```go
// encryptProviderAPIKey extracts spec["api_key"], encrypts it into apiKeyEnc,
// and removes api_key from spec. Returns error if crypto is nil and api_key present.
func encryptProviderAPIKey(crypto *CryptoService, spec map[string]interface{}) (string, error) {
	raw, ok := spec["api_key"]
	if !ok { return "", nil } // no api_key in this write; caller keeps existing enc
	apiKey, _ := raw.(string)
	if apiKey == "" { return "", nil }
	if crypto == nil { return "", errors.New("crypto service unavailable: cannot encrypt provider api_key") }
	enc, err := crypto.Encrypt(apiKey)
	if err != nil { return "", fmt.Errorf("encrypt api_key: %w", err) }
	delete(spec, "api_key")
	return enc, nil
}

// maskProviderAPIKey sets APIKeyMasked from APIKeyEnc presence and zeroes APIKeyEnc.
func maskProviderAPIKey(pt *model.ProviderTemplate) {
	if pt.APIKeyEnc != "" { pt.APIKeyMasked = "sk-******" }
	pt.APIKeyEnc = ""
}
```

- [ ] **Step 4: 运行确认通过** — `go test ./internal/service/ -run TestProviderTemplate` → PASS。

- [ ] **Step 5: 写失败测试 — reconciler provider push 解密注入**

在 `config_reconciler_test.go` 追加(复用 fixture 风格,加 crypto):
```go
func TestReconcileProviderPushDecryptsAPIKey(t *testing.T) {
	crypto, _ := NewCryptoService(strings.Repeat("k", 32))
	enc, _ := crypto.Encrypt("sk-real-456")

	db := testutil.NewTestDB(t, &model.ProviderTemplate{}, &model.TemplateBinding{}, &model.DesiredConfig{})
	pid := uuid.New()
	db.Create(&model.ProviderTemplate{ID: pid, Name: "DS",
		Spec: map[string]interface{}{"provider_id": "dashscope", "base_url": "https://x"}, APIKeyEnc: enc})

	var sentBody string
	pod := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/api/models/dashscope/config") {
			b, _ := io.ReadAll(r.Body); sentBody = string(b)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer pod.Close()

	conn := &fakeConnector{ingressURL: pod.URL, apiToken: "tok"}
	lister := &stubPodLister{users: []string{"u1"}, uidFor: map[string]string{"u1": "uid-1"}}
	r := NewConfigReconciler(db, conn, lister, nil, nil, time.Second, 4, crypto)
	db.Create(&model.TemplateBinding{ID: uuid.New(), TemplateType: "provider", TemplateID: pid,
		Scope: "user", TargetUserID: "u1", Enabled: true})

	if err := r.ReconcileOnce(context.Background()); err != nil { t.Fatal(err) }
	if !strings.Contains(sentBody, "sk-real-456") { t.Fatalf("decrypted api_key not sent: %s", sentBody) }
	if strings.Contains(sentBody, "provider_id") { t.Fatal("provider_id should be stripped before send") }
	if strings.Contains(sentBody, "sk-******") { t.Fatal("masked value sent instead of real key") }
}
```

- [ ] **Step 6: 运行确认失败** — `go test ./internal/service/ -run TestReconcileProviderPushDecryptsAPIKey` → FAIL(`NewConfigReconciler` 签名不符)。

- [ ] **Step 7: 实现 — config_reconciler.go + router.go**

`config_reconciler.go`:
- `ConfigReconciler` 加字段 `crypto *CryptoService`;`NewConfigReconciler(..., crypto *CryptoService)`(末位新增参数)。
- `push()` 的 `case "provider"`:加载 `model.ProviderTemplate` 后,若 `tmpl.APIKeyEnc != ""`:`if r.crypto == nil { return errors.New("crypto unavailable: cannot decrypt provider api_key") }`;`plain, err := r.crypto.Decrypt(tmpl.APIKeyEnc)`;`spec := copySpec(tmpl.Spec); spec["api_key"] = plain`;`return pushProviderToPod(ctx, client, spec)`。若 `APIKeyEnc == ""`,直接 `pushProviderToPod(ctx, client, tmpl.Spec)`。
- 新增 `copySpec`:
```go
func copySpec(in map[string]interface{}) map[string]interface{} {
	out := make(map[string]interface{}, len(in))
	for k, v := range in { out[k] = v }
	return out
}
```

`router.go`:`templateSvc = service.NewTemplateService(gdb, cryptoSvc)`(原 `NewTemplateService(gdb)` 改);`NewConfigReconciler(gdb, instanceSvc, instanceSvc, auditSvc, logger, interval, concurrency, cryptoSvc)`。注意 `cryptoSvc` 可能为 nil —— provider 路径会据此返回 503/failed,其它类型不受影响。

- [ ] **Step 8: 全量回归 + gofmt + 提交** — `go test ./...`(预存 router 失败无关)+ `gofmt -w` 改动文件 + commit `feat: encrypt provider api_key at rest (AES-GCM, reuse CryptoService)`。

---

## Task 12: Operator CORS 热更新 (ConfigMap watch)

**Files:**
- Modify: `workpaw-operator/internal/controller/qwenpawinstance_controller.go`(`Config` 加字段;`corsOrigins(ctx)`;`desiredStatefulSet` 加参数;`SetupWithManager` watch)
- Modify: `workpaw-operator/cmd/main.go`(`DefaultConfig` 已读 env;如需传 configmap 名 via env,在此补)
- Modify: `workpaw-operator/internal/controller/desiredstatefulset_test.go`(corsOrigins 读取 + fallback 用例)

**Interfaces:**
- Consumes: 现有 `desiredStatefulSet`、`ensureStatefulSet`、`r.Config`。
- Produces: `func (r *QwenPawInstanceReconciler) corsOrigins(ctx context.Context) string`;`desiredStatefulSet(instance, username, corsOrigins string)`(签名加参数);`SetupWithManager` 增加 ConfigMap watch。

### 设计要点
- `Config` 增加字段:`CORSConfigMapName`(default `"workpaw-operator-config"`)、`CORSConfigMapNamespace`(default `"workpaw-instances"` —— operator 已有该 ns 的 configmaps RBAC)、`CORSConfigMapKey`(default `"corsOrigins"`)。`CORSOrigins`(env)保留为 fallback。
- `corsOrigins(ctx)`:GET ConfigMap `{CORSConfigMapNamespace}/{CORSConfigMapName}`;若存在且 `data[CORSConfigMapKey]` 非空 → 返回该值;否则返回 `r.Config.CORSOrigins`(env fallback)。GET 失败/未找到 → env fallback(不报错,保证可用性)。
- `desiredStatefulSet(instance, username, corsOrigins)`:把当前直接读 `r.Config.CORSOrigins` 改为用传入的 `corsOrigins` 参数。两处调用点(create 分支 + drift 分支)传 `r.corsOrigins(ctx)`。
- `SetupWithManager`:增加 `.Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(func(ctx, cm) []reconcile.Request { 仅当 cm 是 CORS configmap 时,list 全部 QwenPawInstance 并 enqueue;否则返回 nil }))`。
- 无共享可变状态:`corsOrigins(ctx)` 每次读取(无缓存/无锁),ConfigMap GET 廉价;reconciler 串行触发,无竞争。

### Steps
- [ ] **Step 1: 写失败测试 — corsOrigins 从 ConfigMap 读 + fallback**

在 `desiredstatefulset_test.go` 追加(用 fake client):
```go
func TestCORSOriginsFromConfigMap(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = workpawv1alpha1.AddToScheme(scheme)
	_ = corev1.AddToScheme(scheme)
	cl := fake.NewClientBuilder().WithScheme(scheme).WithObjects(
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "workpaw-operator-config", Namespace: "workpaw-instances"},
			Data: map[string]string{"corsOrigins": "http://a,http://b"}},
	).Build()
	r := &QwenPawInstanceReconciler{Client: cl, Config: &Config{
		BaseDomain: "qwenpaw.workpaw.internal", CORSOrigins: "http://fallback",
		CORSConfigMapName: "workpaw-operator-config", CORSConfigMapNamespace: "workpaw-instances", CORSConfigMapKey: "corsOrigins",
	}}
	if got := r.corsOrigins(context.Background()); got != "http://a,http://b" {
		t.Fatalf("got %q, want configmap value", got)
	}
}

func TestCORSOriginsFallbackToEnv(t *testing.T) {
	scheme := runtime.NewScheme()
	_ = workpawv1alpha1.AddToScheme(scheme)
	_ = corev1.AddToScheme(scheme)
	cl := fake.NewClientBuilder().WithScheme(scheme).Build() // no configmap
	r := &QwenPawInstanceReconciler{Client: cl, Config: &Config{
		BaseDomain: "qwenpaw.workpaw.internal", CORSOrigins: "http://fallback",
		CORSConfigMapName: "workpaw-operator-config", CORSConfigMapNamespace: "workpaw-instances", CORSConfigMapKey: "corsOrigins",
	}}
	if got := r.corsOrigins(context.Background()); got != "http://fallback" {
		t.Fatalf("got %q, want env fallback", got)
	}
}
```

- [ ] **Step 2: 运行确认失败** — `cd workpaw-operator && go test ./internal/controller/ -run TestCORSOrigins` → FAIL(`corsOrigins` 未定义)。

- [ ] **Step 3: 实现 — Config 字段 + corsOrigins + desiredStatefulSet 参数**

`Config` 增加:
```go
	// CORSConfigMapName/Namespace/Key: a ConfigMap the operator watches so CORS
	// origins can change without an operator restart. Empty/fallback → CORSOrigins (env).
	CORSConfigMapName      string
	CORSConfigMapNamespace string
	CORSConfigMapKey       string
```
`DefaultConfig()` 增加默认值:
```go
		CORSConfigMapName:      "workpaw-operator-config",
		CORSConfigMapNamespace: "workpaw-instances",
		CORSConfigMapKey:       "corsOrigins",
```
(可从 env `WORKPAW_OPERATOR_CORS_CONFIGMAP` / `WORKPAW_OPERATOR_CORS_CONFIGMAP_NS` 覆盖,可选。)

`corsOrigins`:
```go
func (r *QwenPawInstanceReconciler) corsOrigins(ctx context.Context) string {
	if r.Config.CORSConfigMapName != "" && r.Config.CORSConfigMapNamespace != "" {
		cm := &corev1.ConfigMap{}
		if err := r.Get(ctx, types.NamespacedName{Name: r.Config.CORSConfigMapName, Namespace: r.Config.CORSConfigMapNamespace}, cm); err == nil {
			if v := cm.Data[r.Config.CORSConfigMapKey]; v != "" {
				return v
			}
		}
	}
	return r.Config.CORSOrigins // env fallback
}
```

`desiredStatefulSet` 签名改为 `(instance *workpawv1alpha1.QwenPawInstance, username, corsOrigins string)`,内部 `if corsOrigins != ""` 替代 `if r.Config.CORSOrigins != ""`。`ensureStatefulSet` 两处调用改为 `r.desiredStatefulSet(instance, username, r.corsOrigins(ctx))`。

- [ ] **Step 4: 运行确认通过** — `go test ./internal/controller/ -run "TestCORSOrigins|TestDesiredStatefulSet"` → PASS。

- [ ] **Step 5: 实现 — SetupWithManager watch**

```go
func (r *QwenPawInstanceReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&workpawv1alpha1.QwenPawInstance{}).
		Watches(&corev1.ConfigMap{}, handler.EnqueueRequestsFromMapFunc(func(ctx context.Context, obj client.Object) []reconcile.Request {
			cm, ok := obj.(*corev1.ConfigMap)
			if !ok || cm.Name != r.Config.CORSConfigMapName || cm.Namespace != r.Config.CORSConfigMapNamespace {
				return nil
			}
			list := &workpawv1alpha1.QwenPawInstanceList{}
			if err := r.List(ctx, list); err != nil { return nil }
			reqs := make([]reconcile.Request, 0, len(list.Items))
			for i := range list.Items {
				reqs = append(reqs, reconcile.Request{NamespacedName: client.ObjectKeyFromObject(&list.Items[i])})
			}
			return reqs
		})).
		Named("qwenpawinstance").
		Complete(r)
}
```
需 import:`corev1`、`sigs.k8s.io/controller-runtime/pkg/handler`、`sigs.k8s.io/controller-runtime/pkg/reconcile`。

- [ ] **Step 6: go build + go vet + 回归 + gofmt + 提交** — `go build ./... && go vet ./... && go test ./internal/controller/ -run "TestCORSOrigins|TestDesiredStatefulSet|TestPodTemplateEqual"`(envTest BeforeSuite 预存失败无关)+ `gofmt -w` + commit `feat(operator): hot-reload CORS via ConfigMap watch (no restart)`。

---

## 验证清单
- [ ] `cd workpaw-control-plane && go test ./...` 绿(预存 router 失败无关)。
- [ ] `cd workpaw-operator && go test ./internal/controller/ -run "TestCORSOrigins|TestDesiredStatefulSet|TestPodTemplateEqual"` 绿。
- [ ] 手动:admin 创建 provider 模板带 api_key → DB `provider_templates.api_key_enc` 非空、`spec` 无明文;Get 返回 `api_key:"sk-******"`;Pod 上 `/api/models/:id/config` 收到真实 key。
- [ ] 手动:改 `workpaw-operator-config` ConfigMap 的 `corsOrigins` → 下个 reconcile 各 StatefulSet 滚动更新(无需重启 operator)。

## 阻塞项(不在本计划)
- **删除 binding 回收 Pod 配置**:QwenPaw v1.1.12 无 DELETE /api/agents/:id、/api/mcp、/api/skills 端点(`PodConfigClient` 仅 GET/POST/PUT;桌面端删除置灰且注明 "v1.1.12 不支持")。需 QwenPaw 升级或确认隐藏 DELETE 端点后再做。

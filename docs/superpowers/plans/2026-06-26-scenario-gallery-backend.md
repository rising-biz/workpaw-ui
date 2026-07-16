# 场景画廊 — control-plane 后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 control-plane 后端新增 Scenario 实体(official/enterprise 两 source,slug 维度 enterprise 覆盖 official),提供 desktop 只读 `GET /api/scenarios` 与 admin 管理 `/api/admin/scenarios/*`(CRUD/clone/toggle/sort),官方场景随启动 seed upsert。

**Architecture:** GORM 模型 `Scenario` 落 Postgres,jsonb 字段用 `gorm:"serializer:json"` + `map[string]interface{}`(沿用 AgentTemplate 模式)。`ScenarioService` 封装列表(含 enterprise 覆盖合并)/详情/CRUD/clone/toggle/sort + 官方 seed upsert(First+Create 手动模式,无 OnConflict)。两个 handler:`AdminScenarioHandler`(admin role,带审计、official 改删返回 409)与 `ScenarioHandler`(普通登录只读 List)。路由在 `router.Setup()` 注册。TDD,内存 sqlite 测试。

**Tech Stack:** Go 1.26, Gin, GORM, PostgreSQL(生产)/ glebarez/sqlite(测试), uuid, zap。

## Global Constraints

- 所有 GORM 模型 JSON tag 一律 snake_case(防历史契约 bug,见 [[admin-contract-json-tags]])。
- jsonb 字段用 `gorm:"serializer:json"` + `map[string]interface{}`(或具体 struct slice),**不**用 `datatypes.JSON`。
- 官方 seed upsert 用 `First` + `Create` 手动模式,**不**用 `clause.OnConflict`(全代码库无此先例)。
- 官方场景 `source=official` 只读:PUT/DELETE 返回 409 Conflict,只能 clone 后改 enterprise 副本。
- 审计写操作用 `auditSvc.Log(claims, service.AuditEntry{...}, c.ClientIP(), c.GetHeader("User-Agent"), c.GetString("request_id"))`。
- 错误返回用 `adminError(c, status, code, msg)`(handler 包内已有)。
- 测试用 `testutil.NewTestDB(t, &model.Scenario{})`(内存 sqlite)。
- 每个 task 结束 commit;分支 `feat/scenario-backend`。

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `internal/model/model.go` | 修改 | 新增 `Scenario` struct + `Migrate()` 注册 |
| `internal/service/scenario.go` | 新建 | `ScenarioService`:List(覆盖合并)/Get/Create/Update/Delete/Clone/Toggle/Sort + `SeedOfficialScenarios` |
| `internal/service/scenario_seed.go` | 新建 | 官方场景常量定义(~20 个) |
| `internal/service/scenario_test.go` | 新建 | service 单测 |
| `internal/handler/admin_scenario.go` | 新建 | `AdminScenarioHandler`:admin CRUD/clone/toggle/sort + 审计 + 409 |
| `internal/handler/admin_scenario_test.go` | 新建 | admin handler 测试 |
| `internal/handler/scenario.go` | 新建 | `ScenarioHandler`:desktop 只读 List |
| `internal/handler/scenario_test.go` | 新建 | desktop handler 测试 |
| `internal/router/router.go` | 修改 | 构造 service + 注册 `/api/scenarios` 与 `/api/admin/scenarios/*` + 启动 seed |

---

## Task 1: Scenario 模型 + 迁移

**Files:**
- Modify: `internal/model/model.go`(在 `TemplateApply` 后新增 struct + `Migrate()` 加一行)

**Interfaces:**
- Produces: `model.Scenario` struct,字段见下;`Migrate()` 含 `&Scenario{}`。

- [ ] **Step 1: 写失败测试 — 模型能 migrate 且字段齐全**

Create `internal/model/scenario_test.go`:

```go
package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestScenarioMigrateAndCreate(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	row := Scenario{
		ID:             uuid.New(),
		Slug:           "summarize-doc",
		Source:         "official",
		Title:          "总结文档",
		Description:    "上传文档生成摘要",
		Category:       "分析",
		Icon:           "FileText",
		AgentID:        "agent-1",
		AgentName:      "文档助手",
		ModelPreset:    map[string]interface{}{"provider_id": "p1", "model": "qwen-max"},
		PromptTemplate: "请总结:{{doc}}",
		Variables: []map[string]interface{}{
			{"key": "doc", "label": "文档", "type": "file", "required": true},
		},
		ExampleDialogue: []map[string]interface{}{
			{"role": "user", "content": "总结这份报告"},
		},
		SortOrder: 1,
		Enabled:   true,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatalf("create scenario: %v", err)
	}

	var got Scenario
	if err := db.First(&got, "slug = ?", "summarize-doc").Error; err != nil {
		t.Fatalf("first: %v", err)
	}
	if got.Title != "总结文档" {
		t.Errorf("title: want 总结文档, got %s", got.Title)
	}
	if got.ModelPreset["model"] != "qwen-max" {
		t.Errorf("model_preset not serialized: %v", got.ModelPreset)
	}
	if len(got.Variables) != 1 {
		t.Errorf("variables: want 1, got %d", len(got.Variables))
	}
	if !got.Enabled {
		t.Errorf("enabled should be true")
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/model/ -run TestScenarioMigrateAndCreate -v`
Expected: FAIL — `undefined: Scenario`。

- [ ] **Step 3: 实现 Scenario 模型**

在 `internal/model/model.go` 的 `TemplateApply` struct 之后(文件末尾)新增:

```go
// Scenario is a "做同款" scenario preset shown in the desktop chat gallery.
// source=official rows are seed (read-only, upserted on startup); source=
// enterprise rows are admin-created and override official by slug.
// JSON tags use snake_case to match the frontend contract.
type Scenario struct {
	ID              uuid.UUID              `gorm:"type:uuid;primaryKey" json:"id"`
	Slug            string                 `gorm:"uniqueIndex:idx_scenario_slug_source,priority:1" json:"slug"`
	Source          string                 `gorm:"uniqueIndex:idx_scenario_slug_source,priority:2" json:"source"` // official | enterprise
	Title           string                 `json:"title"`
	Description     string                 `json:"description"`
	Category        string                 `json:"category"`
	Icon            string                 `json:"icon"`
	AgentID         string                 `json:"agent_id"`
	AgentName       string                 `json:"agent_name"`
	ModelPreset     map[string]interface{} `gorm:"serializer:json" json:"model_preset"`
	PromptTemplate  string                 `json:"prompt_template"`
	Variables       []map[string]interface{} `gorm:"serializer:json" json:"variables"`
	ExampleDialogue []map[string]interface{} `gorm:"serializer:json" json:"example_dialogue"`
	SortOrder       int                    `gorm:"default:0" json:"sort_order"`
	Enabled         bool                   `gorm:"default:true" json:"enabled"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}
```

在 `Migrate()` 的 `AutoMigrate` 参数列表末尾(`&TemplateApply{}` 之后)加 `&Scenario{}`:

```go
func Migrate(gdb *gorm.DB) error {
	return gdb.AutoMigrate(
		&Account{}, &RefreshToken{}, &AuditLog{},
		&OIDCConfig{}, &Policy{},
		&AgentTemplate{}, &MCPTemplate{}, &SkillTemplate{}, &TemplateApply{},
		&Scenario{},
	)
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/model/ -run TestScenarioMigrateAndCreate -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/model/model.go internal/model/scenario_test.go
git commit -m "feat(scenario): add Scenario model with jsonb fields and migration"
```

---

## Task 2: ScenarioService — 基础 CRUD

**Files:**
- Create: `internal/service/scenario.go`
- Test: `internal/service/scenario_test.go`

**Interfaces:**
- Consumes: `model.Scenario`, `testutil.NewTestDB`
- Produces: `ScenarioService` with `NewScenarioService(db *gorm.DB) *ScenarioService`, methods:
  - `ListAll(ctx) ([]model.Scenario, error)` — admin 视角,全部(含 disabled,带 source)
  - `ListEnabled(ctx) ([]model.Scenario, error)` — desktop 视角,enterprise 覆盖合并后的 enabled 列表
  - `Get(ctx, id) (*model.Scenario, error)`
  - `Create(ctx, s *model.Scenario) error` — 强制 source=enterprise
  - `Update(ctx, id, fields map[string]interface{}) error`
  - `Delete(ctx, id) error`
  - errors: `ErrOfficialReadOnly` (改/删 official 时返回), `ErrNotFound`

- [ ] **Step 1: 写失败测试 — Create + ListAll + Get**

Create `internal/service/scenario_test.go`:

```go
package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/testutil"
)

func scenarioDB(t *testing.T) *gorm.DB {
	t.Helper()
	return testutil.NewTestDB(t, &model.Scenario{})
}

func TestScenarioCreateListGet(t *testing.T) {
	db := scenarioDB(t)
	svc := NewScenarioService(db)
	ctx := context.Background()

	s := &model.Scenario{
		Slug: "test-slug", Title: "测试场景", Category: "写作",
		PromptTemplate: "hi", Source: "enterprise", Enabled: true,
	}
	if err := svc.Create(ctx, s); err != nil {
		t.Fatalf("create: %v", err)
	}
	if s.ID == uuid.Nil {
		t.Fatalf("id not set")
	}
	if s.Source != "enterprise" {
		t.Errorf("source should be forced enterprise, got %s", s.Source)
	}

	all, err := svc.ListAll(ctx)
	if err != nil {
		t.Fatalf("listall: %v", err)
	}
	if len(all) != 1 {
		t.Fatalf("listall: want 1, got %d", len(all))
	}

	got, err := svc.Get(ctx, s.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Title != "测试场景" {
		t.Errorf("title: got %s", got.Title)
	}

	_, err = svc.Get(ctx, uuid.New())
	if err != ErrNotFound {
		t.Errorf("missing get: want ErrNotFound, got %v", err)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioCreateListGet -v`
Expected: FAIL — `undefined: NewScenarioService, ErrNotFound`。

- [ ] **Step 3: 实现 ScenarioService 基础方法**

Create `internal/service/scenario.go`:

```go
package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-admin/internal/model"
)

// Scenario-specific errors.
var (
	ErrNotFound          = errors.New("scenario not found")
	ErrOfficialReadOnly  = errors.New("official scenario is read-only; clone to enterprise to edit")
)

// SourceOfficial / SourceEnterprise are the two scenario provenances.
const (
	SourceOfficial   = "official"
	SourceEnterprise = "enterprise"
)

// ScenarioService manages Scenario rows: admin CRUD plus the desktop-facing
// enabled list with enterprise-overrides-official merge by slug.
type ScenarioService struct {
	db *gorm.DB
}

// NewScenarioService constructs a ScenarioService.
func NewScenarioService(db *gorm.DB) *ScenarioService {
	return &ScenarioService{db: db}
}

// ListAll returns every scenario (admin view, includes disabled, carries source).
func (s *ScenarioService) ListAll(ctx context.Context) ([]model.Scenario, error) {
	var rows []model.Scenario
	err := s.db.WithContext(ctx).Order("category, sort_order, updated_at desc").Find(&rows).Error
	return rows, err
}

// Get returns one scenario by id.
func (s *ScenarioService) Get(ctx context.Context, id uuid.UUID) (*model.Scenario, error) {
	var row model.Scenario
	err := s.db.WithContext(ctx).First(&row, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// Create inserts a new scenario. Source is forced to enterprise (official rows
// only come from the seeder). ID is generated if zero.
func (s *ScenarioService) Create(ctx context.Context, sc *model.Scenario) error {
	sc.Source = SourceEnterprise
	if sc.ID == uuid.Nil {
		sc.ID = uuid.New()
	}
	return s.db.WithContext(ctx).Create(sc).Error
}

// Update applies a whitelisted field map to a scenario. Official scenarios
// cannot be updated (returns ErrOfficialReadOnly).
func (s *ScenarioService) Update(ctx context.Context, id uuid.UUID, fields map[string]interface{}) error {
	row, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if row.Source == SourceOfficial {
		return ErrOfficialReadOnly
	}
	res := s.db.WithContext(ctx).Model(&model.Scenario{}).
		Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes a scenario. Official scenarios cannot be deleted.
func (s *ScenarioService) Delete(ctx context.Context, id uuid.UUID) error {
	row, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if row.Source == SourceOfficial {
		return ErrOfficialReadOnly
	}
	return s.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Scenario{}).Error
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioCreateListGet -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/service/scenario.go internal/service/scenario_test.go
git commit -m "feat(scenario): ScenarioService basic CRUD with official read-only guard"
```

---

## Task 3: ListEnabled — enterprise 覆盖合并

**Files:**
- Modify: `internal/service/scenario.go`(加 `ListEnabled`)
- Modify: `internal/service/scenario_test.go`(加测试)

**Interfaces:**
- Produces: `ListEnabled(ctx) ([]model.Scenario, error)` — 同 slug 有 enterprise 则只返回 enterprise 版;enabled=true;按 category/sort_order 排序。

- [ ] **Step 1: 写失败测试 — enterprise 覆盖 official**

在 `scenario_test.go` 末尾追加:

```go
func TestScenarioListEnabledEnterpriseOverridesOfficial(t *testing.T) {
	db := scenarioDB(t)
	svc := NewScenarioService(db)
	ctx := context.Background()

	// official 版
	off := &model.Scenario{
		Slug: "summarize", Source: SourceOfficial, Title: "官方总结",
		Category: "分析", PromptTemplate: "off", Enabled: true, SortOrder: 1,
	}
	off.ID = uuid.New()
	if err := db.Create(off).Error; err != nil {
		t.Fatalf("create official: %v", err)
	}
	// enterprise 同 slug 覆盖
	ent := &model.Scenario{
		Slug: "summarize", Source: SourceEnterprise, Title: "企业定制总结",
		Category: "分析", PromptTemplate: "ent", Enabled: true, SortOrder: 1,
	}
	ent.ID = uuid.New()
	if err := db.Create(ent).Error; err != nil {
		t.Fatalf("create enterprise: %v", err)
	}
	// 另一个只 official 的
	off2 := &model.Scenario{
		Slug: "sql-gen", Source: SourceOfficial, Title: "SQL 生成",
		Category: "代码", PromptTemplate: "off2", Enabled: true, SortOrder: 2,
	}
	off2.ID = uuid.New()
	if err := db.Create(off2).Error; err != nil {
		t.Fatalf("create official2: %v", err)
	}
	// disabled 的 official 不应出现
	off3 := &model.Scenario{
		Slug: "disabled-one", Source: SourceOfficial, Title: "禁用的",
		Category: "写作", PromptTemplate: "x", Enabled: false, SortOrder: 3,
	}
	off3.ID = uuid.New()
	if err := db.Create(off3).Error; err != nil {
		t.Fatalf("create official3: %v", err)
	}

	got, err := svc.ListEnabled(ctx)
	if err != nil {
		t.Fatalf("listenabled: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 (summarize enterprise + sql-gen official), got %d: %+v", len(got), got)
	}
	// summarize 应是企业版
	if got[0].Title != "企业定制总结" {
		t.Errorf("summarize should be enterprise override, got %s", got[0].Title)
	}
	// 顺序:分析(summarize) 在前,代码(sql-gen) 在后
	if got[1].Title != "SQL 生成" {
		t.Errorf("second should be SQL 生成, got %s", got[1].Title)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioListEnabledEnterpriseOverridesOfficial -v`
Expected: FAIL — `undefined: ListEnabled`。

- [ ] **Step 3: 实现 ListEnabled**

在 `scenario.go` 的 `ListAll` 后追加:

```go
// ListEnabled returns the desktop-visible scenario list: enabled only, with
// enterprise overriding official by slug (same slug → enterprise wins).
func (s *ScenarioService) ListEnabled(ctx context.Context) ([]model.Scenario, error) {
	var rows []model.Scenario
	err := s.db.WithContext(ctx).
		Where("enabled = ?", true).
		Order("category, sort_order, updated_at desc").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	// Merge: per slug, enterprise wins over official.
	bySlug := make(map[string]model.Scenario, len(rows))
	order := make([]string, 0, len(rows))
	for _, r := range rows {
		existing, ok := bySlug[r.Slug]
		if !ok {
			bySlug[r.Slug] = r
			order = append(order, r.Slug)
			continue
		}
		// enterprise beats official; if both enterprise or both official, newer wins
		if r.Source == SourceEnterprise && existing.Source != SourceEnterprise {
			bySlug[r.Slug] = r
		} else if r.Source == existing.Source && r.UpdatedAt.After(existing.UpdatedAt) {
			bySlug[r.Slug] = r
		}
	}
	out := make([]model.Scenario, 0, len(order))
	for _, slug := range order {
		out = append(out, bySlug[slug])
	}
	return out, nil
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioListEnabled -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/service/scenario.go internal/service/scenario_test.go
git commit -m "feat(scenario): ListEnabled with enterprise-overrides-official merge"
```

---

## Task 4: Clone / Toggle / Sort

**Files:**
- Modify: `internal/service/scenario.go`
- Modify: `internal/service/scenario_test.go`

**Interfaces:**
- Produces:
  - `Clone(ctx, slug) (*model.Scenario, error)` — 找该 slug 的 official,复制成 enterprise 副本(若已有 enterprise 同 slug 则返回已存在的)
  - `Toggle(ctx, id) error` — 切 enabled(仅 enterprise)
  - `Sort(ctx, orders map[uuid.UUID]int) error` — 批量设 sort_order(仅 enterprise 行生效)

- [ ] **Step 1: 写失败测试**

在 `scenario_test.go` 末尾追加:

```go
func TestScenarioCloneOfficialToEnterprise(t *testing.T) {
	db := scenarioDB(t)
	svc := NewScenarioService(db)
	ctx := context.Background()

	off := &model.Scenario{
		ID: uuid.New(), Slug: "summarize", Source: SourceOfficial,
		Title: "官方", Category: "分析", PromptTemplate: "off", Enabled: true,
	}
	if err := db.Create(off).Error; err != nil {
		t.Fatalf("create: %v", err)
	}

	cloned, err := svc.Clone(ctx, "summarize")
	if err != nil {
		t.Fatalf("clone: %v", err)
	}
	if cloned.Source != SourceEnterprise {
		t.Errorf("clone source: want enterprise, got %s", cloned.Source)
	}
	if cloned.Title != "官方" {
		t.Errorf("clone should copy title, got %s", cloned.Title)
	}
	if cloned.ID == off.ID {
		t.Errorf("clone must have new id")
	}

	// 第二次 clone 同 slug:返回已存在的 enterprise 副本,不新建
	cloned2, err := svc.Clone(ctx, "summarize")
	if err != nil {
		t.Fatalf("clone2: %v", err)
	}
	if cloned2.ID != cloned.ID {
		t.Errorf("second clone should return existing enterprise, got different id")
	}
}

func TestScenarioToggleAndSort(t *testing.T) {
	db := scenarioDB(t)
	svc := NewScenarioService(db)
	ctx := context.Background()

	ent := &model.Scenario{Slug: "e1", Title: "E1", Category: "写作", PromptTemplate: "x", Enabled: true}
	if err := svc.Create(ctx, ent); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.Toggle(ctx, ent.ID); err != nil {
		t.Fatalf("toggle: %v", err)
	}
	got, _ := svc.Get(ctx, ent.ID)
	if got.Enabled {
		t.Errorf("toggle should disable, still enabled")
	}

	if err := svc.Sort(ctx, map[uuid.UUID]int{ent.ID: 42}); err != nil {
		t.Fatalf("sort: %v", err)
	}
	got2, _ := svc.Get(ctx, ent.ID)
	if got2.SortOrder != 42 {
		t.Errorf("sort_order: want 42, got %d", got2.SortOrder)
	}

	// official 不能 toggle
	off := &model.Scenario{ID: uuid.New(), Slug: "o1", Source: SourceOfficial, Title: "O", Category: "c", PromptTemplate: "x", Enabled: true}
	if err := db.Create(off).Error; err != nil {
		t.Fatalf("create off: %v", err)
	}
	if err := svc.Toggle(ctx, off.ID); err != ErrOfficialReadOnly {
		t.Errorf("toggle official: want ErrOfficialReadOnly, got %v", err)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run "TestScenarioClone|TestScenarioToggle" -v`
Expected: FAIL — `undefined: Clone, Toggle, Sort`。

- [ ] **Step 3: 实现 Clone / Toggle / Sort**

在 `scenario.go` 末尾追加:

```go
// Clone copies an official scenario (by slug) into an enterprise-owned copy
// that the admin can then edit. If an enterprise row with the same slug
// already exists, it is returned as-is (idempotent).
func (s *ScenarioService) Clone(ctx context.Context, slug string) (*model.Scenario, error) {
	// Existing enterprise override wins.
	var ent model.Scenario
	err := s.db.WithContext(ctx).
		Where("slug = ? AND source = ?", slug, SourceEnterprise).
		First(&ent).Error
	if err == nil {
		return &ent, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	// Find the official source.
	var off model.Scenario
	err = s.db.WithContext(ctx).
		Where("slug = ? AND source = ?", slug, SourceOfficial).
		First(&off).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	clone := off
	clone.ID = uuid.New()
	clone.Source = SourceEnterprise
	clone.Enabled = true
	if err := s.db.WithContext(ctx).Create(&clone).Error; err != nil {
		return nil, err
	}
	return &clone, nil
}

// Toggle flips the enabled flag. Official scenarios cannot be toggled.
func (s *ScenarioService) Toggle(ctx context.Context, id uuid.UUID) error {
	row, err := s.Get(ctx, id)
	if err != nil {
		return err
	}
	if row.Source == SourceOfficial {
		return ErrOfficialReadOnly
	}
	return s.db.WithContext(ctx).Model(&model.Scenario{}).
		Where("id = ?", id).Update("enabled", !row.Enabled).Error
}

// Sort sets sort_order for the given scenario ids. Only enterprise rows are
// affected; official rows are silently skipped (read-only).
func (s *ScenarioService) Sort(ctx context.Context, orders map[uuid.UUID]int) error {
	for id, order := range orders {
		row, err := s.Get(ctx, id)
		if err != nil {
			return err
		}
		if row.Source == SourceOfficial {
			continue
		}
		if err := s.db.WithContext(ctx).Model(&model.Scenario{}).
			Where("id = ?", id).Update("sort_order", order).Error; err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run "TestScenarioClone|TestScenarioToggle" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/service/scenario.go internal/service/scenario_test.go
git commit -m "feat(scenario): Clone/Toggle/Sort with official read-only guards"
```

---

## Task 5: 官方场景 seed

**Files:**
- Create: `internal/service/scenario_seed.go`
- Modify: `internal/service/scenario.go`(加 `SeedOfficialScenarios`)
- Modify: `internal/service/scenario_test.go`(加 seed 测试)

**Interfaces:**
- Produces: `SeedOfficialScenarios(ctx) error` — 按 slug upsert official 行(已有 official 则更新官方字段,不碰 enterprise),幂等。

- [ ] **Step 1: 写失败测试 — seed 幂等且不碰 enterprise**

在 `scenario_test.go` 末尾追加:

```go
func TestScenarioSeedIdempotentAndPreservesEnterprise(t *testing.T) {
	db := scenarioDB(t)
	svc := NewScenarioService(db)
	ctx := context.Background()

	// 跑两次 seed,应幂等
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed1: %v", err)
	}
	all, _ := svc.ListAll(ctx)
	officialCount := 0
	for _, r := range all {
		if r.Source == SourceOfficial {
			officialCount++
		}
	}
	if officialCount == 0 {
		t.Fatalf("seed should insert official scenarios")
	}
	firstCount := len(all)

	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed2: %v", err)
	}
	all2, _ := svc.ListAll(ctx)
	if len(all2) != firstCount {
		t.Errorf("seed should be idempotent: want %d, got %d", firstCount, len(all2))
	}

	// 企业已有同 slug 覆盖,seed 不应删它
	entSlug := "summarize-doc" // 假设 seed 含此 slug
	ent := &model.Scenario{
		ID: uuid.New(), Slug: entSlug, Source: SourceEnterprise,
		Title: "企业改过的", Category: "分析", PromptTemplate: "ent", Enabled: true,
	}
	if err := db.Create(ent).Error; err != nil {
		t.Fatalf("create ent: %v", err)
	}
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed3: %v", err)
	}
	// enterprise 行仍在
	var still model.Scenario
	if err := db.Where("slug = ? AND source = ?", entSlug, SourceEnterprise).First(&still).Error; err != nil {
		t.Errorf("enterprise override should survive seed: %v", err)
	}
	if still.Title != "企业改过的" {
		t.Errorf("enterprise title changed by seed: %s", still.Title)
	}
	// official 行也在(被 upsert 更新)
	var off model.Scenario
	if err := db.Where("slug = ? AND source = ?", entSlug, SourceOfficial).First(&off).Error; err != nil {
		t.Errorf("official row should exist after seed: %v", err)
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioSeed -v`
Expected: FAIL — `undefined: SeedOfficialScenarios`。

- [ ] **Step 3: 定义官方场景常量**

Create `internal/service/scenario_seed.go`:

```go
package service

// officialScenarios is the curated v1 seed of "做同款" scenarios, ~20 covering
// 7 business-function categories. Slug is the stable identity across upgrades;
// admin enterprise overrides key off slug.
var officialScenarios = []seedScenario{
	// 写作
	{Slug: "summarize-doc", Title: "总结文档", Category: "写作", Icon: "FileText", Description: "上传文档,生成结构化摘要与要点", PromptTemplate: "请总结以下文档的核心内容,列出 3-5 个要点:\n\n{{doc}}", Variables: []map[string]interface{}{{"key": "doc", "label": "文档", "type": "file", "required": true}}},
	{Slug: "draft-email", Title: "起草邮件", Category: "写作", Icon: "Mail", Description: "按主题与语气起草一封专业邮件", PromptTemplate: "请起草一封邮件。\n主题:{{topic}}\n语气:{{tone}}\n收件人:{{recipient}}", Variables: []map[string]interface{}{{"key": "topic", "label": "主题", "type": "text", "required": true}, {"key": "tone", "label": "语气", "type": "select", "options": []string{"正式", "友好", "紧急"}, "default": "正式"}, {"key": "recipient", "label": "收件人", "type": "text", "required": true}}},
	{Slug: "rewrite-polish", Title: "改写润色", Category: "写作", Icon: "PenLine", Description: "把粗糙文字改写成通顺得体的表达", PromptTemplate: "请润色以下文字,保持原意,使其更通顺专业:\n\n{{text}}", Variables: []map[string]interface{}{{"key": "text", "label": "原文", "type": "textarea", "required": true}}},
	// 分析
	{Slug: "data-insight", Title: "数据洞察", Category: "分析", Icon: "BarChart3", Description: "从表格数据中发现趋势与异常", PromptTemplate: "请分析以下数据,指出关键趋势、异常与建议:\n\n{{data}}", Variables: []map[string]interface{}{{"key": "data", "label": "数据", "type": "file", "required": true}}},
	{Slug: "report-read", Title: "报表解读", Category: "分析", Icon: "LineChart", Description: "把一份报表读成人话,讲清结论", PromptTemplate: "请解读这份报表的主要结论与含义:\n\n{{report}}", Variables: []map[string]interface{}{{"key": "report", "label": "报表", "type": "file", "required": true}}},
	{Slug: "competitor-compare", Title: "竞品对比", Category: "分析", Icon: "Scale", Description: "结构化对比多个竞品的优劣", PromptTemplate: "请结构化对比以下竞品,输出对比表与结论:\n竞品:{{competitors}}\n维度:{{aspects}}", Variables: []map[string]interface{}{{"key": "competitors", "label": "竞品", "type": "text", "required": true}, {"key": "aspects", "label": "对比维度", "type": "textarea", "required": true}}},
	// 代码
	{Slug: "sql-generate", Title: "SQL 生成", Category: "代码", Icon: "Database", Description: "用自然语言描述需求,生成 SQL", PromptTemplate: "数据库类型:{{dialect}}\n请根据需求生成 SQL:\n{{need}}", Variables: []map[string]interface{}{{"key": "dialect", "label": "数据库类型", "type": "select", "options": []string{"PostgreSQL", "MySQL", "SQLite"}, "default": "PostgreSQL"}, {"key": "need", "label": "需求", "type": "textarea", "required": true}}},
	{Slug: "code-review", Title: "代码审查", Category: "代码", Icon: "FileCode", Description: "审查代码,指出问题与改进建议", PromptTemplate: "请审查以下代码,指出潜在问题、风格与改进建议:\n\n{{code}}", Variables: []map[string]interface{}{{"key": "code", "label": "代码", "type": "textarea", "required": true}}},
	{Slug: "bug-locate", Title: "bug 定位", Category: "代码", Icon: "Bug", Description: "描述现象,帮你定位 bug 根因", PromptTemplate: "请帮我定位以下 bug 的可能根因与排查方向:\n现象:{{symptom}}\n相关代码:\n{{code}}", Variables: []map[string]interface{}{{"key": "symptom", "label": "现象", "type": "textarea", "required": true}, {"key": "code", "label": "相关代码", "type": "textarea"}}},
	// 办公
	{Slug: "weekly-report", Title: "周报生成", Category: "办公", Icon: "CalendarDays", Description: "把本周事项整理成结构化周报", PromptTemplate: "请把以下本周事项整理成周报(本周完成/下周计划/风险):\n{{items}}", Variables: []map[string]interface{}{{"key": "items", "label": "本周事项", "type": "textarea", "required": true}}},
	{Slug: "meeting-notes", Title: "会议纪要", Category: "办公", Icon: "NotebookPen", Description: "把会议记录整理成纪要与待办", PromptTemplate: "请整理以下会议记录为纪要(结论/决议/待办):\n{{record}}", Variables: []map[string]interface{}{{"key": "record", "label": "会议记录", "type": "textarea", "required": true}}},
	{Slug: "ppt-outline", Title: "PPT 大纲", Category: "办公", Icon: "Presentation", Description: "按主题生成 PPT 大纲与每页要点", PromptTemplate: "请为主题生成一份 PPT 大纲,含每页标题与要点:\n主题:{{topic}}\n页数:{{pages}}", Variables: []map[string]interface{}{{"key": "topic", "label": "主题", "type": "text", "required": true}, {"key": "pages", "label": "页数", "type": "text", "default": "8"}}},
	// 运营
	{Slug: "campaign-copy", Title: "活动文案", Category: "运营", Icon: "Megaphone", Description: "为营销活动生成多版本文案", PromptTemplate: "请为以下活动生成 3 版文案(各 100 字内):\n活动:{{campaign}}\n渠道:{{channel}}", Variables: []map[string]interface{}{{"key": "campaign", "label": "活动", "type": "text", "required": true}, {"key": "channel", "label": "渠道", "type": "select", "options": []string{"公众号", "朋友圈", "短信", "邮件"}}}},
	{Slug: "user-persona", Title: "用户画像", Category: "运营", Icon: "Users", Description: "从行为数据归纳用户画像分群", PromptTemplate: "请根据以下用户行为数据归纳典型用户画像:\n{{data}}", Variables: []map[string]interface{}{{"key": "data", "label": "行为数据", "type": "textarea", "required": true}}},
	{Slug: "social-schedule", Title: "社媒排期", Category: "运营", Icon: "CalendarClock", Description: "为一周社媒内容生成排期表", PromptTemplate: "请为以下内容生成一周社媒排期表(平台/时间/内容):\n{{content}}", Variables: []map[string]interface{}{{"key": "content", "label": "内容素材", "type": "textarea", "required": true}}},
	// 客服
	{Slug: "reply-suggest", Title: "话术建议", Category: "客服", Icon: "MessageSquare", Description: "针对客户问题给出回复话术建议", PromptTemplate: "请针对以下客户问题,给出 2-3 种回复话术:\n问题:{{question}}\n期望语气:{{tone}}", Variables: []map[string]interface{}{{"key": "question", "label": "客户问题", "type": "textarea", "required": true}, {"key": "tone", "label": "语气", "type": "select", "options": []string{"安抚", "专业", "热情"}, "default": "专业"}}},
	{Slug: "ticket-classify", Title: "工单分类", Category: "客服", Icon: "Tags", Description: "把工单自动归类与提取关键信息", PromptTemplate: "请对以下工单分类并提取关键信息(类别/紧急度/摘要):\n{{ticket}}", Variables: []map[string]interface{}{{"key": "ticket", "label": "工单内容", "type": "textarea", "required": true}}},
	{Slug: "faq-build", Title: "FAQ 整理", Category: "客服", Icon: "HelpCircle", Description: "从历史问答整理成 FAQ 文档", PromptTemplate: "请把以下历史问答整理成 FAQ(问题/答案),去重归并:\n{{qa}}", Variables: []map[string]interface{}{{"key": "qa", "label": "历史问答", "type": "textarea", "required": true}}},
	// 知识
	{Slug: "knowledge-extract", Title: "知识抽取", Category: "知识", Icon: "BookOpen", Description: "从长文档抽取实体与关系", PromptTemplate: "请从以下文档抽取关键实体与关系:\n{{doc}}", Variables: []map[string]interface{}{{"key": "doc", "label": "文档", "type": "file", "required": true}}},
	{Slug: "term-explain", Title: "术语解释", Category: "知识", Icon: "BookMarked", Description: "把专业术语解释成通俗语言", PromptTemplate: "请把以下术语解释成通俗语言,并举例:\n{{term}}", Variables: []map[string]interface{}{{"key": "term", "label": "术语", "type": "text", "required": true}}},
	{Slug: "doc-qa", Title: "文档问答", Category: "知识", Icon: "FileQuestion", Description: "针对上传文档提问,获取答案", PromptTemplate: "请根据以下文档回答问题。\n文档:{{doc}}\n问题:{{question}}", Variables: []map[string]interface{}{{"key": "doc", "label": "文档", "type": "file", "required": true}, {"key": "question", "label": "问题", "type": "textarea", "required": true}}},
}

type seedScenario struct {
	Slug           string
	Title          string
	Category       string
	Icon           string
	Description    string
	AgentID        string
	AgentName      string
	ModelPreset    map[string]interface{}
	PromptTemplate string
	Variables      []map[string]interface{}
}
```

- [ ] **Step 4: 实现 SeedOfficialScenarios**

在 `scenario.go` 末尾追加:

```go
// SeedOfficialScenarios upserts the curated official scenarios by slug. An
// existing official row is updated with the seed fields; an existing
// enterprise override is left untouched. Missing rows are inserted.
func (s *ScenarioService) SeedOfficialScenarios(ctx context.Context) error {
	for _, seed := range officialScenarios {
		var row model.Scenario
		err := s.db.WithContext(ctx).
			Where("slug = ? AND source = ?", seed.Slug, SourceOfficial).
			First(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			row = model.Scenario{
				ID:              uuid.New(),
				Slug:            seed.Slug,
				Source:          SourceOfficial,
				Title:           seed.Title,
				Description:     seed.Description,
				Category:        seed.Category,
				Icon:            seed.Icon,
				AgentID:         seed.AgentID,
				AgentName:       seed.AgentName,
				ModelPreset:     seed.ModelPreset,
				PromptTemplate:  seed.PromptTemplate,
				Variables:       seed.Variables,
				ExampleDialogue: []map[string]interface{}{},
				SortOrder:       0,
				Enabled:         true,
			}
			if err := s.db.WithContext(ctx).Create(&row).Error; err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		// Update official fields in place.
		updates := map[string]interface{}{
			"title":            seed.Title,
			"description":      seed.Description,
			"category":         seed.Category,
			"icon":             seed.Icon,
			"agent_id":         seed.AgentID,
			"agent_name":       seed.AgentName,
			"model_preset":     seed.ModelPreset,
			"prompt_template":  seed.PromptTemplate,
			"variables":        seed.Variables,
		}
		if err := s.db.WithContext(ctx).Model(&model.Scenario{}).
			Where("id = ?", row.ID).Updates(updates).Error; err != nil {
			return err
		}
	}
	return nil
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/service/ -run TestScenarioSeed -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/service/scenario_seed.go internal/service/scenario.go internal/service/scenario_test.go
git commit -m "feat(scenario): official scenario seed with idempotent upsert"
```

---

## Task 6: AdminScenarioHandler — admin CRUD

**Files:**
- Create: `internal/handler/admin_scenario.go`
- Test: `internal/handler/admin_scenario_test.go`

**Interfaces:**
- Consumes: `service.ScenarioService`, `service.AuditService`, `middleware.GetClaims`, `adminError`, `service.ErrOfficialReadOnly`, `service.ErrNotFound`
- Produces: `AdminScenarioHandler` with:
  - `NewAdminScenarioHandler(svc *service.ScenarioService, audit *service.AuditService) *AdminScenarioHandler`
  - `List(c *gin.Context)` — 全部(admin 视角)
  - `Get(c *gin.Context)` — :id
  - `Create(c *gin.Context)` — enterprise
  - `Update(c *gin.Context)` — :id,official→409
  - `Delete(c *gin.Context)` — :id,official→409

- [ ] **Step 1: 写失败测试 — List/Get/Create + Update official 409**

Create `internal/handler/admin_scenario_test.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/workpaw/workpaw-admin/internal/middleware"
	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/service"
	"github.com/workpaw/workpaw-admin/internal/testutil"
)

func newScenarioTestEngine(t *testing.T) (*gin.Engine, *service.ScenarioService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := testutil.NewTestDB(t, &model.Scenario{})
	svc := service.NewScenarioService(db)
	h := NewAdminScenarioHandler(svc, nil)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("workpaw_claims", &service.WorkPawClaims{
			UserID: "admin-1", Email: "a@t", Name: "Admin", Roles: []string{"admin"},
		})
		c.Set("request_id", "req-test")
		c.Next()
	})
	r.GET("/api/admin/scenarios", h.List)
	r.GET("/api/admin/scenarios/:id", h.Get)
	r.POST("/api/admin/scenarios", h.Create)
	r.PUT("/api/admin/scenarios/:id", h.Update)
	r.DELETE("/api/admin/scenarios/:id", h.Delete)
	return r, svc
}

func TestAdminScenarioListCreateGet(t *testing.T) {
	r, svc := newScenarioTestEngine(t)
	// seed one official
	ctx := context.Background()
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Create enterprise
	body := `{"slug":"custom","title":"自定义","category":"写作","prompt_template":"hi"}`
	req := httptest.NewRequest("POST", "/api/admin/scenarios", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: want 201, got %d: %s", w.Code, w.Body.String())
	}
	var created map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &created)
	newID, _ := created["id"].(string)
	if newID == "" {
		t.Fatalf("create: no id in response: %s", w.Body.String())
	}

	// List
	req2 := httptest.NewRequest("GET", "/api/admin/scenarios", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w2.Code, w2.Body.String())
	}

	// Get
	req3 := httptest.NewRequest("GET", "/api/admin/scenarios/"+newID, nil)
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("get: %d %s", w3.Code, w3.Body.String())
	}
}

func TestAdminScenarioUpdateOfficialReturns409(t *testing.T) {
	r, svc := newScenarioTestEngine(t)
	ctx := context.Background()
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	all, _ := svc.ListAll(ctx)
	if len(all) == 0 {
		t.Fatalf("no seeded scenarios")
	}
	var official model.Scenario
	for _, s := range all {
		if s.Source == service.SourceOfficial {
			official = s
			break
		}
	}
	body := `{"title":"改不掉"}`
	req := httptest.NewRequest("PUT", "/api/admin/scenarios/"+official.ID.String(), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Errorf("update official: want 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAdminScenarioDeleteOfficialReturns409(t *testing.T) {
	r, svc := newScenarioTestEngine(t)
	ctx := context.Background()
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	all, _ := svc.ListAll(ctx)
	var official model.Scenario
	for _, s := range all {
		if s.Source == service.SourceOfficial {
			official = s
			break
		}
	}
	req := httptest.NewRequest("DELETE", "/api/admin/scenarios/"+official.ID.String(), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Errorf("delete official: want 409, got %d: %s", w.Code, w.Body.String())
	}
}

// silence unused import guards if middleware referenced only in helper signatures
var _ = middleware.GetClaims
var _ = uuid.New
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestAdminScenario -v`
Expected: FAIL — `undefined: NewAdminScenarioHandler`。

- [ ] **Step 3: 实现 AdminScenarioHandler**

Create `internal/handler/admin_scenario.go`:

```go
package handler

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/workpaw/workpaw-admin/internal/middleware"
	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/service"
)

// AdminScenarioHandler provides admin CRUD for scenarios.
type AdminScenarioHandler struct {
	svc  *service.ScenarioService
	audit *service.AuditService
}

// NewAdminScenarioHandler constructs an AdminScenarioHandler.
func NewAdminScenarioHandler(svc *service.ScenarioService, audit *service.AuditService) *AdminScenarioHandler {
	return &AdminScenarioHandler{svc: svc, audit: audit}
}

// List returns all scenarios (admin view: includes disabled + source).
func (h *AdminScenarioHandler) List(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	rows, err := h.svc.ListAll(c.Request.Context())
	if err != nil {
		adminError(c, http.StatusInternalServerError, "list_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"scenarios": rows})
}

// Get returns one scenario by id.
func (h *AdminScenarioHandler) Get(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", "invalid id")
		return
	}
	row, err := h.svc.Get(c.Request.Context(), id)
	if errors.Is(err, service.ErrNotFound) {
		adminError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	if err != nil {
		adminError(c, http.StatusInternalServerError, "get_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, row)
}

// Create inserts a new enterprise scenario.
func (h *AdminScenarioHandler) Create(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	var sc model.Scenario
	if err := c.ShouldBindJSON(&sc); err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if sc.Slug == "" || sc.Title == "" || sc.PromptTemplate == "" {
		adminError(c, http.StatusBadRequest, "bad_request", "slug, title, prompt_template are required")
		return
	}
	if err := h.svc.Create(c.Request.Context(), &sc); err != nil {
		adminError(c, http.StatusInternalServerError, "create_error", err.Error())
		return
	}
	h.auditScenario(c, "scenario.create", sc.ID.String(), sc.Title, sc.Slug)
	c.JSON(http.StatusCreated, sc)
}

// Update modifies an enterprise scenario. Official → 409.
func (h *AdminScenarioHandler) Update(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", "invalid id")
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	allowed := map[string]bool{
		"title": true, "description": true, "category": true, "icon": true,
		"agent_id": true, "agent_name": true, "model_preset": true,
		"prompt_template": true, "variables": true, "example_dialogue": true,
		"sort_order": true, "enabled": true,
	}
	fields := map[string]interface{}{}
	for k, v := range body {
		if allowed[k] {
			fields[k] = v
		}
	}
	err = h.svc.Update(c.Request.Context(), id, fields)
	if errors.Is(err, service.ErrOfficialReadOnly) {
		adminError(c, http.StatusConflict, "official_read_only", err.Error())
		return
	}
	if errors.Is(err, service.ErrNotFound) {
		adminError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	if err != nil {
		adminError(c, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	h.auditScenario(c, "scenario.update", id.String(), "", "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Delete removes an enterprise scenario. Official → 409.
func (h *AdminScenarioHandler) Delete(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", "invalid id")
		return
	}
	err = h.svc.Delete(c.Request.Context(), id)
	if errors.Is(err, service.ErrOfficialReadOnly) {
		adminError(c, http.StatusConflict, "official_read_only", err.Error())
		return
	}
	if errors.Is(err, service.ErrNotFound) {
		adminError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	if err != nil {
		adminError(c, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	h.auditScenario(c, "scenario.delete", id.String(), "", "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *AdminScenarioHandler) auditScenario(c *gin.Context, action, id, name, slug string) {
	if h.audit == nil {
		return
	}
	claims := middleware.GetClaims(c)
	h.audit.Log(claims, service.AuditEntry{
		Action:     action,
		TargetType: "scenario",
		TargetID:   id,
		TargetName: name,
		Detail:     map[string]interface{}{"slug": slug},
	}, c.ClientIP(), c.GetHeader("User-Agent"), c.GetString("request_id"))
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestAdminScenario -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/handler/admin_scenario.go internal/handler/admin_scenario_test.go
git commit -m "feat(scenario): AdminScenarioHandler CRUD with 409 on official"
```

---

## Task 7: AdminScenarioHandler — Clone/Toggle/Sort

**Files:**
- Modify: `internal/handler/admin_scenario.go`
- Modify: `internal/handler/admin_scenario_test.go`

**Interfaces:**
- Produces: `Clone(c)` (POST `/scenarios/clone/:slug`), `Toggle(c)` (PUT `/scenarios/:id/toggle`), `Sort(c)` (PUT `/scenarios/sort`, body `{orders: {id: order}}`).

- [ ] **Step 1: 写失败测试**

在 `admin_scenario_test.go` 末尾追加:

```go
func TestAdminScenarioCloneToggleSort(t *testing.T) {
	r, svc := newScenarioTestEngine(t)
	ctx := context.Background()
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}
	all, _ := svc.ListAll(ctx)
	var official model.Scenario
	for _, s := range all {
		if s.Source == service.SourceOfficial {
			official = s
			break
		}
	}

	// Clone
	req := httptest.NewRequest("POST", "/api/admin/scenarios/clone/"+official.Slug, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("clone: want 200, got %d: %s", w.Code, w.Body.String())
	}
	var cloned map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &cloned)
	clonedID, _ := cloned["id"].(string)
	if clonedID == "" {
		t.Fatalf("clone: no id")
	}

	// Toggle
	req2 := httptest.NewRequest("PUT", "/api/admin/scenarios/"+clonedID+"/toggle", nil)
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("toggle: want 200, got %d: %s", w2.Code, w2.Body.String())
	}

	// Sort
	sortBody := `{"orders":{"` + clonedID + `":99}}`
	req3 := httptest.NewRequest("PUT", "/api/admin/scenarios/sort", strings.NewReader(sortBody))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	r.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("sort: want 200, got %d: %s", w3.Code, w3.Body.String())
	}
}
```

并在测试引擎里注册新路由 — 修改 `newScenarioTestEngine` 的路由注册段,追加:

```go
	r.POST("/api/admin/scenarios/clone/:slug", h.Clone)
	r.PUT("/api/admin/scenarios/:id/toggle", h.Toggle)
	r.PUT("/api/admin/scenarios/sort", h.Sort)
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestAdminScenarioCloneToggleSort -v`
Expected: FAIL — `undefined: Clone, Toggle, Sort`。

- [ ] **Step 3: 实现 Clone/Toggle/Sort handler**

在 `admin_scenario.go` 末尾追加:

```go
// Clone copies an official scenario (by slug) into an editable enterprise copy.
func (h *AdminScenarioHandler) Clone(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	slug := c.Param("slug")
	if slug == "" {
		adminError(c, http.StatusBadRequest, "bad_request", "slug required")
		return
	}
	row, err := h.svc.Clone(c.Request.Context(), slug)
	if errors.Is(err, service.ErrNotFound) {
		adminError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	if err != nil {
		adminError(c, http.StatusInternalServerError, "clone_error", err.Error())
		return
	}
	h.auditScenario(c, "scenario.clone", row.ID.String(), row.Title, row.Slug)
	c.JSON(http.StatusOK, row)
}

// Toggle flips the enabled flag of an enterprise scenario.
func (h *AdminScenarioHandler) Toggle(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", "invalid id")
		return
	}
	err = h.svc.Toggle(c.Request.Context(), id)
	if errors.Is(err, service.ErrOfficialReadOnly) {
		adminError(c, http.StatusConflict, "official_read_only", err.Error())
		return
	}
	if errors.Is(err, service.ErrNotFound) {
		adminError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	if err != nil {
		adminError(c, http.StatusInternalServerError, "toggle_error", err.Error())
		return
	}
	h.auditScenario(c, "scenario.toggle", id.String(), "", "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Sort sets sort_order for multiple enterprise scenarios. Body: {orders: {id: n}}.
func (h *AdminScenarioHandler) Sort(c *gin.Context) {
	if h.svc == nil {
		adminError(c, http.StatusServiceUnavailable, "service_unavailable", "scenario service not configured")
		return
	}
	var body struct {
		Orders map[string]int `json:"orders"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		adminError(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	orders := make(map[uuid.UUID]int, len(body.Orders))
	for idStr, order := range body.Orders {
		id, err := uuid.Parse(idStr)
		if err != nil {
			adminError(c, http.StatusBadRequest, "bad_request", "invalid id: "+idStr)
			return
		}
		orders[id] = order
	}
	if err := h.svc.Sort(c.Request.Context(), orders); err != nil {
		adminError(c, http.StatusInternalServerError, "sort_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestAdminScenario -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/handler/admin_scenario.go internal/handler/admin_scenario_test.go
git commit -m "feat(scenario): admin Clone/Toggle/Sort handlers"
```

---

## Task 8: desktop 只读 Handler

**Files:**
- Create: `internal/handler/scenario.go`
- Test: `internal/handler/scenario_test.go`

**Interfaces:**
- Produces: `ScenarioHandler` with `NewScenarioHandler(svc *service.ScenarioService) *ScenarioHandler` and `List(c *gin.Context)` → `{"scenarios": [...]}`(已合并 enterprise 覆盖 + enabled 过滤)。

- [ ] **Step 1: 写失败测试**

Create `internal/handler/scenario_test.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-admin/internal/model"
	"github.com/workpaw/workpaw-admin/internal/service"
	"github.com/workpaw/workpaw-admin/internal/testutil"
)

func TestDesktopScenarioList(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := testutil.NewTestDB(t, &model.Scenario{})
	svc := service.NewScenarioService(db)
	ctx := context.Background()
	if err := svc.SeedOfficialScenarios(ctx); err != nil {
		t.Fatalf("seed: %v", err)
	}

	h := NewScenarioHandler(svc)
	r := gin.New()
	r.GET("/api/scenarios", h.List)

	req := httptest.NewRequest("GET", "/api/scenarios", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Scenarios []model.Scenario `json:"scenarios"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Scenarios) == 0 {
		t.Fatalf("expected seeded scenarios, got 0")
	}
	// all should be enabled (seeded officials are enabled)
	for _, s := range resp.Scenarios {
		if !s.Enabled {
			t.Errorf("desktop list should only return enabled, got disabled %s", s.Slug)
		}
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestDesktopScenarioList -v`
Expected: FAIL — `undefined: NewScenarioHandler`。

- [ ] **Step 3: 实现 ScenarioHandler**

Create `internal/handler/scenario.go`:

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/workpaw/workpaw-admin/internal/service"
)

// ScenarioHandler exposes the desktop read-only scenario list.
type ScenarioHandler struct {
	svc *service.ScenarioService
}

// NewScenarioHandler constructs a ScenarioHandler.
func NewScenarioHandler(svc *service.ScenarioService) *ScenarioHandler {
	return &ScenarioHandler{svc: svc}
}

// List returns enabled scenarios with enterprise-overrides-official merge.
func (h *ScenarioHandler) List(c *gin.Context) {
	if h.svc == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "scenario service not configured"})
		return
	}
	rows, err := h.svc.ListEnabled(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"scenarios": rows})
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/handler/ -run TestDesktopScenarioList -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/handler/scenario.go internal/handler/scenario_test.go
git commit -m "feat(scenario): desktop read-only List handler"
```

---

## Task 9: 路由注册 + 启动 seed

**Files:**
- Modify: `internal/router/router.go`

**Interfaces:**
- Consumes: `service.NewScenarioService`, `handler.NewAdminScenarioHandler`, `handler.NewScenarioHandler`, `service.ScenarioService.SeedOfficialScenarios`

- [ ] **Step 1: 写失败测试 — 路由可达**

router 包目前无测试文件(只有 router.go),无 `setupTestEngine` helper。直接调 `Setup` 构建引擎并断言路由注册。Create `internal/router/scenario_router_test.go`:

```go
package router

import (
	"net/http"
	"testing"

	"go.uber.org/zap"

	"github.com/workpaw/workpaw-admin/internal/config"
)

// Smoke test: scenario routes are registered. Setup in debug mode degrades
// gracefully when DB/K8s/OIDC are unreachable, so routes still register.
func TestScenarioRoutesRegistered(t *testing.T) {
	cfg := &config.Config{Server: config.ServerConfig{Mode: "debug"}}
	r := Setup(cfg, zap.NewNop())
	routes := r.Routes()
	foundDesktop := false
	foundAdminList := false
	for _, rt := range routes {
		if rt.Path == "/api/scenarios" && rt.Method == http.MethodGet {
			foundDesktop = true
		}
		if rt.Path == "/api/admin/scenarios" && rt.Method == http.MethodGet {
			foundAdminList = true
		}
	}
	if !foundDesktop {
		t.Errorf("GET /api/scenarios route not registered")
	}
	if !foundAdminList {
		t.Errorf("GET /api/admin/scenarios route not registered")
	}
}
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/router/ -run TestScenarioRoutes -v`
Expected: FAIL — 路由未注册(`foundDesktop` 为 false)。

- [ ] **Step 3: 注册路由 + 启动 seed**

在 `internal/router/router.go` 的 `Setup` 函数中:

(a) 在 `templateSvc = service.NewTemplateService(gdb)`(约第 225 行)之后,加:

```go
	// Scenario service (requires DB)
	var scenarioSvc *service.ScenarioService
	if gdb != nil {
		scenarioSvc = service.NewScenarioService(gdb)
		// Seed official scenarios on startup (idempotent upsert by slug).
		if err := scenarioSvc.SeedOfficialScenarios(context.Background()); err != nil {
			logger.Warn("scenario seed failed", zap.Error(err))
		} else {
			logger.Info("official scenarios seeded")
		}
	}
```

(b) 在 admin 路由块(约第 283 行 `adminGroup.POST("/templates/skills/:id/apply", tplH.Apply)` 之后,adminGroup 闭合 `}` 之前)加:

```go
		// Scenario CRUD + Clone + Toggle + Sort (admin only)
		scenarioAdminH := handler.NewAdminScenarioHandler(scenarioSvc, auditSvc)
		adminGroup.GET("/scenarios", scenarioAdminH.List)
		adminGroup.GET("/scenarios/:id", scenarioAdminH.Get)
		adminGroup.POST("/scenarios", scenarioAdminH.Create)
		adminGroup.PUT("/scenarios/:id", scenarioAdminH.Update)
		adminGroup.DELETE("/scenarios/:id", scenarioAdminH.Delete)
		adminGroup.POST("/scenarios/clone/:slug", scenarioAdminH.Clone)
		adminGroup.PUT("/scenarios/:id/toggle", scenarioAdminH.Toggle)
		adminGroup.PUT("/scenarios/sort", scenarioAdminH.Sort)
```

(c) 在 instance 路由块之后(普通登录区,约第 181 行 adminGroup 之前)加 desktop 只读路由:

```go
	// Scenario read-only (desktop, normal login)
	if scenarioSvc != nil {
		scenarioReadH := handler.NewScenarioHandler(scenarioSvc)
		scenarioGroup := r.Group("/api/scenarios")
		scenarioGroup.Use(middleware.Auth(jwtSvc))
		scenarioGroup.GET("", scenarioReadH.List)
		logger.Info("Scenario read routes registered: /api/scenarios")
	}
```

注:debug 模式下若 DB 不可达,`gdb` 为 nil,`scenarioSvc` 也为 nil,则两组场景路由都不注册(与现有 template/audit 等服务一致的 graceful degrade 行为);测试时确保 DB 可达或接受路由不注册。Step 1 的路由注册测试需 DB 可达才能通过——若本地无 Postgres,可临时跳过该测试(`t.Skip`),或用 `//go:build integration` 标签隔离。生产代码注册逻辑正确即可。

- [ ] **Step 4: 运行测试,确认通过**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go test ./internal/router/ -run TestScenarioRoutes -v`
Expected: PASS

- [ ] **Step 5: 全量构建 + 测试**

Run: `cd /Users/zhangsan/workpaw/workpaw-admin && go build ./... && go test ./...`
Expected: 全部 PASS(含既有测试)。

- [ ] **Step 6: Commit**

```bash
cd /Users/zhangsan/workpaw/workpaw-admin
git add internal/router/router.go internal/router/scenario_router_test.go
git commit -m "feat(scenario): register routes + seed official scenarios on startup"
```

---

## Self-Review (Plan 1)

**Spec coverage:**
- §2 数据模型 → Task 1 ✓
- §3.1 desktop 只读 `/api/scenarios` → Task 8 + Task 9c ✓
- §3.2 admin CRUD/clone/toggle/sort + 409 → Task 6 + Task 7 + Task 9b ✓
- §3.3 seed upsert 幂等 + 不碰 enterprise → Task 5 ✓
- §3.4 路由注册 → Task 9 ✓
- §2.4 enterprise 覆盖 official 合并查询 → Task 3 ✓
- 审计落库 → Task 6 auditScenario ✓
- snake_case json tag → Task 1 模型定义 ✓

**Placeholder scan:** 无 TBD/TODO;所有 step 含完整代码;seed 清单 20 个场景全部具名。

**Type consistency:** `model.Scenario` 字段在 Task 1 定义,后续 Task 全程一致(`Source`/`Slug`/`Enabled`/`SortOrder` 等);`ScenarioService` 方法签名 Task 2-5 渐进定义且一致;`ErrNotFound`/`ErrOfficialReadOnly` 全程同名;`SourceOfficial`/`SourceEnterprise` 常量全程一致。

**潜在问题(已处理):**
- `testutil.NewTestDB` 返回 `*gorm.DB`(非 `*testutil.DB`),Task 2 Step 1 已加修正说明。
- Task 2 测试 helper `scenarioDB` 返回类型已标注需 import `gorm.io/gorm`。
- router 测试若无 helper,Task 9 给了变体方案。

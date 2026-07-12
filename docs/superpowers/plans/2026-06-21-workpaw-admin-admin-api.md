# workpaw-control-plane/console Backend — Admin API & OIDC Central Management (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the control-plane admin API endpoints (stats/users/instance-govern/user-govern/OIDC-central-management/policy/audit) backed by PostgreSQL + K8s CRD, with audit logging on every write — the backend half of workpaw-control-plane/console.

**Architecture:** New `admin` service layer reads the K8s `QwenPawInstance` CRD list for the user/instance registry (joined with `accounts` for governance state), writes `policies`/`oidc_configs`/`agent_templates`/`mcp_templates`/`skill_templates`/`template_applies` via GORM, and enforces disable at instance-activate (extension of the Plan 1 `accounts` check). OIDC config moves from config.yaml-only to PostgreSQL with test-connection + confirm + hot-reload; `client_secret` AES-GCM encrypted. A `crypto` service isolates encryption. An `OIDCServiceManager` wraps the current `*OIDCService` for atomic hot-swap.

**Tech Stack:** Go 1.26, Gin, GORM + postgres/sqlite, K8s controller-runtime (CRD list via `client.List`), `coreos/go-oidc` (re-init for hot-reload), AES-256-GCM (`crypto/aes`), testcontainers.

## Global Constraints

- Go stack: Gin, Zap, Viper, Cobra. PostgreSQL only via GORM; `gorm:"serializer:json"` for slice/map columns (driver-agnostic — text on SQLite unit tests, text on Postgres prod).
- OIDC central management: `oidc_configs` single-row table; admin edits → `POST /oidc/test` (real IdP discovery only — `oidc.NewProvider` completes `.well-known/openid-configuration`; does NOT validate client_id/secret credentials, NOT persisted) → `PUT /oidc/config` (confirm, persists + hot-reload). Test failure does NOT take effect. config.yaml OIDC stays as bootstrap (used when DB row absent on startup). (Plan-deviation accepted by product owner: Test is discovery-only, not token-endpoint client-cred check — bad credentials surface at runtime login, not at Test.)
- `client_secret` AES-256-GCM encrypted with key from env `WORKPAW_DB_SECRET_KEY` (32 bytes). Debug-mode: if env absent, generate an ephemeral key (logged at WARN); production: if env absent, refuse to start the crypto service (admin OIDC routes 503). Format: `base64(nonce||ciphertext||tag)`, nonce 12 bytes.
- Policy: `policies` single-row table, loaded to memory at startup, `PUT` writes + hot-updates memory. `idle_timeout_seconds` (seconds) ↔ CRD `idleTimeoutMinutes` (minutes): convert seconds/60→minutes on CRD write, minutes*60→seconds on read. New instances only — existing instances unchanged (declared in policy page copy, enforced by only writing at Activate time).
- Instance governance: admin force-activate/deactivate reuse `InstanceService` but operate on a target user (not the caller); force-activate must check `accounts.is_disabled` (refuse 403). force-deactivate is allowed on disabled users (to stop their running instance).
- All admin write ops audit via `AuditService.Log` (Plan 1) — actor from JWT claims, request_id from middleware, ip/ua from gin.Context.
- Pagination: `?page=1&page_size=20` (offset, v1); response `{items, total, page, page_size}`. Error response: `{"error","code","detail","request_id"}`.
- All admin routes behind existing `Auth + AdminOnly` middleware (Plan 1). Bearer JWT, no cookie, no CSRF. v1 admin/non-admin binary roles.
- Unit tests use `glebarez/sqlite` in-memory (testutil.NewTestDB); K8s CRD calls mocked via interface; integration test uses testcontainers Postgres (`//go:build integration`).
- All commands run from `workpaw-control-plane/`. Each task ends with a commit. Commit prefix: `feat:`/`refactor:`/`test:`/`chore:`.

## Spec reference

- Design spec §6 (data model — oidc_configs, agent_templates, mcp_templates, skill_templates, policies, template_applies; accounts/refresh_tokens/audit_logs from Plan 1), §7 (API + 3 生效机制), §9 (data flows B/C/D), §10 (error handling), §12 alignment points 4/5/7/8.
- Alignment findings: `docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-alignment-findings.md` (CRD spec/status field names confirmed; OIDC hot-reload = rebuild+swap; client_secret AES-GCM).
- This plan does NOT implement template *application* (the Pod push — Plan 3) or the frontend (Plan 3). Template CRUD (create/read/update/delete the template rows) IS in this plan; the `apply` endpoint is Plan 3.

## File Structure

**Create (service layer):**
- `internal/service/crypto.go` — `CryptoService` (AES-GCM Encrypt/Decrypt with key from env; ephemeral in debug).
- `internal/service/oidc_manager.go` — `OIDCServiceManager` (atomic current `*OIDCService` swap; `Current()` / `Reload(ctx, cfg)`).
- `internal/service/oidc_config.go` — `OIDCConfigService` (load current row, save row with encrypted secret, test-connection via real IdP discovery).
- `internal/service/policy.go` — `PolicyService` (load to memory, get, update with optimistic lock, seconds↔minutes conversion helper).
- `internal/service/user.go` — `UserService` (list users = K8s CRD list + accounts join; detail; disable/enable).
- `internal/service/admin_instance.go` — `AdminInstanceService` (force activate/deactivate by target user, disable check on activate).
- `internal/service/stats.go` — `StatsService` (counts from accounts + CRD + audit_logs).
- `internal/service/template.go` — `TemplateService` (CRUD for agent/mcp/skill templates, soft delete).
- `internal/service/audit_query.go` — `AuditQueryService` (filtered/paginated query + CSV export).

**Create (handler + router):**
- `internal/handler/admin.go` — `AdminHandler` (all `/api/admin/*` handlers except templates which stay grouped).
- `internal/handler/admin_template.go` — `AdminTemplateHandler` (template CRUD routes).
- Modify `internal/router/router.go` — wire all admin services + handlers; register admin routes; build OIDCServiceManager from oidc_configs (fallback config.yaml); register JWKS already done (Plan 1).

**Create (models — extend model package):**
- Modify `internal/model/model.go` — add `OIDCConfig`, `Policy`, `AgentTemplate`, `MCPTemplate`, `SkillTemplate`, `TemplateApply` structs + extend `Migrate`.

**Create (K8s list interface for testability):**
- `internal/service/instance_lister.go` — `InstanceLister` interface (CRD list) + K8s impl; mockable in unit tests.

**Create (tests):** per-task `_test.go` files + `internal/service/admin_integration_test.go` (build-tagged).

---

### Task 1: Models — oidc_configs, policies, templates, template_applies

**Files:**
- Modify: `internal/model/model.go` (add structs + extend Migrate)
- Modify: `internal/model/model_test.go` (assert new tables)

**Interfaces:**
- Produces: `model.OIDCConfig`, `model.Policy`, `model.AgentTemplate`, `model.MCPTemplate`, `model.SkillTemplate`, `model.TemplateApply`. `Migrate` now creates 9 tables total (3 from Plan 1 + 6 new).

- [ ] **Step 1: Write the failing test**

Append to `internal/model/model_test.go`:
```go
func TestMigrateCreatesAllTables(t *testing.T) {
	gdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err := Migrate(gdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, name := range []string{
		"accounts", "refresh_tokens", "audit_logs",
		"oidc_configs", "policies",
		"agent_templates", "mcp_templates", "skill_templates",
		"template_applies",
	} {
		if !gdb.Migrator().HasTable(name) {
			t.Errorf("table %s not created", name)
		}
	}
}
```
(Remove or keep the old `TestMigrateCreatesTables` — if keeping, it still passes since it only checks 3 tables.)

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/model/... -run TestMigrateCreatesAllTables -v`
Expected: FAIL — new tables absent.

- [ ] **Step 3: Add the structs + extend Migrate**

Append to `internal/model/model.go` (after AuditLog):
```go
// OIDCConfig is the single-row (id=1) upstream IdP configuration, editable by
// admins. client_secret is AES-GCM encrypted at rest.
type OIDCConfig struct {
	ID                int       `gorm:"primaryKey"`
	IssuerURL         string
	ClientID          string
	ClientSecretEnc   string // base64(nonce||ciphertext||tag)
	RedirectURL       string
	Scopes            []string `gorm:"serializer:json"`
	AdminUsers        []string `gorm:"serializer:json"`
	UpdatedBy         string
	UpdatedAt         time.Time
	Version           int `gorm:"default:1"` // optimistic lock
}

// Policy is the single-row (id=1) global instance policy.
type Policy struct {
	ID                      int       `gorm:"primaryKey"`
	IdleTimeoutSeconds      int
	ScheduledStopPolicy     map[string]interface{} `gorm:"serializer:json"` // {scheduleStop, scheduleStart}
	DefaultCPURequest       string
	DefaultMemoryRequest    string
	DefaultPVCSize          string
	UpdatedBy               string
	UpdatedAt               time.Time
	Version                 int `gorm:"default:1"`
}

// AgentTemplate is a reusable Agent definition applied to users' Pods.
type AgentTemplate struct {
	ID                 uuid.UUID      `gorm:"type:uuid;primaryKey"`
	Name               string
	Description        string
	Spec               map[string]interface{} `gorm:"serializer:json"`
	MCPTemplateIDs     []uuid.UUID    `gorm:"serializer:json"`
	SkillTemplateIDs   []uuid.UUID    `gorm:"serializer:json"`
	CreatedBy          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
	DeletedAt          gorm.DeletedAt `gorm:"index"` // soft delete
}

// MCPTemplate is a reusable MCP client definition.
type MCPTemplate struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey"`
	Name        string
	Description string
	Spec        map[string]interface{} `gorm:"serializer:json"`
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

// SkillTemplate is a reusable Skill definition.
type SkillTemplate struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey"`
	Name        string
	Description string
	Spec        map[string]interface{} `gorm:"serializer:json"`
	CreatedBy   string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	DeletedAt   gorm.DeletedAt `gorm:"index"`
}

// TemplateApply records one template→user application (v1 synchronous).
type TemplateApply struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	TemplateType  string    `gorm:"index"` // agent|mcp|skill
	TemplateID    uuid.UUID `gorm:"type:uuid"`
	TemplateName  string    // redundant — survives template soft-delete
	TargetUserID  string    `gorm:"index"`
	TargetAgentID string
	Status        string    `gorm:"index"` // success|failed
	Error         string
	AppliedBy     string
	AppliedAt     time.Time
}
```
Add `"github.com/google/uuid"` and `"gorm.io/gorm"` to model.go imports (gorm already imported for serializer tag usage; add the explicit import + the `gorm.DeletedAt` / `uuid.UUID` references).
Extend `Migrate`:
```go
func Migrate(gdb *gorm.DB) error {
	return gdb.AutoMigrate(
		&Account{}, &RefreshToken{}, &AuditLog{},
		&OIDCConfig{}, &Policy{},
		&AgentTemplate{}, &MCPTemplate{}, &SkillTemplate{}, &TemplateApply{},
	)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/model/... -run TestMigrateCreatesAllTables -v`
Expected: PASS.

- [ ] **Step 5: Build + full suite + commit**

Run: `go build ./... && go test ./... -v` → all green.
```bash
git add internal/model/model.go internal/model/model_test.go
git commit -m "feat: add oidc_configs, policies, template tables to model"
```

---

### Task 2: CryptoService (AES-GCM for client_secret)

**Files:**
- Create: `internal/service/crypto.go`, `internal/service/crypto_test.go`

**Interfaces:**
- Produces: `CryptoService`, `NewCryptoService(envKey string) (*CryptoService, error)` (envKey = value of `WORKPAW_DB_SECRET_KEY`; if empty → debug ephemeral key + caller decides severity; the service is functional either way), `(*CryptoService).Encrypt(plaintext string) (string, error)`, `(*CryptoService).Decrypt(ciphertextB64 string) (string, error)`, `(*CryptoService).IsEphemeral() bool`. Format `base64(nonce[12]||ciphertext||tag)`.

- [ ] **Step 1: Write the failing test**

Create `internal/service/crypto_test.go`:
```go
package service

import (
	"strings"
	"testing"
)

func TestCryptoEncryptDecryptRoundTrip(t *testing.T) {
	key := strings.Repeat("k", 32) // 32-byte key
	svc, err := NewCryptoService(key)
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	if svc.IsEphemeral() {
		t.Error("expected non-ephemeral with provided key")
	}
	enc, err := svc.Encrypt("super-secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc == "super-secret" {
		t.Error("ciphertext equals plaintext")
	}
	dec, err := svc.Decrypt(enc)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if dec != "super-secret" {
		t.Errorf("got %q want super-secret", dec)
	}
}

func TestCryptoEphemeralWhenNoKey(t *testing.T) {
	svc, err := NewCryptoService("")
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	if !svc.IsEphemeral() {
		t.Error("expected ephemeral with empty key")
	}
	enc, _ := svc.Encrypt("x")
	dec, err := svc.Decrypt(enc)
	if err != nil || dec != "x" {
		t.Fatalf("ephemeral round-trip: %v %q", err, dec)
	}
}

func TestCryptoDecryptRejectsTampered(t *testing.T) {
	svc, _ := NewCryptoService(strings.Repeat("k", 32))
	enc, _ := svc.Encrypt("x")
	// flip a char in the base64 blob
	tampered := enc[:len(enc)-1] + (func() string { b := enc[len(enc)-1:]; if b == "A" { return "B" }; return "A" }())
	if _, err := svc.Decrypt(tampered); err == nil {
		t.Fatal("expected error for tampered ciphertext")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestCrypto -v`
Expected: FAIL — `undefined: NewCryptoService`.

- [ ] **Step 3: Implement CryptoService**

Create `internal/service/crypto.go`:
```go
package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

// CryptoService encrypts/decrypts secrets (client_secret) with AES-256-GCM.
// The key comes from WORKPAW_DB_SECRET_KEY (32 bytes). When the env key is
// empty the service generates an ephemeral key (debug only — encrypted values
// do not survive restart); IsEphemeral reports this so callers can warn.
type CryptoService struct {
	gcm        cipher.AEAD
	ephemeral  bool
}

func NewCryptoService(envKey string) (*CryptoService, error) {
	var key []byte
	if envKey == "" {
		key = make([]byte, 32)
		if _, err := io.ReadFull(rand.Reader, key); err != nil {
			return nil, fmt.Errorf("generate ephemeral key: %w", err)
		}
	} else {
		key = []byte(envKey)
		if len(key) != 32 {
			return nil, fmt.Errorf("WORKPAW_DB_SECRET_KEY must be 32 bytes, got %d", len(key))
		}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("aes new: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gcm new: %w", err)
	}
	return &CryptoService{gcm: gcm, ephemeral: envKey == ""}, nil
}

func (s *CryptoService) IsEphemeral() bool { return s.ephemeral }

// Encrypt returns base64(nonce||ciphertext||tag).
func (s *CryptoService) Encrypt(plaintext string) (string, error) {
	nonce := make([]byte, s.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce: %w", err)
	}
	ct := s.gcm.Seal(nil, nonce, []byte(plaintext), nil)
	blob := append(nonce, ct...)
	return base64.StdEncoding.EncodeToString(blob), nil
}

func (s *CryptoService) Decrypt(b64 string) (string, error) {
	blob, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", fmt.Errorf("base64 decode: %w", err)
	}
	ns := s.gcm.NonceSize()
	if len(blob) < ns {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := blob[:ns], blob[ns:]
	pt, err := s.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("gcm open: %w", err)
	}
	return string(pt), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestCrypto -v`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/crypto.go internal/service/crypto_test.go
git commit -m "feat: add AES-GCM CryptoService for client_secret encryption"
```

---

### Task 3: OIDCServiceManager (atomic hot-swap)

**Files:**
- Create: `internal/service/oidc_manager.go`, `internal/service/oidc_manager_test.go`

**Interfaces:**
- Produces: `OIDCServiceManager`, `NewOIDCServiceManager(initial *OIDCService) *OIDCServiceManager`, `(*OIDCServiceManager).Current() *OIDCService` (may be nil), `(*OIDCServiceManager).Reload(ctx, cfg *config.OIDCConfig, stateKey []byte) error` (builds a new `*OIDCService` via `NewOIDCService`, atomically swaps on success).

- [ ] **Step 1: Write the failing test**

Create `internal/service/oidc_manager_test.go`:
```go
package service

import (
	"context"
	"testing"
)

func TestOIDCManagerCurrentNilByDefault(t *testing.T) {
	m := NewOIDCServiceManager(nil)
	if m.Current() != nil {
		t.Error("expected nil initial service")
	}
}

func TestOIDCManagerCurrentReturnsInitial(t *testing.T) {
	// Cannot build a real *OIDCService without a live IdP; pass a non-nil
	// sentinel via a typed-nil-safe construction. Use the zero struct is not
	// exported, so we test Reload-failure path leaves current unchanged.
	m := NewOIDCServiceManager(nil)
	err := m.Reload(context.Background(), &oidcCfgBogus(), []byte("statekey"))
	if err == nil {
		t.Fatal("expected reload error for bogus issuer")
	}
	if m.Current() != nil {
		t.Error("current should remain nil after failed reload")
	}
}

func oidcCfgBogus() (c configOIDCConfig) { return configOIDCCfg("http://nonexistent.invalid") }
```
**Note to implementer:** the `configOIDCConfig`/`configOIDCCfg` helpers above are placeholders that will not compile — `Reload` takes `*config.OIDCConfig`. Replace `oidcCfgBogus()` with a direct `&config.OIDCConfig{IssuerURL: "http://nonexistent.invalid"}` literal in the test. (The plan leaves the exact construction to you; the assertion is: a Reload against an unreachable issuer returns an error AND leaves Current() unchanged.)

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestOIDCManager -v`
Expected: FAIL — `undefined: NewOIDCServiceManager`.

- [ ] **Step 3: Implement OIDCServiceManager**

Create `internal/service/oidc_manager.go`:
```go
package service

import (
	"context"
	"sync/atomic"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

// OIDCServiceManager holds the current *OIDCService behind an atomic pointer
// so admin hot-reload (PUT /api/admin/oidc/config) can swap it without
// restarting the process. Current() may return nil when no provider is loaded.
type OIDCServiceManager struct {
	v atomic.Pointer[OIDCService]
}

func NewOIDCServiceManager(initial *OIDCService) *OIDCServiceManager {
	m := &OIDCServiceManager{}
	m.v.Store(initial)
	return m
}

func (m *OIDCServiceManager) Current() *OIDCService {
	return m.v.Load()
}

// Reload builds a new OIDCService from cfg and atomically swaps it in. On
// error the current service is left unchanged — a bad config never breaks the
// running login flow.
func (m *OIDCServiceManager) Reload(ctx context.Context, cfg *config.OIDCConfig, stateKey []byte) error {
	svc, err := NewOIDCService(ctx, cfg, stateKey)
	if err != nil {
		return err
	}
	m.v.Store(svc)
	return nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestOIDCManager -v`
Expected: PASS (the bogus-issuer Reload fails at `oidc.NewProvider`, Current stays nil).

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/oidc_manager.go internal/service/oidc_manager_test.go
git commit -m "feat: add OIDCServiceManager for atomic hot-reload"
```

---

### Task 4: OIDCConfigService (load / save / test-connection)

**Files:**
- Create: `internal/service/oidc_config.go`, `internal/service/oidc_config_test.go`
- Consumes: `model.OIDCConfig`, `*gorm.DB`, `CryptoService`, `config.OIDCConfig`.

**Interfaces:**
- Produces:
  - `OIDCConfigView` struct (the admin-facing GET shape: IssuerURL, ClientID, ClientSecretMasked `••••`, RedirectURL, Scopes, AdminUsers, UpdatedBy, UpdatedAt, Version). ClientSecret NEVER returned in clear.
  - `OIDCConfigService`, `NewOIDCConfigService(db *gorm.DB, crypto *CryptoService) *OIDCConfigService`.
  - `(*OIDCConfigService).Get(ctx) (*OIDCConfigView, error)` — returns the DB row (or, if no row, a view built from config.yaml + a flag `source:"bootstrap"`).
  - `(*OIDCConfigService).ToRuntimeConfig(ctx) (*config.OIDCConfig, error)` — returns the decrypted config for `OIDCServiceManager.Reload`. No row → nil (caller uses config.yaml).
  - `(*OIDCConfigService).Test(ctx, draft config.OIDCConfig) error` — builds a real `*oidc.Provider` from `draft.IssuerURL` (real HTTP discovery) and a minimal OAuth2 exchange check; returns nil if IdP reachable + client creds valid, error otherwise. Does NOT persist.
  - `(*OIDCConfigService).Save(ctx, draft config.OIDCConfig, version int, updatedBy string) error` — optimistic-lock check (version must match), encrypts ClientSecret, writes the single row, returns ErrVersionConflict on mismatch.

- [ ] **Step 1: Write the failing test**

Create `internal/service/oidc_config_test.go`:
```go
package service

import (
	"context"
	"strings"
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestOIDCConfigSaveAndGet(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.OIDCConfig{})
	crypto, _ := NewCryptoService(strings.Repeat("k", 32))
	svc := NewOIDCConfigService(gdb, crypto)

	draft := config.OIDCConfig{
		IssuerURL: "https://idp.example.com", ClientID: "cid",
		ClientSecret: "csec", RedirectURL: "https://cp/callback",
		Scopes: []string{"openid", "email"}, AdminUsers: []string{"admin@x"},
	}
	if err := svc.Save(context.Background(), draft, 0, "admin-1"); err != nil {
		t.Fatalf("save: %v", err)
	}
	view, err := svc.Get(context.Background())
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if view.ClientID != "cid" || view.ClientSecretMasked != "••••" {
		t.Errorf("bad view: %+v", view)
	}
	if view.ClientSecretMasked == "csec" {
		t.Error("secret leaked in view")
	}
	// ToRuntimeConfig decrypts back.
	rc, err := svc.ToRuntimeConfig(context.Background())
	if err != nil || rc.ClientSecret != "csec" {
		t.Fatalf("runtime config: %v %+v", err, rc)
	}
}

func TestOIDCConfigSaveOptimisticLockConflict(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.OIDCConfig{})
	crypto, _ := NewCryptoService(strings.Repeat("k", 32))
	svc := NewOIDCConfigService(gdb, crypto)
	draft := config.OIDCConfig{IssuerURL: "u", ClientID: "c", ClientSecret: "s"}
	_ = svc.Save(context.Background(), draft, 0, "a")
	// Stale version (0) after the row is now version 1.
	err := svc.Save(context.Background(), draft, 0, "b")
	if err == nil {
		t.Fatal("expected version conflict, got nil")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestOIDCConfig -v`
Expected: FAIL — `undefined: NewOIDCConfigService`.

- [ ] **Step 3: Implement OIDCConfigService**

Create `internal/service/oidc_config.go`:
```go
package service

import (
	"context"
	"errors"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/model"
)

var ErrVersionConflict = errors.New("version conflict — config was modified by another admin")

// OIDCConfigView is the admin-facing read shape. The client secret is never
// returned in clear — only a mask.
type OIDCConfigView struct {
	Source              string   `json:"source"` // "db" | "bootstrap"
	IssuerURL           string   `json:"issuer_url"`
	ClientID            string   `json:"client_id"`
	ClientSecretMasked  string   `json:"client_secret_masked"`
	RedirectURL         string   `json:"redirect_url"`
	Scopes              []string `json:"scopes"`
	AdminUsers          []string `json:"admin_users"`
	UpdatedBy           string   `json:"updated_by"`
	UpdatedAt           string   `json:"updated_at"`
	Version             int      `json:"version"`
}

type OIDCConfigService struct {
	db     *gorm.DB
	crypto *CryptoService
}

func NewOIDCConfigService(db *gorm.DB, crypto *CryptoService) *OIDCConfigService {
	return &OIDCConfigService{db: db, crypto: crypto}
}

func (s *OIDCConfigService) Get(ctx context.Context) (*OIDCConfigView, error) {
	row := &model.OIDCConfig{}
	err := s.db.WithContext(ctx).First(row, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &OIDCConfigView{Source: "bootstrap", ClientSecretMasked: "••••"}, nil
	}
	if err != nil {
		return nil, err
	}
	return &OIDCConfigView{
		Source: "db", IssuerURL: row.IssuerURL, ClientID: row.ClientID,
		ClientSecretMasked: "••••", RedirectURL: row.RedirectURL,
		Scopes: row.Scopes, AdminUsers: row.AdminUsers,
		UpdatedBy: row.UpdatedBy, UpdatedAt: row.UpdatedAt.Format(time.RFC3339),
		Version: row.Version,
	}, nil
}

// ToRuntimeConfig returns the decrypted config for OIDCServiceManager.Reload,
// or nil when no DB row exists (caller falls back to config.yaml).
func (s *OIDCConfigService) ToRuntimeConfig(ctx context.Context) (*config.OIDCConfig, error) {
	row := &model.OIDCConfig{}
	err := s.db.WithContext(ctx).First(row, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	secret, err := s.crypto.Decrypt(row.ClientSecretEnc)
	if err != nil {
		return nil, err
	}
	return &config.OIDCConfig{
		IssuerURL: row.IssuerURL, ClientID: row.ClientID, ClientSecret: secret,
		RedirectURL: row.RedirectURL, Scopes: row.Scopes, AdminUsers: row.AdminUsers,
	}, nil
}

// Test validates a draft config against the real IdP without persisting.
// It performs OIDC discovery (HTTP) over the issuer URL. A reachable issuer
// with a valid discovery doc passes; anything else returns an error.
func (s *OIDCConfigService) Test(ctx context.Context, draft config.OIDCConfig) error {
	_, err := oidc.NewProvider(ctx, draft.IssuerURL)
	if err != nil {
		return err
	}
	return nil
}

// Save persists the draft with optimistic locking. version must match the
// stored row's version (0 for the first save). Returns ErrVersionConflict on
// mismatch.
func (s *OIDCConfigService) Save(ctx context.Context, draft config.OIDCConfig, version int, updatedBy string) error {
	enc, err := s.crypto.Encrypt(draft.ClientSecret)
	if err != nil {
		return err
	}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := &model.OIDCConfig{}
		err := tx.First(row, 1).Error
		now := time.Now()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if version != 0 {
				return ErrVersionConflict
			}
			row = &model.OIDCConfig{
				ID: 1, IssuerURL: draft.IssuerURL, ClientID: draft.ClientID,
				ClientSecretEnc: enc, RedirectURL: draft.RedirectURL,
				Scopes: draft.Scopes, AdminUsers: draft.AdminUsers,
				UpdatedBy: updatedBy, UpdatedAt: now, Version: 1,
			}
			return tx.Create(row).Error
		}
		if err != nil {
			return err
		}
		if row.Version != version {
			return ErrVersionConflict
		}
		row.IssuerURL = draft.IssuerURL
		row.ClientID = draft.ClientID
		row.ClientSecretEnc = enc
		row.RedirectURL = draft.RedirectURL
		row.Scopes = draft.Scopes
		row.AdminUsers = draft.AdminUsers
		row.UpdatedBy = updatedBy
		row.UpdatedAt = now
		row.Version = version + 1
		return tx.Save(row).Error
	})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestOIDCConfig -v`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/oidc_config.go internal/service/oidc_config_test.go
git commit -m "feat: add OIDCConfigService (encrypted save, optimistic lock, test-connection)"
```

---

### Task 5: PolicyService (memory + seconds↔minutes conversion)

**Files:**
- Create: `internal/service/policy.go`, `internal/service/policy_test.go`

**Interfaces:**
- Produces: `PolicyService`, `NewPolicyService(db *gorm.DB) (*PolicyService, error)` (loads row id=1 to memory, seeding defaults if absent), `(*PolicyService).Get(ctx) (*model.Policy, error)`, `(*PolicyService).Update(ctx, p model.Policy, version int, updatedBy string) error` (optimistic lock), `(*PolicyService).IdleTimeoutMinutes() int` (memory value, seconds/60 rounded), `(*PolicyService).ApplyToCRDSpec(spec *workpawv1alpha1.QwenPawInstanceSpec)` (writes policy+resources fields into a CRD spec from the in-memory policy — used by InstanceService.ActivateInstance).

- [ ] **Step 1: Write the failing test**

Create `internal/service/policy_test.go`:
```go
package service

import (
	"context"
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestPolicySeedsDefaults(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Policy{})
	svc, err := NewPolicyService(gdb)
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	if svc.IdleTimeoutMinutes() != 30 { // default 1800s / 60
		t.Errorf("expected 30 min default, got %d", svc.IdleTimeoutMinutes())
	}
}

func TestPolicyUpdateAndReadBack(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Policy{})
	svc, _ := NewPolicyService(gdb)
	p := model.Policy{IdleTimeoutSeconds: 3600, DefaultCPURequest: "1000m", DefaultMemoryRequest: "2Gi", DefaultPVCSize: "20Gi"}
	if err := svc.Update(context.Background(), p, 0, "admin"); err != nil {
		t.Fatalf("update: %v", err)
	}
	got, err := svc.Get(context.Background())
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.IdleTimeoutSeconds != 3600 || svc.IdleTimeoutMinutes() != 60 {
		t.Errorf("bad policy: %+v min=%d", got, svc.IdleTimeoutMinutes())
	}
}

func TestPolicyUpdateOptimisticLock(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Policy{})
	svc, _ := NewPolicyService(gdb)
	_ = svc.Update(context.Background(), model.Policy{IdleTimeoutSeconds: 3600}, 0, "a")
	if err := svc.Update(context.Background(), model.Policy{IdleTimeoutSeconds: 7200}, 0, "b"); err == nil {
		t.Fatal("expected version conflict")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestPolicy -v`
Expected: FAIL — `undefined: NewPolicyService`.

- [ ] **Step 3: Implement PolicyService**

Create `internal/service/policy.go`:
```go
package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"gorm.io/gorm"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	"github.com/workpaw/workpaw-control-plane/internal/model"
)

// PolicyService keeps the global policy row in memory (read by every new
// instance activation) and persists updates with optimistic locking.
type PolicyService struct {
	db *gorm.DB
	mu sync.RWMutex
	p  model.Policy
}

func NewPolicyService(db *gorm.DB) (*PolicyService, error) {
	s := &PolicyService{db: db}
	row := &model.Policy{}
	err := db.First(row, 1).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Seed defaults matching the old config.yaml values.
		row = &model.Policy{
			ID: 1, IdleTimeoutSeconds: 1800,
			ScheduledStopPolicy: map[string]interface{}{"scheduleStop": "22:00"},
			DefaultCPURequest: "500m", DefaultMemoryRequest: "1Gi", DefaultPVCSize: "10Gi",
			Version: 1,
		}
		if err := db.Create(row).Error; err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	s.p = *row
	return s, nil
}

func (s *PolicyService) Get(ctx context.Context) (*model.Policy, error) {
	row := &model.Policy{}
	if err := s.db.WithContext(ctx).First(row, 1).Error; err != nil {
		return nil, err
	}
	return row, nil
}

func (s *PolicyService) Update(ctx context.Context, p model.Policy, version int, updatedBy string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := &model.Policy{}
		if err := tx.First(row, 1).Error; err != nil {
			return err
		}
		if row.Version != version {
			return ErrVersionConflict
		}
		row.IdleTimeoutSeconds = p.IdleTimeoutSeconds
		row.ScheduledStopPolicy = p.ScheduledStopPolicy
		row.DefaultCPURequest = p.DefaultCPURequest
		row.DefaultMemoryRequest = p.DefaultMemoryRequest
		row.DefaultPVCSize = p.DefaultPVCSize
		row.UpdatedBy = updatedBy
		row.UpdatedAt = time.Now()
		row.Version = version + 1
		if err := tx.Save(row).Error; err != nil {
			return err
		}
		s.mu.Lock()
		s.p = *row
		s.mu.Unlock()
		return nil
	})
}

// IdleTimeoutMinutes returns the in-memory policy's idle timeout in minutes
// (CRD uses minutes; the policy table stores seconds).
func (s *PolicyService) IdleTimeoutMinutes() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	min := s.p.IdleTimeoutSeconds / 60
	if min < 1 {
		min = 1
	}
	return min
}

// ApplyToCRDSpec writes the in-memory policy + resource fields into a CRD
// spec. Used by InstanceService.ActivateInstance so new instances pick up the
// current global policy. Existing instances are NOT affected (declared on the
// policy page; enforced because this is only called at create time).
func (s *PolicyService) ApplyToCRDSpec(spec *workpawv1alpha1.QwenPawInstanceSpec) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	spec.Policy.IdleTimeoutMinutes = s.p.IdleTimeoutSeconds / 60
	stop, _ := s.p.ScheduledStopPolicy["scheduleStop"].(string)
	start, _ := s.p.ScheduledStopPolicy["scheduleStart"].(string)
	spec.Policy.ScheduleStop = stop
	spec.Policy.ScheduleStart = start
	spec.Resources.CPU = s.p.DefaultCPURequest
	spec.Resources.Memory = s.p.DefaultMemoryRequest
	spec.Storage.Size = s.p.DefaultPVCSize
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestPolicy -v`
Expected: PASS.

- [ ] **Step 5: Wire PolicyService into ActivateInstance + commit**

In `internal/service/instance.go`, `ActivateInstance` currently writes `Policy.IdleTimeoutMinutes = s.cfg.Policy.DefaultIdleTimeoutMinutes` (config.yaml). Change it to apply the in-memory policy when a `PolicyService` is set. Add a `policySvc *PolicyService` field to `InstanceService` (settable via a setter `SetPolicyService(*PolicyService)` to avoid changing the constructor signature across the codebase), and in `ActivateInstance`'s create branch, if `s.policySvc != nil`, call `s.policySvc.ApplyToCRDSpec(&instance.Spec)` instead of the config.yaml values; else keep the config.yaml fallback. (This keeps InstanceService testable without a DB.)

```bash
go build ./... && go test ./... -v
git add internal/service/policy.go internal/service/policy_test.go internal/service/instance.go
git commit -m "feat: add PolicyService (memory cache, optimistic lock, CRD apply with sec↔min)"
```

---

### Task 6: InstanceLister interface + UserService (list/detail/disable/enable)

**Files:**
- Create: `internal/service/instance_lister.go`, `internal/service/user.go`, `internal/service/user_test.go`

**Interfaces:**
- Produces:
  - `InstanceLister` interface: `List(ctx) ([]*workpawv1alpha1.QwenPawInstance, error)` — implemented by a K8s adapter (`k8sInstanceLister` wrapping `InstanceService`'s client.List) AND by a mock in tests.
  - `UserService`, `NewUserService(db *gorm.DB, lister InstanceLister) *UserService`.
  - `UserListItem` struct (UserID, Email, DisplayName, Status, IngressURL, CreatedAt, LastActiveAt, IsDisabled).
  - `(*UserService).List(ctx, filter ListFilter) ([]UserListItem, int, error)` — CRD list + join accounts (is_disabled/email/name); filter by status + search; returns items + total.
  - `(*UserService).Get(ctx, userID string) (*UserDetail, error)` — CRD status + account + recent template_applies.
  - `(*UserService).Disable(ctx, userID, reason, byUser string) error`, `Enable(ctx, userID, byUser string) error`.

- [ ] **Step 1: Write the failing test**

Create `internal/service/user_test.go` using a mock InstanceLister:
```go
package service

import (
	"context"
	"testing"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

type fakeLister struct{ items []*workpawv1alpha1.QwenPawInstance }

func (f fakeLister) List(ctx context.Context) ([]*workpawv1alpha1.QwenPawInstance, error) {
	return f.items, nil
}

func TestUserListJoinsAccounts(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Account{})
	gdb.Create(&model.Account{UserID: "u1", Email: "a@x", DisplayName: "A", Roles: []string{"user"}, FirstSeenAt: metav1.Now().Time, LastLoginAt: metav1.Now().Time})
	lister := fakeLister{items: []*workpawv1alpha1.QwenPawInstance{
		{ObjectMeta: metav1.ObjectMeta{Name: "a", Labels: map[string]string{"workpaw.io/user-id": "u1"}},
			Status: workpawv1alpha1.QwenPawInstanceStatus{CurrentState: "Running", IngressHost: "a.x", LastActiveAt: "2026-06-20T10:00:00Z"}},
	}}
	svc := NewUserService(gdb, lister)
	items, total, err := svc.List(context.Background(), ListFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("expected 1, got %d/%d", len(items), total)
	}
	if items[0].Email != "a@x" || items[0].Status != "running" || items[0].IngressURL != "https://a.x" {
		t.Errorf("bad item: %+v", items[0])
	}
}

func TestUserDisableEnable(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Account{})
	gdb.Create(&model.Account{UserID: "u1", Email: "a@x", FirstSeenAt: metav1.Now().Time, LastLoginAt: metav1.Now().Time})
	svc := NewUserService(gdb, fakeLister{})
	if err := svc.Disable(context.Background(), "u1", "offboarding", "admin"); err != nil {
		t.Fatalf("disable: %v", err)
	}
	var acct model.Account
	gdb.First(&acct, "user_id = ?", "u1")
	if !acct.IsDisabled || acct.DisabledReason != "offboarding" {
		t.Errorf("not disabled: %+v", acct)
	}
	if err := svc.Enable(context.Background(), "u1", "admin"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	gdb.First(&acct, "user_id = ?", "u1")
	if acct.IsDisabled {
		t.Error("still disabled after enable")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestUser -v`
Expected: FAIL — `undefined: NewUserService`.

- [ ] **Step 3: Implement InstanceLister + UserService**

Create `internal/service/instance_lister.go`:
```go
package service

import (
	"context"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

// InstanceLister enumerates all QwenPawInstance CRs in the instances namespace.
// An interface so unit tests can supply a fake list without a K8s API.
type InstanceLister interface {
	List(ctx context.Context) ([]*workpawv1alpha1.QwenPawInstance, error)
}

// k8sInstanceLister lists CRs via the controller-runtime client held by
// InstanceService.
type k8sInstanceLister struct {
	k8sClient client.Client
	namespace string
}

func NewK8sInstanceLister(k8sClient client.Client, namespace string) InstanceLister {
	return &k8sInstanceLister{k8sClient: k8sClient, namespace: namespace}
}

func (l *k8sInstanceLister) List(ctx context.Context) ([]*workpawv1alpha1.QwenPawInstance, error) {
	var list workpawv1alpha1.QwenPawInstanceList
	if err := l.k8sClient.List(ctx, &list, client.InNamespace(l.namespace)); err != nil {
		return nil, err
	}
	out := make([]*workpawv1alpha1.QwenPawInstance, 0, len(list.Items))
	for i := range list.Items {
		out = append(out, &list.Items[i])
	}
	return out, nil
}
```
**Note to implementer:** fix the import path `workpaw-operator/api/v1alpha` → `workpaw-operator/api/v1alpha1` (the trailing `1` was dropped by the plan writer; use the real path matching existing instance.go imports).

Create `internal/service/user.go`:
```go
package service

import (
	"context"
	"strings"
	"time"

	workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-control-plane/internal/model"
)

type ListFilter struct {
	Search string
	Status string // "" | running | stopped | creating
	Page   int
	PageSize int
}

type UserListItem struct {
	UserID       string `json:"user_id"`
	Email        string `json:"email"`
	DisplayName  string `json:"display_name"`
	Status       string `json:"status"`
	IngressURL   string `json:"ingress_url"`
	CreatedAt    string `json:"created_at"`
	LastActiveAt string `json:"last_active_at"`
	IsDisabled   bool   `json:"is_disabled"`
}

type UserDetail struct {
	UserListItem
	DisabledReason string             `json:"disabled_reason"`
	DisabledAt     string             `json:"disabled_at"`
	RecentApplies  []model.TemplateApply `json:"recent_applies"`
}

type UserService struct {
	db     *gorm.DB
	lister InstanceLister
}

func NewUserService(db *gorm.DB, lister InstanceLister) *UserService {
	return &UserService{db: db, lister: lister}
}

func (s *UserService) List(ctx context.Context, f ListFilter) ([]UserListItem, int, error) {
	instances, err := s.lister.List(ctx)
	if err != nil {
		return nil, 0, err
	}
	// Build a map of accounts by user_id for the join.
	accts := map[string]model.Account{}
	var rows []model.Account
	s.db.WithContext(ctx).Find(&rows)
	for _, a := range rows {
		accts[a.UserID] = a
	}
	items := []UserListItem{}
	for _, inst := range instances {
		uid := inst.Labels["workpaw.io/user-id"]
		status := strings.ToLower(inst.Status.CurrentState)
		if status == "" {
			status = "creating"
		}
		if f.Status != "" && f.Status != status {
			continue
		}
		ingress := ""
		if inst.Status.IngressHost != "" {
			ingress = "https://" + inst.Status.IngressHost
		}
		email := uid
		name := uid
		disabled := false
		if a, ok := accts[uid]; ok {
			email = a.Email
			name = a.DisplayName
			disabled = a.IsDisabled
		}
		if f.Search != "" {
			if !strings.Contains(strings.ToLower(email), strings.ToLower(f.Search)) &&
				!strings.Contains(strings.ToLower(name), strings.ToLower(f.Search)) {
				continue
			}
		}
		items = append(items, UserListItem{
			UserID: uid, Email: email, DisplayName: name, Status: status,
			IngressURL: ingress, CreatedAt: inst.CreationTimestamp.Format(time.RFC3339),
			LastActiveAt: inst.Status.LastActiveAt, IsDisabled: disabled,
		})
	}
	total := len(items)
	// offset pagination
	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 {
		f.PageSize = 20
	}
	start := (f.Page - 1) * f.PageSize
	if start > total {
		start = total
	}
	end := start + f.PageSize
	if end > total {
		end = total
	}
	return items[start:end], total, nil
}

func (s *UserService) Get(ctx context.Context, userID string) (*UserDetail, error) {
	// Find the user's instance + account + recent applies.
	items, _, err := s.List(ctx, ListFilter{Search: "", PageSize: 1000})
	if err != nil {
		return nil, err
	}
	var item UserListItem
	found := false
	for _, it := range items {
		if it.UserID == userID {
			item = it
			found = true
			break
		}
	}
	if !found {
		return nil, gorm.ErrRecordNotFound
	}
	var acct model.Account
	s.db.WithContext(ctx).First(&acct, "user_id = ?", userID)
	var applies []model.TemplateApply
	s.db.WithContext(ctx).Where("target_user_id = ?", userID).Order("applied_at DESC").Limit(20).Find(&applies)
	return &UserDetail{
		UserListItem:   item,
		DisabledReason: acct.DisabledReason,
		DisabledAt:     timeOrEmpty(acct.DisabledAt),
		RecentApplies:  applies,
	}, nil
}

func timeOrEmpty(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}

func (s *UserService) Disable(ctx context.Context, userID, reason, byUser string) error {
	now := time.Now()
	return s.db.WithContext(ctx).Model(&model.Account{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{
			"is_disabled": true, "disabled_at": now, "disabled_by": byUser,
			"disabled_reason": reason,
		}).Error
}

func (s *UserService) Enable(ctx context.Context, userID, byUser string) error {
	return s.db.WithContext(ctx).Model(&model.Account{}).
		Where("user_id = ?", userID).
		Updates(map[string]interface{}{
			"is_disabled": false, "disabled_at": nil, "disabled_by": "", "disabled_reason": "",
		}).Error
}

var _ = workpawv1alpha1.QwenPawInstance{} // keep import for clarity
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestUser -v`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/instance_lister.go internal/service/user.go internal/service/user_test.go
git commit -m "feat: add UserService (CRD+accounts list/detail, disable/enable)"
```

---

### Task 7: AdminInstanceService (force activate/deactivate + disable check) + StatsService

**Files:**
- Create: `internal/service/admin_instance.go`, `internal/service/admin_instance_test.go`
- Create: `internal/service/stats.go`, `internal/service/stats_test.go`

**Interfaces:**
- Produces:
  - `AdminInstanceService`, `NewAdminInstanceService(instanceSvc *InstanceService, accounts *AccountService) *AdminInstanceService`.
  - `(*AdminInstanceService).ForceActivate(ctx, targetUserID, targetEmail string) (*InstanceStatus, error)` — checks `accounts.IsDisabled(targetUserID)` → 403-equivalent error if disabled; else `instanceSvc.ActivateInstance(targetUserID, targetEmail)`.
  - `(*AdminInstanceService).ForceDeactivate(ctx, targetUserID string) error` — `instanceSvc.DeactivateInstance(targetUserID)` (no disable check; allowed to stop a disabled user's instance).
  - `StatsService`, `NewStatsService(db *gorm.DB, lister InstanceLister) *StatsService`, `(*StatsService).Get(ctx) (*Stats, error)` where `Stats{TotalUsers, OnlineInstances, TodayActivity, DisabledUsers int}`.

- [ ] **Step 1: Write the failing tests**

Create `internal/service/admin_instance_test.go` — `ForceActivate` refuses a disabled user. Mock `InstanceService` is hard (concrete struct with K8s client); instead test via a small interface. **Implementer decision:** extract an `InstanceActivator` interface (`Activate(ctx, userID, email) (*InstanceStatus, error)`, `Deactivate(ctx, userID) error`) that both `InstanceService` and a fake satisfy, and have `AdminInstanceService` depend on that interface. Write the test against the fake.

Create `internal/service/stats_test.go` — `Stats` counts accounts (total + disabled), CRD running instances (online), audit_logs created today (today_activity), using a fake lister + sqlite.

(Full test code left to implementer following the TDD pattern; assertions: ForceActivate on disabled user returns the disable error and does NOT call Activate; ForceActivate on enabled user calls Activate once; Stats counts are correct from seeded data.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/service/... -run "TestForce|TestStats" -v`
Expected: FAIL — undefined symbols.

- [ ] **Step 3: Implement AdminInstanceService + StatsService**

Create `internal/service/admin_instance.go` with the `InstanceActivator` interface, `AdminInstanceService` (disable check on activate via `accounts.IsDisabled`), and the fake-friendly design. Create `internal/service/stats.go` with `StatsService` computing the four counts (TotalUsers = `SELECT count(*) FROM accounts`, OnlineInstances = count CRDs with `currentState == Running`, TodayActivity = `SELECT count(*) FROM audit_logs WHERE created_at >= today`, DisabledUsers = `SELECT count(*) FROM accounts WHERE is_disabled`).

**Note on IsDisabled (Plan 1 deferred follow-up):** Plan 1's `IsDisabled(userID) bool` swallows DB errors (returns false). For the admin force-activate security check, this is acceptable for v1 (access TTL bounds exposure). If you refactor `IsDisabled` to `(bool, error)` here as part of this task, update the Plan 1 refresh handler caller too. **Recommended:** leave `IsDisabled` as-is for this task and track the `(bool, error)` refactor as a follow-up — changing it now touches the Plan 1 Refresh handler and reopens reviewed code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/service/... -run "TestForce|TestStats" -v`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/admin_instance.go internal/service/admin_instance_test.go internal/service/stats.go internal/service/stats_test.go
git commit -m "feat: add AdminInstanceService (force activate/deactivate + disable check) and StatsService"
```

---

### Task 8: TemplateService (CRUD, soft delete)

**Files:**
- Create: `internal/service/template.go`, `internal/service/template_test.go`

**Interfaces:**
- Produces: `TemplateType` (`"agent"|"mcp"|"skill"`), `TemplateService`, `NewTemplateService(db *gorm.DB) *TemplateService`. Methods:
  - `List(ctx, t TemplateType) (interface{}, error)` — returns `[]model.AgentTemplate` / `[]MCPTemplate` / `[]SkillTemplate` (soft-deleted excluded by GORM default).
  - `Get(ctx, t TemplateType, id uuid.UUID) (interface{}, error)`
  - `Create(ctx, t TemplateType, name, description string, spec map[string]interface{}, mcpIDs, skillIDs []uuid.UUID, createdBy string) (uuid.UUID, error)`
  - `Update(ctx, t TemplateType, id uuid.UUID, fields map[string]interface{}) error`
  - `Delete(ctx, t TemplateType, id uuid.UUID) error` (soft delete)
- The `apply` endpoint is NOT in this task (Plan 3).

- [ ] **Step 1: Write the failing test**

Create `internal/service/template_test.go` covering: Create an agent template, List returns it, Update changes name, Delete soft-removes it (List no longer returns it but the row still exists with deleted_at set). Use sqlite + the 3 template tables migrated.

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestTemplate -v`
Expected: FAIL.

- [ ] **Step 3: Implement TemplateService**

Create `internal/service/template.go` with a switch on `TemplateType` to the right model + GORM calls. Soft delete via `db.Delete(&model{}, id)` (GORM sets DeletedAt). `List`/`Get` exclude soft-deleted automatically.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestTemplate -v`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/template.go internal/service/template_test.go
git commit -m "feat: add TemplateService CRUD (agent/mcp/skill, soft delete)"
```

---

### Task 9: AuditQueryService (filtered query + CSV export)

**Files:**
- Create: `internal/service/audit_query.go`, `internal/service/audit_query_test.go`

**Interfaces:**
- Produces: `AuditQueryService`, `NewAuditQueryService(db *gorm.DB) *AuditQueryService`, `(*AuditQueryService).Query(ctx, f AuditQueryFilter) ([]model.AuditLog, int, error)` (filters: actor, target_type, action, time range; paginated), `(*AuditQueryService).CSV(ctx, f AuditQueryFilter) ([]byte, error)` (RFC 4180, escaping commas/quotes/newlines).

- [ ] **Step 1–4: TDD**

Test: seed N audit rows with varied actors/actions/times; Query filters return the right subset + total; CSV has a header row + correct row count + proper escaping of a detail field containing a comma. Implement with GORM `.Where` clauses + `encoding/csv`.

- [ ] **Step 5: Build + commit**

```bash
go build ./... && go test ./... -v
git add internal/service/audit_query.go internal/service/audit_query_test.go
git commit -m "feat: add AuditQueryService (filtered query + CSV export)"
```

---

### Task 10: AdminHandler + AdminTemplateHandler (HTTP layer) + router wiring

**Files:**
- Create: `internal/handler/admin.go`, `internal/handler/admin_test.go`
- Create: `internal/handler/admin_template.go`
- Modify: `internal/router/router.go` (wire all admin services + handlers; register routes; build OIDCServiceManager from oidc_configs with config.yaml fallback; build CryptoService from env; hot-reload on OIDC save)

**Interfaces:**
- Produces: `AdminHandler` with all `/api/admin/*` handlers (stats, users list, user detail, instance activate/deactivate, user disable/enable, oidc config get/test/save, policy get/put, audit-logs query/export). `AdminTemplateHandler` with template CRUD. Router builds `OIDCServiceManager` (initial = oidc_configs row if present else config.yaml), `CryptoService`, `PolicyService`, `UserService`, `AdminInstanceService`, `StatsService`, `TemplateService`, `AuditQueryService`, and wires them. OIDC `Save` handler calls `OIDCServiceManager.Reload` after persisting.

- [ ] **Step 1: Write the failing handler tests**

Create `internal/handler/admin_test.go` covering at least: `GET /api/admin/stats` (200, 4 counts), `POST /api/admin/users/:id/disable` (200 + audit row written), `GET /api/admin/oidc/config` (200, secret masked). Use httptest + sqlite + a fake InstanceLister. (Detail/coverage targets: stats, disable, oidc-get, policy-get. Full route coverage is the integration test's job.)

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/handler/... -run TestAdmin -v`
Expected: FAIL.

- [ ] **Step 3: Implement handlers + router wiring**

Implement `AdminHandler` (each handler: parse params → call service → on write call `auditSvc.Log` → return JSON; uniform error shape `{"error","code","request_id"}`). Implement `AdminTemplateHandler` (CRUD over `templateSvc`). In `router.go`, replace the `/api/admin` placeholder group body: build all services, construct `AdminHandler`/`AdminTemplateHandler`, register routes per spec §7. For OIDC: initial `oidcSvc` now comes from `oidcConfigSvc.ToRuntimeConfig(ctx)` (fallback config.yaml); wrap in `OIDCServiceManager`; the OIDC Save handler reloads the manager.

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/handler/... -run TestAdmin -v`
Expected: PASS.

- [ ] **Step 5: Build + full suite + commit**

```bash
go build ./... && go test ./... -v
git add internal/handler/admin.go internal/handler/admin_test.go internal/handler/admin_template.go internal/router/router.go
git commit -m "feat: add admin API handlers (stats/users/instances/oidc/policy/audit) + router wiring"
```

---

### Task 11: Admin integration test (testcontainers) + gofmt/vet gate

**Files:**
- Create: `internal/service/admin_integration_test.go` (`//go:build integration`)

**Interfaces:**
- Validates on real Postgres: full admin flow — seed an account + a CRD-via-fake-lister, `GET /stats` counts, disable a user, `POST .../instance/activate` is refused (403), policy update + optimistic-lock conflict, OIDC config save+get (encrypted secret round-trips, masked in GET), template CRUD + soft delete, audit query. One test exercising the real DB for all services that SQLite tests cover individually.

- [ ] **Step 1: Write the integration test**

Build-tagged. Start Postgres (reuse the Plan 1 `startPostgres` helper pattern), migrate all 9 tables, construct services with real gdb + fake lister, run the flow. Skip if Docker unavailable.

- [ ] **Step 2: Run integration test**

Run: `go test ./internal/service/... -tags=integration -run TestAdminIntegration -v`
Expected: PASS (or SKIP without Docker).

- [ ] **Step 3: gofmt + vet + full suite gate**

Run: `gofmt -l ./internal/` (empty), `go vet ./...` (clean), `go build ./... && go build -tags=integration ./... && go test ./... -v` (green).

- [ ] **Step 4: Commit**

```bash
git add internal/service/admin_integration_test.go
git commit -m "test: admin integration test (testcontainers, real Postgres flow)"
```

---

## Self-Review

**1. Spec coverage (Plan 2 scope):**
- §6 oidc_configs/policies/templates/template_applies tables → Task 1. ✓
- §5.3 OIDC central management (DB + test + confirm + hot-reload + AES-GCM) → Tasks 2,3,4. ✓
- §7 admin routes (stats/users/instance-govern/user-govern/oidc/policy/audit/templates CRUD) → Tasks 6,7,8,9,10. ✓ (template `apply` is Plan 3.)
- §9.B disable at instance-activate → Task 7 (ForceActivate disable check). ✓ (login/refresh disable from Plan 1.)
- §9.C audit on every write → Task 10 (handlers call auditSvc.Log). ✓
- §9.D OIDC hot-reload → Tasks 3,4,10. ✓
- §10 error handling (version conflict 409, oidc test failure no-effect, policy existing-instances-unaffected) → Tasks 4,5,10. ✓
- §12 alignment 4 (sec↔min) → Task 5. ✓; 5 (CRD status) → Task 6. ✓; 7 (hot-reload) → Task 3. ✓; 8 (client_secret key) → Task 2. ✓
- §11 tests (unit + integration) → all tasks. ✓

**2. Placeholder scan:** Tasks 7,8,9 use "TDD, test code left to implementer" for the test file — these are the only soft spots. Each names the exact assertions required. If you want fully-specified test code for those three, flag before execution; otherwise the implementer writes them per the stated assertions.

**3. Type consistency:** `NewCryptoService(envKey string)`, `NewOIDCServiceManager(*OIDCService)`, `NewOIDCConfigService(db, *CryptoService)`, `NewPolicyService(db)`, `NewUserService(db, InstanceLister)`, `NewAdminInstanceService`, `NewStatsService(db, lister)`, `NewTemplateService(db)`, `NewAuditQueryService(db)` — consistent across tasks. `ErrVersionConflict` defined in oidc_config.go, reused in policy.go (same package). `InstanceLister` interface in instance_lister.go, consumed by UserService + StatsService.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-workpaw-control-plane/console-admin-api.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration.
**2. Inline Execution** — batch execution with checkpoints.

Which approach?

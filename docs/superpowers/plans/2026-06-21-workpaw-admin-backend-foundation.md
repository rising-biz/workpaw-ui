# workpaw-control-plane/console Backend Foundation Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce PostgreSQL into workpaw-control-plane and refactor authentication into a unified, three-end-shared system (JWT RS256 + JWKS + refresh tokens + account registry with disable enforcement), validated against the spec's 8 alignment points.

**Architecture:** control-plane (Go/Gin) gains a GORM-backed PostgreSQL layer; HS256 access tokens are upgraded to RS256 with a JWKS endpoint so desktop/web/admin can independently verify; login upserts an `accounts` row and refuses disabled users; refresh tokens are opaque, hashed, stored in PostgreSQL, revocable on logout. OIDC central management (DB-backed, admin-editable, hot-reload) is deferred to Plan 2; Plan 1 keeps reading OIDC from config.yaml as today.

**Tech Stack:** Go 1.26, Gin 1.12, GORM + `gorm.io/driver/postgres`, `github.com/glebarez/sqlite` (in-memory unit tests), `github.com/testcontainers/testcontainers-go` (Postgres integration test), `github.com/golang-jwt/jwt/v5` (RS256), coreos/go-oidc v3 (unchanged).

## Global Constraints

- Go stack: Gin, Zap, Viper, Cobra — no new web framework.
- PostgreSQL is the only database; access via GORM. `gorm:"serializer:json"` for slice/map columns (driver-agnostic: text on SQLite tests, text on Postgres v1).
- QwenPaw v1.1.12 — unchanged, not touched in this plan.
- Access tokens: **RS256** (replaces HS256). OIDC state tokens stay HMAC-HS256 signed with `jwt.secret`. Three ends verify access tokens via `GET /.well-known/jwks.json`.
- Access TTL stays `jwt.expire_hours` (default 24h) for Plan 1 — frontends do not yet refresh (Plan 3), so a short TTL would log users out. Refresh tokens: 7d (`jwt.refresh_expire_days`). Plan 3 shortens access TTL to 15min once frontends refresh.
- Bearer JWT in `Authorization` header; no cookie session; no CSRF.
- v1 single-tenant; v1 admin/non-admin binary roles only (`AdminOnly` middleware unchanged).
- All commands run from `workpaw-control-plane/` unless noted. Each task ends with a commit.
- Commit message style: `feat:`/`refactor:`/`test:`/`chore:` prefix, lowercase.

## Spec reference

- Design spec: `docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-design.md` (§5 统一认证设计, §6 数据模型, §12 实现前对齐点).
- This plan covers spec §4 v1 rows: "统一认证扩展" and the foundation for "OIDC 配置集中管理" (the admin-editable part is Plan 2). It does NOT implement admin API endpoints (Plan 2), template push (Plan 3), or frontend (Plan 3).

## File Structure

**Create:**
- `internal/db/db.go` — `New(cfg) (*gorm.DB, error)` (opens postgres, pings).
- `internal/model/model.go` — `Account`, `RefreshToken`, `AuditLog` structs + `Migrate(gdb)`.
- `internal/testutil/db.go` — `NewTestDB(t, models...) *gorm.DB` (SQLite in-memory).
- `internal/service/audit.go` — `AuditService` + `Log(...)`.
- `internal/service/key.go` — `KeyService` (RS256 private key, kid, JWKS).
- `internal/service/account.go` — `AccountService` + `UpsertOnLogin` + `ErrAccountDisabled`.
- `internal/service/refresh.go` — `RefreshService` (Issue/Validate/RevokeAll).
- `internal/handler/health.go` — `HealthHandler` (db/k8s/oidc).
- `docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-alignment-findings.md` — Task 1 output.

**Modify:**
- `internal/config/config.go` — extend `JWTConfig` (`PrivateKeyPath`, `RefreshExpireDays`); keep `Secret` (state HMAC) and `ExpireHours`.
- `internal/service/jwt.go` — HS256 → RS256; `GenerateToken` → `GenerateAccessToken`; `NewJWTService` takes `*KeyService`.
- `internal/handler/auth.go` — Callback (account upsert + disable check + issue access+refresh + audit), DevLogin (access+refresh), new `Refresh` + `Logout` handlers.
- `internal/router/router.go` — wire DB, KeyService, AccountService, RefreshService, AuditService; add `/api/auth/refresh`, `/.well-known/jwks.json`; replace `/health` stub with `HealthHandler`.
- `config.yaml` — add `jwt.private_key_path`, `jwt.refresh_expire_days`.

---

### Task 1: Alignment investigation

**Files:**
- Read: `workpaw-ui/src/**`, `workpaw-web/src/**` (Agent/MCP/Skill types, Pod config API calls)
- Read: `workpaw-control-plane/internal/service/instance.go` (GetConnectInfo), `workpaw-operator/api/v1alpha1/*` (CRD spec/status)
- Read: `workpaw-control-plane/internal/service/oidc.go`, `internal/service/jwt.go`
- Create: `docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-alignment-findings.md`

**Interfaces:**
- Produces: a findings doc that unblocks Plan 2 (OIDC hot-reload, client_secret encryption) and Plan 3 (template `spec` fields, Pod config API contract, CRD status fields, three-end JWT verification libs). Plan 1 tasks below bake in the decisions for alignment point 6 (RS256 key source); if Task 1 contradicts those, update Tasks 4 before implementing.

This is an investigation task, not TDD. Its deliverable is the findings doc.

- [ ] **Step 1: Investigate template `spec` fields (alignment point 1)**

Read workpaw-ui and workpaw-web for Agent / MCP / Skill type definitions and the Pod config API calls workpaw-web makes (paths + request body fields). Run:
```bash
grep -rn "agent\|mcp\|skill" workpaw-ui/src --include="*.ts" -il | head -20
grep -rn "agent\|mcp\|skill" workpaw-web/src --include="*.ts" --include="*.tsx" -il | head -20
```
Record in the findings doc: the exact TypeScript interfaces for Agent/MCP/Skill, and the exact Pod config API paths + HTTP methods + body fields workpaw-web uses to create/update them.

- [ ] **Step 2: Investigate Pod privilege token (alignment point 2)**

Confirm `GetConnectInfo` in `internal/service/instance.go:240` reads `qwenpaw-token-{name}` Secret key `api-token`, and that this token is the same one workpaw-web uses to authorize Pod config API writes (Bearer). Record the Pod config API auth scheme.

- [ ] **Step 3: Investigate CRD spec/status fields (alignment points 4, 5)**

Read `workpaw-operator/api/v1alpha1/*.go` (the `QwenPawInstance`, `QwenPawInstanceSpec`, `QwenPawInstanceStatus`, `PolicySpec` types). Record: which `spec` fields carry resource limits / idle timeout / schedule stop (for Plan 2 `policies` → CRD write), and whether `status` exposes `LastActiveAt` / `CurrentState` / `IngressHost` (for Plan 2 user list + Plan 3 "last active"). If `status` lacks `LastActiveAt`, note that Plan 2 must derive "last active" from audit logs.

- [ ] **Step 4: Investigate RS256 key source (alignment point 6)**

Decide and record: RS256 private key loaded from PEM file at `jwt.private_key_path`; in debug mode, if unset, generate an ephemeral 2048-bit RSA key in memory (tokens invalidate on restart — acceptable for dev). kid = first 16 chars of base64url(sha256(SPKI of public key)). Three-end verification: web/admin (JS) use `jose` or `jwt-decode` with the JWKS endpoint; desktop (Tauri) uses the same JS lib in the webview — selection is a Plan 3 task. Record this decision; it is what Tasks 4 below implement.

- [ ] **Step 5: Investigate OIDC hot-reload + client_secret key (alignment points 7, 8)**

Read `internal/service/oidc.go` `NewOIDCService` (uses `coreos/go-oidc` `oidc.NewProvider`). Confirm that hot-reload = rebuild the `*OIDCService` instance (new provider from new issuer) and atomically swap the active one in an `OIDCServiceManager`. Record that client_secret will be AES-GCM encrypted with key from env `WORKPAW_DB_SECRET_KEY`. Both are Plan 2 — record only, do not implement.

- [ ] **Step 6: Write the findings doc**

Create `docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-alignment-findings.md` with one section per alignment point (1–8) containing: what was checked, the files read, the conclusion, and which plan/task it unblocks. Use real field names and paths — no placeholders.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-workpaw-control-plane/console-alignment-findings.md
git commit -m "docs: record workpaw-control-plane/console alignment findings (8 points)"
```

---

### Task 2: PostgreSQL + GORM foundation

**Files:**
- Create: `internal/db/db.go`, `internal/db/db_test.go`
- Create: `internal/model/model.go`, `internal/model/model_test.go`
- Create: `internal/testutil/db.go`
- Modify: `internal/router/router.go`, `config.yaml`
- Modify: `go.mod` (via `go get`)

**Interfaces:**
- Produces: `db.New(cfg *config.PostgresConfig) (*gorm.DB, error)`; `model.Migrate(gdb *gorm.DB) error`; `model.Account`, `model.RefreshToken`, `model.AuditLog`; `testutil.NewTestDB(t, models...) *gorm.DB`. Router connects DB on startup and runs `model.Migrate`.

- [ ] **Step 1: Add dependencies**

Run from `workpaw-control-plane/`:
```bash
go get gorm.io/gorm@latest
go get gorm.io/driver/postgres@latest
go get github.com/glebarez/sqlite@latest
go mod tidy
```
Expected: `go.mod` gains `gorm.io/gorm`, `gorm.io/driver/postgres`, `github.com/glebarez/sqlite` (and transitive deps). `go build ./...` still succeeds.

- [ ] **Step 2: Write the failing model test**

Create `internal/model/model_test.go`:
```go
package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestMigrateCreatesTables(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := Migrate(gdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, name := range []string{"accounts", "refresh_tokens", "audit_logs"} {
		if !gdb.Migrator().HasTable(name) {
			t.Errorf("table %s not created", name)
		}
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/model/... -run TestMigrateCreatesTables -v`
Expected: FAIL — `undefined: Migrate`.

- [ ] **Step 4: Write the models + Migrate**

Create `internal/model/model.go`:
```go
package model

import (
	"time"

	"gorm.io/gorm"
)

// Account is the user registry row, upserted on each successful OIDC login.
type Account struct {
	UserID         string     `gorm:"primaryKey"`
	Email          string
	DisplayName    string
	Roles          []string   `gorm:"serializer:json"`
	IsDisabled     bool
	DisabledAt     *time.Time
	DisabledBy     string
	DisabledReason string
	FirstSeenAt    time.Time
	LastLoginAt    time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// RefreshToken stores the hash of an opaque refresh token. The raw token is
// never persisted.
type RefreshToken struct {
	TokenHash string    `gorm:"primaryKey"`
	UserID    string    `gorm:"index"`
	ExpiresAt time.Time
	RevokedAt *time.Time `gorm:"index"`
	CreatedAt time.Time
	UserAgent string
	IP        string
}

// AuditLog is the append-only audit trail for admin write operations.
type AuditLog struct {
	ID          int64                  `gorm:"primaryKey;autoIncrement"`
	ActorUserID string                 `gorm:"index"`
	ActorName   string
	ActorEmail  string
	Action      string                 `gorm:"index"`
	TargetType  string                 `gorm:"index"`
	TargetID    string                 `gorm:"index"`
	TargetName  string
	Detail      map[string]interface{} `gorm:"serializer:json"`
	IP          string
	UserAgent   string
	RequestID   string                 `gorm:"index"`
	CreatedAt   time.Time              `gorm:"index"`
}

// Migrate creates all Plan 1 tables if absent.
func Migrate(gdb *gorm.DB) error {
	return gdb.AutoMigrate(&Account{}, &RefreshToken{}, &AuditLog{})
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/model/... -run TestMigrateCreatesTables -v`
Expected: PASS.

- [ ] **Step 6: Write the failing db.New test**

Create `internal/db/db_test.go`:
```go
package db

import (
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

func TestNewFailsOnUnreachableHost(t *testing.T) {
	_, err := New(&config.PostgresConfig{
		Host: "nonexistent.invalid", Port: 5432,
		Database: "x", User: "x", Password: "x",
	})
	if err == nil {
		t.Fatal("expected error for unreachable host, got nil")
	}
}
```

- [ ] **Step 7: Run test to verify it fails**

Run: `go test ./internal/db/... -run TestNewFailsOnUnreachableHost -v`
Expected: FAIL — `undefined: New`.

- [ ] **Step 8: Implement db.New**

Create `internal/db/db.go`:
```go
package db

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

// New opens a GORM connection to Postgres and pings it. Returns an error if the
// database is unreachable so startup fails fast rather than at first query.
func New(cfg *config.PostgresConfig) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=disable TimeZone=Asia/Shanghai",
		cfg.Host, cfg.Port, cfg.User, cfg.Password, cfg.Database,
	)
	gdb, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, fmt.Errorf("get *sql.DB: %w", err)
	}
	if err := sqlDB.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return gdb, nil
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `go test ./internal/db/... -run TestNewFailsOnUnreachableHost -v`
Expected: PASS (after a brief DNS/conn failure).

- [ ] **Step 10: Create the test DB helper**

Create `internal/testutil/db.go`:
```go
package testutil

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// NewTestDB returns an in-memory SQLite GORM DB with the given models migrated.
// Use it for fast, Docker-free service unit tests.
func NewTestDB(t *testing.T, models ...interface{}) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.AutoMigrate(models...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return gdb
}
```

- [ ] **Step 11: Wire DB into the router**

In `internal/router/router.go`, after `gin.Recovery()` and before the health stub, add DB connection + migrate. Replace the existing `/health` stub (line ~31-33) — leave a basic stub for now; Task 7 replaces it with the full health handler.

Add to `Setup` (insert after the `jwtSvc` line, before `var oidcSvc`):
```go
	// PostgreSQL (gracefully degrade if unreachable; admin/audit need it)
	var gdb *gorm.DB
	if g, err := db.New(&cfg.Postgres); err != nil {
		logger.Warn("Postgres unreachable, admin/audit/auth-refresh will fail",
			zap.Error(err))
	} else {
		if err := model.Migrate(g); err != nil {
			logger.Warn("Postgres migrate failed", zap.Error(err))
		} else {
			gdb = g
			logger.Info("Postgres connected and migrated")
		}
	}
```
Add imports `"github.com/workpaw/workpaw-control-plane/internal/db"` and `"github.com/workpaw/workpaw-control-plane/internal/model"` to router.go. Pass `gdb` into later tasks' services (Task 3+ wires them). For now, `gdb` is declared and used by nothing yet — that is fine; Go allows unused package-level vars but not unused locals. To avoid a compile error, reference it: change the health stub to report DB presence:
```go
	r.GET("/health", func(c *gin.Context) {
		status := "ok"
		if gdb == nil {
			status = "degraded"
		}
		c.JSON(200, gin.H{"status": status, "db": gdb != nil})
	})
```

- [ ] **Step 12: Add config defaults**

In `internal/config/config.go` `Load()`, add defaults near the existing jwt default:
```go
	viper.SetDefault("jwt.refresh_expire_days", 7)
```
Extend `JWTConfig`:
```go
type JWTConfig struct {
	Secret            string `mapstructure:"secret"`              // HMAC key for OIDC state tokens
	PrivateKeyPath    string `mapstructure:"private_key_path"`    // RS256 private key PEM (access token signing)
	ExpireHours       int    `mapstructure:"expire_hours"`        // access token TTL (hours)
	RefreshExpireDays int    `mapstructure:"refresh_expire_days"` // refresh token TTL (days)
}
```
In `config.yaml`, under `jwt:`, add:
```yaml
  private_key_path: ""   # RS256 PEM path; empty in debug → ephemeral key
  refresh_expire_days: 7
```

- [ ] **Step 13: Build and run all tests**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all tests pass (existing `auth_test.go`, `oidc_test.go`, plus new model/db tests).

- [ ] **Step 14: Commit**

```bash
git add internal/db internal/model internal/testutil internal/router/router.go internal/config/config.go config.yaml go.mod go.sum
git commit -m "feat: add postgres/gorm foundation with accounts, refresh_tokens, audit_logs"
```

---

### Task 3: AuditService

**Files:**
- Create: `internal/service/audit.go`, `internal/service/audit_test.go`

**Interfaces:**
- Consumes: `model.AuditLog`, `*gorm.DB`, `*WorkPawClaims` (from jwt.go).
- Produces: `AuditService`, `NewAuditService(db *gorm.DB) *AuditService`, `AuditEntry` struct, `(*AuditService).Log(actor *WorkPawClaims, e AuditEntry, ip, ua, requestID string)`. Best-effort write (errors logged, not returned) so audit never blocks the operation.

- [ ] **Step 1: Write the failing test**

Create `internal/service/audit_test.go`:
```go
package service

import (
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestAuditLogWritesRow(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.AuditLog{})
	svc := NewAuditService(gdb)

	claims := &WorkPawClaims{UserID: "u1", Name: "Alice", Email: "a@x"}
	svc.Log(claims, AuditEntry{
		Action: "user.disable", TargetType: "user", TargetID: "u2",
		TargetName: "Bob", Detail: map[string]interface{}{"reason": "offboarding"},
	}, "127.0.0.1", "test-agent", "req-1")

	var logs []model.AuditLog
	if err := gdb.Find(&logs).Error; err != nil {
		t.Fatalf("find: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(logs))
	}
	l := logs[0]
	if l.Action != "user.disable" || l.ActorUserID != "u1" || l.RequestID != "req-1" {
		t.Errorf("unexpected row: %+v", l)
	}
	if l.Detail["reason"] != "offboarding" {
		t.Errorf("detail not serialized: %+v", l.Detail)
	}
}

func TestAuditLogNilActorNoOp(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.AuditLog{})
	svc := NewAuditService(gdb)
	svc.Log(nil, AuditEntry{Action: "x"}, "", "", "")
	var logs []model.AuditLog
	gdb.Find(&logs)
	if len(logs) != 0 {
		t.Fatalf("expected no row for nil actor, got %d", len(logs))
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestAuditLog -v`
Expected: FAIL — `undefined: NewAuditService`, `undefined: AuditEntry`.

- [ ] **Step 3: Implement AuditService**

Create `internal/service/audit.go`:
```go
package service

import (
	"github.com/workpaw/workpaw-control-plane/internal/model"
	"gorm.io/gorm"
)

// AuditEntry describes one admin write operation to record.
type AuditEntry struct {
	Action     string
	TargetType string
	TargetID   string
	TargetName string
	Detail     map[string]interface{}
}

// AuditService writes append-only audit rows. Writes are best-effort: a failure
// is swallowed (audit must never block the operation it records). Callers pass
// ip/user-agent/request-id extracted from the gin.Context in the handler layer
// so this service has no gin dependency.
type AuditService struct {
	db *gorm.DB
}

func NewAuditService(db *gorm.DB) *AuditService {
	return &AuditService{db: db}
}

// Log records an audit row for the given actor. A nil actor is a no-op
// (unauthenticated actions are not audited here).
func (s *AuditService) Log(actor *WorkPawClaims, e AuditEntry, ip, ua, requestID string) {
	if actor == nil || s.db == nil {
		return
	}
	row := &model.AuditLog{
		ActorUserID: actor.UserID,
		ActorName:   actor.Name,
		ActorEmail:  actor.Email,
		Action:      e.Action,
		TargetType:  e.TargetType,
		TargetID:    e.TargetID,
		TargetName:  e.TargetName,
		Detail:      e.Detail,
		IP:          ip,
		UserAgent:   ua,
		RequestID:   requestID,
	}
	_ = s.db.Create(row).Error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestAuditLog -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/service/audit.go internal/service/audit_test.go
git commit -m "feat: add AuditService for append-only audit logging"
```

---

### Task 4: RS256 key service + JWT refactor + JWKS

**Files:**
- Create: `internal/service/key.go`, `internal/service/key_test.go`
- Modify: `internal/service/jwt.go` (HS256 → RS256), `internal/service/jwt_test.go` (new)
- Modify: `internal/handler/auth.go` (Callback/DevLogin call `GenerateAccessToken`)
- Modify: `internal/router/router.go` (build KeyService, pass to NewJWTService, add JWKS route)

**Interfaces:**
- Consumes: `config.JWTConfig` (PrivateKeyPath, ExpireHours), `service.OIDCUser`.
- Produces: `KeyService` with `NewKeyService(privateKeyPath string, debug bool) (*KeyService, error)`, `(*KeyService).Private() *rsa.PrivateKey`, `(*KeyService).KID() string`, `(*KeyService).JWKS() map[string]interface{}`. `JWTService.GenerateAccessToken(user *OIDCUser) (string, error)` (replaces `GenerateToken`); `ValidateToken` unchanged signature, now RS256. Route `GET /.well-known/jwks.json`.

- [ ] **Step 1: Write the failing key test**

Create `internal/service/key_test.go`:
```go
package service

import (
	"crypto/rsa"
	"testing"
)

func TestNewKeyServiceEphemeralInDebug(t *testing.T) {
	k, err := NewKeyService("", true)
	if err != nil {
		t.Fatalf("ephemeral key: %v", err)
	}
	if _, ok := k.Private().(*rsa.PrivateKey); !ok {
		t.Fatal("private key is not *rsa.PrivateKey")
	}
	if k.KID() == "" {
		t.Error("kid is empty")
	}
}

func TestNewKeyServiceRequiresPathInNonDebug(t *testing.T) {
	if _, err := NewKeyService("", false); err == nil {
		t.Fatal("expected error when no key path in non-debug mode")
	}
}

func TestJWKSShape(t *testing.T) {
	k, _ := NewKeyService("", true)
	j := k.JWKS()
	keys, ok := j["keys"].([]map[string]interface{})
	if !ok || len(keys) != 1 {
		t.Fatalf("expected 1 key in jwks, got %v", j)
	}
	kk := keys[0]
	if kk["kty"] != "RSA" || kk["alg"] != "RS256" || kk["kid"] == "" || kk["n"] == "" || kk["e"] != "AQAB" {
		t.Errorf("bad jwk: %+v", kk)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestNewKeyService -v && go test ./internal/service/... -run TestJWKSShape -v`
Expected: FAIL — `undefined: NewKeyService`.

- [ ] **Step 3: Implement KeyService**

Create `internal/service/key.go`:
```go
package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"
)

// KeyService holds the RS256 signing key, its kid, and serves the JWKS document.
// In debug mode with no private_key_path, it generates an ephemeral 2048-bit key
// (tokens invalidate on restart). In non-debug mode a PEM path is required.
type KeyService struct {
	priv *rsa.PrivateKey
	kid  string
}

func NewKeyService(privateKeyPath string, debug bool) (*KeyService, error) {
	if privateKeyPath != "" {
		data, err := os.ReadFile(privateKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read private key: %w", err)
		}
		key, err := parseRSAPrivateKeyPEM(data)
		if err != nil {
			return nil, err
		}
		return newKeyService(key)
	}
	if !debug {
		return nil, fmt.Errorf("jwt.private_key_path is required in non-debug mode")
	}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("generate ephemeral key: %w", err)
	}
	return newKeyService(key)
}

func parseRSAPrivateKeyPEM(data []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("not a PEM block")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	if k8, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if k, ok := k8.(*rsa.PrivateKey); ok {
			return k, nil
		}
		return nil, fmt.Errorf("PKCS8 key is not RSA")
	}
	return nil, fmt.Errorf("unsupported private key encoding")
}

func newKeyService(priv *rsa.PrivateKey) (*KeyService, error) {
	pubDER, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("marshal public key: %w", err)
	}
	sum := sha256.Sum256(pubDER)
	kid := base64.RawURLEncoding.EncodeToString(sum[:])[:16]
	return &KeyService{priv: priv, kid: kid}, nil
}

func (k *KeyService) Private() *rsa.PrivateKey { return k.priv }
func (k *KeyService) KID() string               { return k.kid }

// JWKS returns the JWKS document with the single RS256 public key.
func (k *KeyService) JWKS() map[string]interface{} {
	pub := &k.priv.PublicKey
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	return map[string]interface{}{
		"keys": []map[string]interface{}{
			{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": k.kid, "n": n, "e": "AQAB"},
		},
	}
}
```

- [ ] **Step 4: Run key tests to verify they pass**

Run: `go test ./internal/service/... -run "TestNewKeyService|TestJWKSShape" -v`
Expected: PASS.

- [ ] **Step 5: Write the failing JWT RS256 test**

Create `internal/service/jwt_test.go`:
```go
package service

import (
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

func TestGenerateAccessTokenRS256RoundTrip(t *testing.T) {
	key, _ := NewKeyService("", true)
	svc := NewJWTService(&config.JWTConfig{ExpireHours: 1}, key)
	user := &OIDCUser{Sub: "u1", Email: "a@x", Name: "Alice", Roles: []string{"user", "admin"}}

	tok, err := svc.GenerateAccessToken(user)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	claims, err := svc.ValidateToken(tok)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.UserID != "u1" || claims.Email != "a@x" || len(claims.Roles) != 2 || claims.Roles[1] != "admin" {
		t.Errorf("bad claims: %+v", claims)
	}
}

func TestValidateTokenRejectsTampered(t *testing.T) {
	key, _ := NewKeyService("", true)
	svc := NewJWTService(&config.JWTConfig{ExpireHours: 1}, key)
	tok, _ := svc.GenerateAccessToken(&OIDCUser{Sub: "u1"})
	if _, err := svc.ValidateToken(tok + "x"); err == nil {
		t.Fatal("expected error for tampered token")
	}
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestGenerateAccessTokenRS256 -v`
Expected: FAIL — `undefined: NewJWTService` (signature changed) / `undefined: GenerateAccessToken`.

- [ ] **Step 7: Refactor jwt.go to RS256**

Replace the body of `internal/service/jwt.go` (keep `WorkPawClaims`):
```go
package service

import (
	"crypto/rsa"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/workpaw/workpaw-control-plane/internal/config"
)

// WorkPawClaims defines the custom JWT claims issued by WorkPaw.
type WorkPawClaims struct {
	jwt.RegisteredClaims
	UserID string   `json:"user_id"`
	Email  string   `json:"email"`
	Name   string   `json:"name"`
	Roles  []string `json:"roles"`
}

// JWTService signs RS256 access tokens and verifies them with the public key.
type JWTService struct {
	key         *KeyService
	expireHours int
}

func NewJWTService(cfg *config.JWTConfig, key *KeyService) *JWTService {
	return &JWTService{key: key, expireHours: cfg.ExpireHours}
}

// GenerateAccessToken signs an RS256 JWT for the given OIDC user.
func (s *JWTService) GenerateAccessToken(user *OIDCUser) (string, error) {
	now := time.Now()
	claims := WorkPawClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.Sub,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(s.expireHours) * time.Hour)),
			ID:        uuid.New().String(),
		},
		UserID: user.Sub,
		Email:  user.Email,
		Name:   user.Name,
		Roles:  user.Roles,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = s.key.KID()
	signed, err := token.SignedString(s.key.Private())
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}
	return signed, nil
}

// ValidateToken parses and verifies an RS256 JWT, returning the claims.
func (s *JWTService) ValidateToken(tokenString string) (*WorkPawClaims, error) {
	claims := &WorkPawClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return &s.key.priv.PublicKey, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	return claims, nil
}

// compile-time guard: ensure RSA public key is reachable (avoids unused import
// complaints if future refactor drops direct use).
var _ *rsa.PublicKey
```

- [ ] **Step 8: Run JWT tests to verify they pass**

Run: `go test ./internal/service/... -run "TestGenerateAccessToken|TestValidateTokenRejectsTampered" -v`
Expected: PASS.

- [ ] **Step 9: Update auth.go callers of GenerateToken**

In `internal/handler/auth.go`:
- `Callback` (line ~104): replace `token, err := h.jwtService.GenerateToken(user)` with `token, err := h.jwtService.GenerateAccessToken(user)`.
- `DevLogin` (line ~233): replace `h.jwtService.GenerateToken(user)` with `h.jwtService.GenerateAccessToken(user)`.

(Refresh tokens are added in Task 6; for now Callback/DevLogin return only the access token, named `token`/`access_token` as today.)

- [ ] **Step 10: Update router to build KeyService + JWKS route**

In `internal/router/router.go`:
- Add import `"crypto/rsa"` is not needed; KeyService is in service. Add nothing new beyond what's used.
- Replace `jwtSvc := service.NewJWTService(&cfg.JWT)` with:
```go
	keySvc, err := service.NewKeyService(cfg.JWT.PrivateKeyPath, cfg.Server.Mode == "debug")
	if err != nil {
		logger.Error("failed to load JWT signing key", zap.Error(err))
		// Continue with nil; auth routes will fail loudly rather than crash startup.
	}
	jwtSvc := service.NewJWTService(&cfg.JWT, keySvc)
```
- Add the JWKS route near the auth group:
```go
	// JWKS — public RS256 key for three-end access-token verification
	r.GET("/.well-known/jwks.json", func(c *gin.Context) {
		if keySvc == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "signing key not loaded"})
			return
		}
		c.JSON(http.StatusOK, keySvc.JWKS())
	})
```
Add `"net/http"` to router imports if not present.

- [ ] **Step 11: Build and run all tests**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all tests pass. Existing `auth_test.go` (redirect/allowlist) unaffected.

- [ ] **Step 12: Commit**

```bash
git add internal/service/key.go internal/service/key_test.go internal/service/jwt.go internal/service/jwt_test.go internal/handler/auth.go internal/router/router.go
git commit -m "refactor: switch access tokens to RS256 with JWKS endpoint"
```

---

### Task 5: AccountService + login disable enforcement

**Files:**
- Create: `internal/service/account.go`, `internal/service/account_test.go`
- Modify: `internal/handler/auth.go` (Callback upserts account, refuses disabled), `internal/router/router.go` (wire AccountService into AuthHandler)

**Interfaces:**
- Consumes: `model.Account`, `*gorm.DB`, `service.OIDCUser`.
- Produces: `AccountService`, `NewAccountService(db *gorm.DB) *AccountService`, `(*AccountService).UpsertOnLogin(user *OIDCUser) error`, `var ErrAccountDisabled = errors.New(...)`. UpsertOnLogin creates the account on first login, updates mutable fields + last_login on subsequent logins, and returns `ErrAccountDisabled` (without updating last_login) if `is_disabled=true`.

- [ ] **Step 1: Write the failing test**

Create `internal/service/account_test.go`:
```go
package service

import (
	"errors"
	"testing"
	"time"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestUpsertOnLoginCreatesAccount(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Account{})
	svc := NewAccountService(gdb)
	u := &OIDCUser{Sub: "u1", Email: "a@x", Name: "Alice", Roles: []string{"user"}}
	if err := svc.UpsertOnLogin(u); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	var acct model.Account
	gdb.First(&acct, "user_id = ?", "u1")
	if acct.Email != "a@x" || len(acct.Roles) != 1 || acct.IsDisabled {
		t.Errorf("bad account: %+v", acct)
	}
}

func TestUpsertOnLoginUpdatesOnSubsequentLogin(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Account{})
	svc := NewAccountService(gdb)
	svc.UpsertOnLogin(&OIDCUser{Sub: "u1", Email: "old@x", Name: "Old", Roles: []string{"user"}})
	// Simulate time passing.
	time.Sleep(10 * time.Millisecond)
	svc.UpsertOnLogin(&OIDCUser{Sub: "u1", Email: "new@x", Name: "New", Roles: []string{"user", "admin"}})
	var accts []model.Account
	gdb.Find(&accts)
	if len(accts) != 1 {
		t.Fatalf("expected 1 account, got %d", len(accts))
	}
	if accts[0].Email != "new@x" || len(accts[0].Roles) != 2 {
		t.Errorf("not updated: %+v", accts[0])
	}
}

func TestUpsertOnLoginRefusesDisabled(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.Account{})
	now := time.Now()
	gdb.Create(&model.Account{UserID: "u1", Email: "a@x", IsDisabled: true, FirstSeenAt: now, LastLoginAt: now})
	svc := NewAccountService(gdb)
	err := svc.UpsertOnLogin(&OIDCUser{Sub: "u1", Email: "a@x"})
	if !errors.Is(err, ErrAccountDisabled) {
		t.Fatalf("expected ErrAccountDisabled, got %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestUpsertOnLogin -v`
Expected: FAIL — `undefined: NewAccountService`, `undefined: ErrAccountDisabled`.

- [ ] **Step 3: Implement AccountService**

Create `internal/service/account.go`:
```go
package service

import (
	"errors"
	"time"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"gorm.io/gorm"
)

// ErrAccountDisabled is returned by UpsertOnLogin when the account is disabled;
// the caller must not issue a token.
var ErrAccountDisabled = errors.New("account is disabled")

// AccountService manages the user registry (accounts table).
type AccountService struct {
	db *gorm.DB
}

func NewAccountService(db *gorm.DB) *AccountService {
	return &AccountService{db: db}
}

// UpsertOnLogin records the account on first login and updates mutable fields
// + last_login on subsequent logins. Returns ErrAccountDisabled (without
// updating last_login) if the account is disabled — the caller must refuse to
// issue a token.
func (s *AccountService) UpsertOnLogin(user *OIDCUser) error {
	now := time.Now()
	acct := &model.Account{}
	res := s.db.Where("user_id = ?", user.Sub).First(acct)
	if res.Error != nil && !errors.Is(res.Error, gorm.ErrRecordNotFound) {
		return res.Error
	}
	if acct.IsDisabled {
		return ErrAccountDisabled
	}
	if errors.Is(res.Error, gorm.ErrRecordNotFound) {
		acct = &model.Account{
			UserID:      user.Sub,
			Email:       user.Email,
			DisplayName: user.Name,
			Roles:       user.Roles,
			FirstSeenAt: now,
			LastLoginAt: now,
		}
		return s.db.Create(acct).Error
	}
	acct.Email = user.Email
	acct.DisplayName = user.Name
	acct.Roles = user.Roles
	acct.LastLoginAt = now
	return s.db.Save(acct).Error
}

// IsDisabled returns true if the account exists and is disabled.
func (s *AccountService) IsDisabled(userID string) bool {
	var acct model.Account
	if err := s.db.Where("user_id = ?", userID).First(&acct).Error; err != nil {
		return false
	}
	return acct.IsDisabled
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestUpsertOnLogin -v`
Expected: PASS.

- [ ] **Step 5: Wire account upsert + disable check into Callback**

In `internal/handler/auth.go`:
- Add fields to `AuthHandler`:
```go
type AuthHandler struct {
	oidcService    *service.OIDCService
	jwtService     *service.JWTService
	accountService *service.AccountService
	allowedOrigins []string
}
```
- Update `NewAuthHandler` signature:
```go
func NewAuthHandler(oidcService *service.OIDCService, jwtService *service.JWTService, accountService *service.AccountService, allowedOrigins []string) *AuthHandler {
	return &AuthHandler{
		oidcService:    oidcService,
		jwtService:     jwtService,
		accountService: accountService,
		allowedOrigins: allowedOrigins,
	}
}
```
- In `Callback`, after `user, err := h.oidcService.ExchangeCode(...)` succeeds and before generating the token, add the disable check:
```go
	if h.accountService != nil {
		if err := h.accountService.UpsertOnLogin(user); err != nil {
			if errors.Is(err, service.ErrAccountDisabled) {
				c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to record login: " + err.Error()})
			return
		}
	}
```
Add `"errors"` to auth.go imports.

- [ ] **Step 6: Update router to pass AccountService**

In `internal/router/router.go`, after DB wiring (Task 2) and before `authHandler := handler.NewAuthHandler(...)`:
```go
	var accountSvc *service.AccountService
	if gdb != nil {
		accountSvc = service.NewAccountService(gdb)
	}
```
Change the `NewAuthHandler` call:
```go
	authHandler := handler.NewAuthHandler(oidcSvc, jwtSvc, accountSvc, cfg.OIDC.AllowedRedirectOrigins)
```

- [ ] **Step 7: Build and run all tests**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add internal/service/account.go internal/service/account_test.go internal/handler/auth.go internal/router/router.go
git commit -m "feat: upsert accounts on login and refuse disabled users"
```

---

### Task 6: Refresh tokens + /refresh + /logout

**Files:**
- Create: `internal/service/refresh.go`, `internal/service/refresh_test.go`
- Modify: `internal/handler/auth.go` (Refresh + Logout handlers; Callback/DevLogin issue access+refresh), `internal/handler/auth_test.go` (refresh handler test)
- Modify: `internal/router/router.go` (wire RefreshService, add `/api/auth/refresh`)

**Interfaces:**
- Consumes: `model.RefreshToken`, `*gorm.DB`, `config.JWTConfig.RefreshExpireDays`, `service.AccountService` (refresh checks disabled).
- Produces: `RefreshService`, `NewRefreshService(db *gorm.DB, expireDays int) *RefreshService`, `(*RefreshService).Issue(userID, userAgent, ip string) (string, error)`, `(*RefreshService).Validate(token string) (userID string, err error)`, `(*RefreshService).RevokeAll(userID string) error`. Handlers `Refresh` (`POST /api/auth/refresh`, body `{"refresh_token":"..."}`) and `Logout` (`POST /api/auth/logout`, body `{"refresh_token":"..."}`).

- [ ] **Step 1: Write the failing RefreshService test**

Create `internal/service/refresh_test.go`:
```go
package service

import (
	"testing"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestRefreshIssueValidateRevoke(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.RefreshToken{})
	svc := NewRefreshService(gdb, 7)

	tok, err := svc.Issue("u1", "ua", "127.0.0.1")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if tok == "" {
		t.Fatal("empty token")
	}

	uid, err := svc.Validate(tok)
	if err != nil || uid != "u1" {
		t.Fatalf("validate: %v uid=%s", err, uid)
	}

	if err := svc.RevokeAll("u1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.Validate(tok); err == nil {
		t.Fatal("expected revoked error after RevokeAll")
	}
}

func TestRefreshValidateRejectsUnknown(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.RefreshToken{})
	svc := NewRefreshService(gdb, 7)
	if _, err := svc.Validate("bogus"); err == nil {
		t.Fatal("expected error for unknown token")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/service/... -run TestRefresh -v`
Expected: FAIL — `undefined: NewRefreshService`.

- [ ] **Step 3: Implement RefreshService**

Create `internal/service/refresh.go`:
```go
package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/workpaw/workpaw-control-plane/internal/model"
	"gorm.io/gorm"
)

// RefreshService issues, validates, and revokes opaque refresh tokens. Only the
// SHA-256 hash of a token is stored.
type RefreshService struct {
	db         *gorm.DB
	expireDays int
}

func NewRefreshService(db *gorm.DB, expireDays int) *RefreshService {
	return &RefreshService{db: db, expireDays: expireDays}
}

func (s *RefreshService) Issue(userID, userAgent, ip string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	rec := &model.RefreshToken{
		TokenHash: hashToken(token),
		UserID:    userID,
		ExpiresAt: time.Now().Add(time.Duration(s.expireDays) * 24 * time.Hour),
		CreatedAt: time.Now(),
		UserAgent: userAgent,
		IP:        ip,
	}
	if err := s.db.Create(rec).Error; err != nil {
		return "", err
	}
	return token, nil
}

// Validate returns the userID for a valid, unrevoked, unexpired token.
func (s *RefreshService) Validate(token string) (string, error) {
	rec := &model.RefreshToken{}
	if err := s.db.Where("token_hash = ?", hashToken(token)).First(rec).Error; err != nil {
		return "", err
	}
	if rec.RevokedAt != nil {
		return "", errors.New("refresh token revoked")
	}
	if time.Now().After(rec.ExpiresAt) {
		return "", errors.New("refresh token expired")
	}
	return rec.UserID, nil
}

// RevokeAll revokes every refresh token for the user (logout everywhere).
func (s *RefreshService) RevokeAll(userID string) error {
	now := time.Now()
	return s.db.Model(&model.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", now).Error
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/service/... -run TestRefresh -v`
Expected: PASS.

- [ ] **Step 5: Write the failing refresh handler test**

Append to `internal/handler/auth_test.go`:
```go
import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/model"
	"github.com/workpaw/workpaw-control-plane/internal/service"
	"github.com/workpaw/workpaw-control-plane/internal/testutil"
)

func TestRefreshHandler(t *testing.T) {
	gdb := testutil.NewTestDB(t, &model.RefreshToken{}, &model.Account{})
	refreshSvc := service.NewRefreshService(gdb, 7)
	accountSvc := service.NewAccountService(gdb)
	// Seed an enabled account so refresh can re-issue.
	gdb.Create(&model.Account{UserID: "u1", Email: "a@x", DisplayName: "A", Roles: []string{"user"}, FirstSeenAt: time.Now(), LastLoginAt: time.Now()})
	tok, _ := refreshSvc.Issue("u1", "ua", "ip")

	key, _ := service.NewKeyService("", true)
	jwtSvc := service.NewJWTService(&config.JWTConfig{ExpireHours: 1}, key)
	h := NewAuthHandler(nil, jwtSvc, accountSvc, refreshSvc, nil)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/refresh", h.Refresh)

	body := `{"refresh_token":"` + tok + `"}`
	req := httptest.NewRequest("POST", "/api/auth/refresh", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "access_token") {
		t.Fatalf("response missing access_token: %s", w.Body.String())
	}
}
```
Update the existing imports at the top of `auth_test.go` (merge the two import blocks; add `"time"` and the new packages).

- [ ] **Step 6: Run test to verify it fails**

Run: `go test ./internal/handler/... -run TestRefreshHandler -v`
Expected: FAIL — `NewAuthHandler` arity mismatch / `undefined: h.Refresh`.

- [ ] **Step 7: Add RefreshService to AuthHandler + Refresh/Logout handlers**

In `internal/handler/auth.go`:
- Add `refreshService *service.RefreshService` to the struct and `NewAuthHandler` (final signature):
```go
func NewAuthHandler(oidcService *service.OIDCService, jwtService *service.JWTService, accountService *service.AccountService, refreshService *service.RefreshService, allowedOrigins []string) *AuthHandler {
	return &AuthHandler{
		oidcService:    oidcService,
		jwtService:     jwtService,
		accountService: accountService,
		refreshService: refreshService,
		allowedOrigins: allowedOrigins,
	}
}
```
- In `Callback`, after generating the access `token`, also issue a refresh token and include both in the redirect URLs. Add:
```go
	var refreshToken string
	if h.refreshService != nil {
		rt, rerr := h.refreshService.Issue(user.Sub, c.GetHeader("User-Agent"), c.ClientIP())
		if rerr == nil {
			refreshToken = rt
		}
	}
```
Then update both the `deepLink` and `redirectURL` format strings to append `&refresh_token=%s` with `url.QueryEscape(refreshToken)`.
- In `DevLogin`, after generating `token`, issue a refresh token the same way and include `"refresh_token": refreshToken` in the JSON response.
- Add the `Refresh` handler:
```go
// Refresh exchanges a refresh token for a new access token.
// POST /api/auth/refresh  body: {"refresh_token":"..."}
func (h *AuthHandler) Refresh(c *gin.Context) {
	if h.refreshService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "refresh not configured"})
		return
	}
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing refresh_token"})
		return
	}
	userID, err := h.refreshService.Validate(body.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
		return
	}
	if h.accountService != nil && h.accountService.IsDisabled(userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled"})
		return
	}
	// Reconstruct a minimal OIDCUser for token minting from the account.
	user, err := h.accountService.Get(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "account lookup failed"})
		return
	}
	access, err := h.jwtService.GenerateAccessToken(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"access_token": access,
		"user": gin.H{
			"user_id": user.Sub, "email": user.Email, "name": user.Name, "roles": user.Roles,
		},
	})
}
```
- Add the `Logout` handler (replaces the existing stub):
```go
// Logout revokes all refresh tokens for the user behind the given refresh token.
// POST /api/auth/logout  body: {"refresh_token":"..."}
func (h *AuthHandler) Logout(c *gin.Context) {
	if h.refreshService == nil {
		c.JSON(http.StatusOK, gin.H{"message": "Logged out"})
		return
	}
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing refresh_token"})
		return
	}
	userID, err := h.refreshService.Validate(body.RefreshToken)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Logged out"}) // idempotent
		return
	}
	_ = h.refreshService.RevokeAll(userID)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out"})
}
```

- [ ] **Step 8: Add AccountService.Get and convert to OIDCUser**

The `Refresh` handler calls `h.accountService.Get(userID)`. Add to `internal/service/account.go`:
```go
// Get loads an account and converts it to an OIDCUser for token minting.
func (s *AccountService) Get(userID string) (*OIDCUser, error) {
	var acct model.Account
	if err := s.db.Where("user_id = ?", userID).First(&acct).Error; err != nil {
		return nil, err
	}
	return &OIDCUser{
		Sub:   acct.UserID,
		Email: acct.Email,
		Name:  acct.DisplayName,
		Roles: acct.Roles,
	}, nil
}
```

- [ ] **Step 9: Wire RefreshService + routes in router**

In `internal/router/router.go`:
- After `accountSvc`, add:
```go
	var refreshSvc *service.RefreshService
	if gdb != nil {
		refreshSvc = service.NewRefreshService(gdb, cfg.JWT.RefreshExpireDays)
	}
```
- Update the `NewAuthHandler` call:
```go
	authHandler := handler.NewAuthHandler(oidcSvc, jwtSvc, accountSvc, refreshSvc, cfg.OIDC.AllowedRedirectOrigins)
```
- Register the refresh route next to the existing auth routes:
```go
	authGroup.POST("/refresh", authHandler.Refresh)
```
(`logout` is already registered; it now uses the new handler body.)

- [ ] **Step 10: Build and run all tests**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all tests pass, including `TestRefreshHandler`.

- [ ] **Step 11: Commit**

```bash
git add internal/service/refresh.go internal/service/refresh_test.go internal/service/account.go internal/handler/auth.go internal/handler/auth_test.go internal/router/router.go
git commit -m "feat: add refresh tokens with /refresh and /logout revocation"
```

---

### Task 7: Health check (db / k8s / oidc)

**Files:**
- Create: `internal/handler/health.go`, `internal/handler/health_test.go`
- Modify: `internal/router/router.go` (replace stub `/health` with HealthHandler)

**Interfaces:**
- Consumes: `*gorm.DB` (for ping), presence flags for `instanceSvc`/`oidcSvc`.
- Produces: `HealthHandler` with `NewHealthHandler(gdb *gorm.DB, k8sUp bool, oidcUp func() bool) *HealthHandler` and `(*HealthHandler).Health(c *gin.Context)`. Response: `{"status":"ok"|"degraded","db":"up"|"down","k8s":"up"|"down","oidc":"up"|"down"}`.

- [ ] **Step 1: Write the failing test**

Create `internal/handler/health_test.go`:
```go
package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestHealthAllUp(t *testing.T) {
	gdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	h := NewHealthHandler(gdb, true, func() bool { return true })
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health", h.Health)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body map[string]string
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["status"] != "ok" || body["db"] != "up" || body["k8s"] != "up" || body["oidc"] != "up" {
		t.Errorf("expected all up, got %v", body)
	}
}

func TestHealthDegradedWhenOIDCDown(t *testing.T) {
	gdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	h := NewHealthHandler(gdb, true, func() bool { return false })
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/health", h.Health)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	var body map[string]string
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["status"] != "degraded" || body["oidc"] != "down" {
		t.Errorf("expected degraded/oidc down, got %v", body)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/handler/... -run TestHealth -v`
Expected: FAIL — `undefined: NewHealthHandler`.

- [ ] **Step 3: Implement HealthHandler**

Create `internal/handler/health.go`:
```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// HealthHandler reports the status of control-plane dependencies.
type HealthHandler struct {
	gdb     *gorm.DB
	k8sUp   bool
	oidcUp  func() bool
}

func NewHealthHandler(gdb *gorm.DB, k8sUp bool, oidcUp func() bool) *HealthHandler {
	return &HealthHandler{gdb: gdb, k8sUp: k8sUp, oidcUp: oidcUp}
}

func (h *HealthHandler) Health(c *gin.Context) {
	dbUp := false
	if h.gdb != nil {
		if sqlDB, err := h.gdb.DB(); err == nil {
			dbUp = sqlDB.Ping() == nil
		}
	}
	oidcUp := false
	if h.oidcUp != nil {
		oidcUp = h.oidcUp()
	}
	status := "ok"
	if !dbUp || !h.k8sUp || !oidcUp {
		status = "degraded"
	}
	c.JSON(http.StatusOK, gin.H{
		"status": status,
		"db":     upDown(dbUp),
		"k8s":    upDown(h.k8sUp),
		"oidc":   upDown(oidcUp),
	})
}

func upDown(up bool) string {
	if up {
		return "up"
	}
	return "down"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/handler/... -run TestHealth -v`
Expected: PASS.

- [ ] **Step 5: Wire HealthHandler into router**

In `internal/router/router.go`, replace the existing stub `r.GET("/health", ...)` (the Task 2 version) with:
```go
	healthH := handler.NewHealthHandler(gdb, instanceSvc != nil, func() bool { return oidcSvc != nil })
	r.GET("/health", healthH.Health)
```
This line must appear AFTER `instanceSvc` and `oidcSvc` are determined (move it to just before `return r`). Add `"github.com/workpaw/workpaw-control-plane/internal/handler"` is already imported.

- [ ] **Step 6: Build and run all tests**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add internal/handler/health.go internal/handler/health_test.go internal/router/router.go
git commit -m "feat: dependency-aware /health (db, k8s, oidc)"
```

---

### Task 8: Postgres integration test (testcontainers)

**Files:**
- Create: `internal/service/integration_test.go`
- Modify: `go.mod` (via `go get`)

**Interfaces:**
- Validates: on real Postgres, `model.Migrate` runs cleanly; the `gorm:"serializer:json"` columns for `Roles`/`Detail` round-trip; `AccountService`/`RefreshService` behave as in SQLite tests; `JWTService` RS256 round-trip is driver-independent. This catches Postgres-specific issues the SQLite unit tests cannot.

- [ ] **Step 1: Add testcontainers dependency**

Run:
```bash
go get github.com/testcontainers/testcontainers-go@latest
go mod tidy
```
Expected: `go.mod` gains `github.com/testcontainers/testcontainers-go`. Requires Docker running locally for the test.

- [ ] **Step 2: Write the integration test**

Create `internal/service/integration_test.go`:
```go
//go:build integration

package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/workpaw/workpaw-control-plane/internal/config"
	"github.com/workpaw/workpaw-control-plane/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func startPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	ctx := context.Background()
	pgC, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase("workpaw"), postgres.WithUsername("workpaw"), postgres.WithPassword("workpaw"),
		testcontainers.WithWaitStrategy(nil),
	)
	if err != nil {
		t.Skipf("postgres container unavailable: %v", err)
	}
	t.Cleanup(func() { pgC.Terminate(ctx) })

	connStr, err := pgC.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("conn string: %v", err)
	}
	gdb, err := gorm.Open(postgres.Open(connStr), &gorm.Config{})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := model.Migrate(gdb); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return gdb
}

func TestIntegrationAccountAndRefreshOnPostgres(t *testing.T) {
	gdb := startPostgres(t)

	acctSvc := NewAccountService(gdb)
	refreshSvc := NewRefreshService(gdb, 7)

	u := &OIDCUser{Sub: "u1", Email: "a@x", Name: "Alice", Roles: []string{"user", "admin"}}
	if err := acctSvc.UpsertOnLogin(u); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	// json-serialized Roles must round-trip on real Postgres.
	got, err := acctSvc.Get("u1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if len(got.Roles) != 2 || got.Roles[1] != "admin" {
		t.Fatalf("roles did not round-trip on postgres: %+v", got.Roles)
	}

	tok, err := refreshSvc.Issue("u1", "ua", "ip")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if uid, err := refreshSvc.Validate(tok); err != nil || uid != "u1" {
		t.Fatalf("validate: %v %s", err, uid)
	}
	refreshSvc.RevokeAll("u1")
	if _, err := refreshSvc.Validate(tok); err == nil {
		t.Fatal("expected revoked error on postgres")
	}

	// Disable and confirm refusal.
	now := time.Now()
	gdb.Create(&model.Account{UserID: "u2", IsDisabled: true, FirstSeenAt: now, LastLoginAt: now})
	if err := acctSvc.UpsertOnLogin(&OIDCUser{Sub: "u2"}); !errors.Is(err, ErrAccountDisabled) {
		t.Fatalf("expected disabled error, got %v", err)
	}
}

func TestIntegrationJWKSAndRS256(t *testing.T) {
	key, err := NewKeyService("", true)
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	jwks := key.JWKS()
	if jwks["keys"] == nil {
		t.Fatal("jwks empty")
	}
	svc := NewJWTService(&config.JWTConfig{ExpireHours: 1}, key)
	tok, err := svc.GenerateAccessToken(&OIDCUser{Sub: "u1", Roles: []string{"admin"}})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := svc.ValidateToken(tok); err != nil {
		t.Fatalf("validate: %v", err)
	}
}
```

- [ ] **Step 3: Run the integration test**

Run: `go test ./internal/service/... -tags=integration -run TestIntegration -v`
Expected: PASS (Postgres container starts, migrate runs, all assertions pass). If Docker is unavailable the test skips.

- [ ] **Step 4: Run the full suite (unit, no integration tag)**

Run: `go build ./... && go test ./... -v`
Expected: build succeeds; all non-integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add internal/service/integration_test.go go.mod go.sum
git commit -m "test: postgres integration test for account/refresh/jwt (testcontainers)"
```

---

## Self-Review

**1. Spec coverage (Plan 1 scope):**
- §5.1 token model (RS256 access + opaque refresh + JWKS) → Tasks 4, 6. ✓
- §5.1 access TTL kept at `expire_hours` (24h) for Plan 1, refresh 7d → Global Constraints + Task 2 config. ✓
- §5.2 three-end login (callback/dev-login/refresh/logout, JWKS) → Tasks 4, 5, 6. ✓
- §5.3 OIDC central management → **deferred to Plan 2** (explicitly noted). ✓ (Plan 1 keeps config.yaml OIDC.)
- §6 accounts/refresh_tokens/audit_logs tables → Task 2. ✓ (oidc_configs/policies/template_* tables are Plan 2/3.)
- §7 auth routes `/api/auth/refresh`, `/.well-known/jwks.json` → Tasks 4, 6. ✓
- §9.B disable enforcement at login (callback) → Task 5. ✓ (instance activate disable-check is Plan 2 — admin force-start/stop.)
- §9.C audit helper → Task 3. ✓
- §10 access token expiry handling (refresh) → Task 6. ✓
- §10 health check → Task 7. ✓
- §11 tests (unit + testcontainer integration) → Tasks 2–8. ✓
- §12 alignment points → Task 1. ✓ (point 6 baked into Task 4; points 1/2/4/5/7/8 recorded for Plans 2/3.)

**2. Placeholder scan:** None. Every code step has complete code; every test has real assertions. Task 1 is investigation with concrete files to read and a concrete doc to write.

**3. Type consistency:** `NewJWTService(cfg, key)` used consistently in Tasks 4/6/8. `NewAuthHandler(oidcSvc, jwtSvc, accountSvc, refreshSvc, allowedOrigins)` arity matches across Task 5 (4 args, refresh added in Task 6) — note: Task 5 Step 5 sets the signature to 4 args (no refresh); Task 6 Step 7 updates it to 5 args. The Task 6 router call passes 5 args. `GenerateAccessToken(*OIDCUser)` used in Tasks 4/5/6/8. `AccountService.Get/IsDisabled/UpsertOnLogin` consistent. `RefreshService.Issue/Validate/RevokeAll` consistent. `KeyService.NewKeyService/Private/KID/JWKS` consistent.

**4. Note on Task 5 → Task 6 AuthHandler arity change:** Task 5 introduces `NewAuthHandler` with 4 params (no refresh); Task 6 extends to 5 params. This is intentional incremental wiring — each task compiles. The `Callback` is modified in Task 4 (RS256), Task 5 (account check), Task 6 (refresh issue): three touches, each leaving code compiling.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-workpaw-control-plane/console-backend-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

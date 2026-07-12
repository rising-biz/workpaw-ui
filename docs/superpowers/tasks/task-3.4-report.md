# Task 3.4 Report: Auth Middleware + Route Registration

**Status:** DONE

**Commit:** `4d13b8d` -- `feat: add admin middleware and finalize route registration`

## Changes Made

### 1. Created `internal/middleware/auth.go`
- **`AdminOnly()`** -- Gin middleware that checks JWT claims for the "admin" role. Returns 401 if no claims are present, 403 if the user lacks the admin role.
- **`GetClaims(c)`** -- Public helper that extracts `*service.WorkPawClaims` from the gin context (stored under key `"workpaw_claims"` by the Auth middleware). Returns nil if claims are absent or mistyped.

### 2. Updated `internal/router/router.go`
- Replaced the `// TODO: Admin routes (/api/admin/*)` placeholder with a real route group:
  - `/api/admin` group uses both `middleware.Auth(jwtSvc)` and `middleware.AdminOnly()`
  - Includes a `/api/admin/health` placeholder endpoint for smoke-testing the admin middleware chain

### 3. Refactored `internal/handler/instance.go`
- Removed the private `getClaims()` function (duplicated logic)
- All four handlers now call the shared `middleware.GetClaims(c)` instead
- Added `middleware` package import

### 4. Verified Dockerfile
- Already present from scaffolding: multi-stage build (golang:1.23-alpine -> alpine:3.19), exposes port 8080, entrypoint runs `serve` command.

### 5. Included previously untracked scaffolding files
- `Dockerfile`, `cmd/root.go`, `cmd/serve.go`, `internal/config/config.go`, `main.go` were created in an earlier scaffolding step but never committed. Added them in this commit to ensure a complete repository state.

## Build & Vet

```
go build ./...   -- PASS (no errors)
go vet ./...     -- PASS (no warnings)
```

## Route Summary

| Route                       | Method | Middleware           | Handler               |
|-----------------------------|--------|----------------------|-----------------------|
| `/health`                   | GET    | (none)               | inline                |
| `/api/auth/login`           | GET    | (none)               | AuthHandler.Login     |
| `/api/auth/callback`        | GET    | (none)               | AuthHandler.Callback  |
| `/api/auth/logout`          | POST   | (none)               | AuthHandler.Logout    |
| `/api/instance`             | GET    | Auth                 | InstanceHandler.GetInstance |
| `/api/instance/activate`    | POST   | Auth                 | InstanceHandler.ActivateInstance |
| `/api/instance/deactivate`  | POST   | Auth                 | InstanceHandler.DeactivateInstance |
| `/api/instance/connect`     | GET    | Auth                 | InstanceHandler.GetConnectInfo |
| `/api/admin/health`         | GET    | Auth + AdminOnly     | inline (placeholder)  |

## Test Summary

No unit tests were added in this task (middleware is thin and integration-tested via the API). Build and vet pass cleanly.

## Concerns

- The `/api/admin/health` endpoint is a minimal placeholder. Future admin endpoints (user management, audit log queries, system configuration) should be added to the `adminGroup` in `router.go` as they are implemented.
- The `CLAUDE.md` file remains untracked. It is a development tooling file and was intentionally excluded from this commit.

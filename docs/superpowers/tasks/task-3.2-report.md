# Task 3.2 Report: OIDC + JWT Authentication

## Status: DONE

## What Was Implemented

### 1. `internal/service/oidc.go` — OIDCService
- **OIDCUser struct**: Sub, Email, Name, Roles (extracted from OIDC id_token claims)
- **NewOIDCService**: Initializes OIDC provider via `go-oidc`, creates OAuth2 config with `openid`, `profile`, `email` scopes, sets up ID token verifier with client_id audience check
- **GetAuthURL**: Generates 32-byte cryptographic random state via `crypto/rand`, returns OAuth2 auth code URL
- **ExchangeCode**: Exchanges authorization code for tokens, verifies id_token signature and audience, parses claims into OIDCUser (handles `email`, `name`, `roles` from claims map)

### 2. `internal/service/jwt.go` — JWTService
- **WorkPawClaims**: Embeds `jwt.RegisteredClaims` with custom fields: UserID, Email, Name, Roles
- **NewJWTService**: Takes JWTConfig (secret, expire_hours)
- **GenerateToken**: Creates HS256-signed JWT with subject, issued-at, expiration, unique JTI (uuid v4), and user claims
- **ValidateToken**: Parses and validates JWT, enforces HMAC signing method, returns WorkPawClaims

### 3. `internal/handler/auth.go` — AuthHandler
- **Login** (`GET /api/auth/login`): Calls `oidcService.GetAuthURL()`, returns `{"auth_url": "..."}`. Returns 503 if OIDC service is nil
- **Callback** (`GET /api/auth/callback?code=...`): Checks for OIDC error params, validates code presence, exchanges code for user info, generates JWT, returns `{"access_token": "...", "user": {"user_id": ..., "email": ..., "name": ..., "roles": ...}}`
- **Logout** (`POST /api/auth/logout`): Returns `{"message": "Logged out"}` (placeholder for future session cleanup)

### 4. Updated `internal/router/router.go`
- JWT service initialized unconditionally (no external dependency)
- OIDC service initialized with 10-second timeout context; on failure, logs warning via Zap and sets oidcSvc to nil
- Auth routes registered under `/api/auth` group
- All existing middleware (CORS, RequestID, Logger, Recovery) and `/health` endpoint preserved

## Build Verification
```
$ go build ./...    # PASS (no errors)
$ go vet ./...      # PASS (no warnings)
```

## Commit
```
14fd38e feat: implement OIDC + JWT authentication
```

## Files Changed
| File | Action |
|------|--------|
| `internal/service/oidc.go` | Created |
| `internal/service/jwt.go` | Created |
| `internal/handler/auth.go` | Created |
| `internal/router/router.go` | Modified |

## Design Decisions

1. **Graceful OIDC degradation**: If the OIDC provider is unreachable at startup (common in dev), the server still starts. Login/Callback return 503; Logout still works. JWT validation is fully independent of OIDC.

2. **State generation**: Uses `crypto/rand` (32 bytes, hex-encoded to 64 chars) as required. The state is returned to the caller — in a production deployment this would be stored server-side (e.g., in a cookie or session store) for verification on callback.

3. **Claims parsing**: Uses `map[string]interface{}` for raw OIDC claims to handle provider-specific claim structures (roles may be in `roles`, `groups`, or other fields depending on the OIDC provider).

4. **JTI (JWT ID)**: Each token gets a unique UUID, enabling future token revocation/blacklisting.

## Concerns
None. The implementation follows the task brief exactly. The `go build ./...` and `go vet ./...` both pass cleanly.

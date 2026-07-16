# Task 3.2: OIDC + JWT 认证

**Work in:** `/Users/zhangsan/workpaw/workpaw-admin`

**Files to create:**

### 1. `internal/service/oidc.go`

OIDCService wraps go-oidc provider:
- `NewOIDCService(cfg *config.OIDCConfig) (*OIDCService, error)` - initializes OIDC provider, oauth2 config, verifier
- `GetAuthURL() (authURL string, state string, err error)` - generates random state, returns auth code URL
- `ExchangeCode(ctx, code) (*OIDCUser, error)` - exchanges auth code for tokens, verifies id_token, extracts claims (sub, email, name, roles)

OIDCUser struct: Sub, Email, Name, Roles []string

Use packages: `github.com/coreos/go-oidc/v3/oidc`, `golang.org/x/oauth2`

### 2. `internal/service/jwt.go`

JWTService wraps golang-jwt:
- WorkPawClaims struct embeds jwt.RegisteredClaims + UserID, Email, Name, Roles fields
- `NewJWTService(cfg *config.JWTConfig) *JWTService`
- `GenerateToken(user *OIDCUser) (string, error)` - creates JWT with HS256
- `ValidateToken(tokenString string) (*WorkPawClaims, error)` - parses and validates

Use: `github.com/golang-jwt/jwt/v5`, `github.com/google/uuid`

### 3. `internal/handler/auth.go`

AuthHandler with Gin handlers:
- `Login(c *gin.Context)` - calls oidcService.GetAuthURL(), returns `{"auth_url": "..."}`
- `Callback(c *gin.Context)` - reads `code` query param, exchanges for user, generates JWT, returns `{"access_token": "...", "user": {...}}`
- `Logout(c *gin.Context)` - returns `{"message": "Logged out"}`

### 4. Update `internal/router/router.go`

Register auth routes:
```go
authGroup := r.Group("/api/auth")
authGroup.GET("/login", authHandler.Login)
authGroup.GET("/callback", authHandler.Callback)
authGroup.POST("/logout", authHandler.Logout)
```

Initialize OIDCService and JWTService in Setup(), pass to AuthHandler.
If OIDC provider is unreachable, log warning but don't crash.

**Acceptance:** `go build ./...` passes. Auth routes registered at /api/auth/login, /api/auth/callback, /api/auth/logout.

# Task 3.4: Auth 中间件 + 路由注册

**Work in:** `/Users/zhangsan/workpaw/workpaw-admin`

## Context

Task 3.2 (OIDC+JWT) and Task 3.3 (Instance API) are already complete. The middleware package already has:
- `internal/middleware/middleware.go` with CORS, RequestID, Logger functions

This task adds the remaining auth middleware and ensures all routes are properly wired.

## Files to Create/Modify

### 1. Create `internal/middleware/auth.go`

```go
package middleware

import (
    "net/http"
    "strings"

    "github.com/gin-gonic/gin"
    "github.com/workpaw/workpaw-admin/internal/service"
)

const claimsKey = "workpaw_claims"

func Auth(jwtService *service.JWTService) gin.HandlerFunc {
    return func(c *gin.Context) {
        header := c.GetHeader("Authorization")
        if header == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Missing authorization header"})
            return
        }

        token := strings.TrimPrefix(header, "Bearer ")
        claims, err := jwtService.ValidateToken(token)
        if err != nil {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
            return
        }

        c.Set(claimsKey, claims)
        c.Next()
    }
}

func AdminOnly() gin.HandlerFunc {
    return func(c *gin.Context) {
        val, exists := c.Get(claimsKey)
        if !exists {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
            return
        }
        claims, ok := val.(*service.WorkPawClaims)
        if !ok {
            c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
            return
        }

        for _, role := range claims.Roles {
            if role == "admin" {
                c.Next()
                return
            }
        }

        c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin role required"})
    }
}

func GetClaims(c *gin.Context) *service.WorkPawClaims {
    val, exists := c.Get(claimsKey)
    if !exists {
        return nil
    }
    claims, ok := val.(*service.WorkPawClaims)
    if !ok {
        return nil
    }
    return claims
}
```

### 2. Verify `internal/router/router.go` has complete route setup

Ensure the router has:
1. Global middleware: CORS, RequestID, Logger, Recovery
2. `/health` endpoint
3. `/api/auth/login` (GET) — public
4. `/api/auth/callback` (GET) — public
5. `/api/auth/logout` (POST) — public
6. `/api/instance` (GET) — authenticated
7. `/api/instance/activate` (POST) — authenticated
8. `/api/instance/deactivate` (POST) — authenticated
9. `/api/instance/connect` (GET) — authenticated
10. Placeholder for `/api/admin/*` routes (with Auth + AdminOnly middleware)

If Task 3.3 already added instance routes, verify they use `middleware.Auth(jwtSvc)`.

### 3. Create Dockerfile if not exists

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /workpaw-admin .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /workpaw-admin /workpaw-admin
EXPOSE 8080
ENTRYPOINT ["/workpaw-admin"]
CMD ["serve"]
```

### Acceptance

- Auth middleware validates JWT Bearer tokens
- AdminOnly middleware checks for "admin" role
- All routes properly wired with correct middleware
- `go build ./...` passes
- Dockerfile exists
- Commit: `feat: add auth middleware and finalize route registration`

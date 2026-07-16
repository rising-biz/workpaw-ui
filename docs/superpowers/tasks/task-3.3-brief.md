# Task 3.3: 实例管理 API

**Work in:** `/Users/zhangsan/workpaw/workpaw-admin`

## Files to Create

### 1. `internal/service/instance.go`

InstanceService manages QwenPawInstance CRDs via K8s API:

```go
package service

import (
    "context"
    "fmt"
    "time"

    workpawv1alpha1 "github.com/workpaw/workpaw-operator/api/v1alpha1"
    "github.com/workpaw/workpaw-admin/internal/config"
    corev1 "k8s.io/api/core/v1"
    apierrors "k8s.io/apimachinery/pkg/api/errors"
    metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
    "k8s.io/apimachinery/pkg/runtime"
    "k8s.io/apimachinery/pkg/types"
    "k8s.io/client-go/kubernetes"
    "k8s.io/client-go/rest"
    "k8s.io/client-go/tools/clientcmd"
    "sigs.k8s.io/controller-runtime/pkg/client"
)

type InstanceService struct {
    k8sClient  client.Client
    kubeClient *kubernetes.Clientset
    cfg        *config.Config
}

type InstanceStatus struct {
    Status     string `json:"status"`
    IngressURL string `json:"ingress_url"`
    CreatedAt  string `json:"created_at,omitempty"`
    LastActive string `json:"last_active_at,omitempty"`
}

type ConnectInfo struct {
    IngressURL string `json:"ingress_url"`
    APIToken   string `json:"api_token"`
}
```

Methods:
- `NewInstanceService(cfg *config.Config) (*InstanceService, error)` - init K8s clients (in-cluster or kubeconfig), register CRD scheme
- `GetInstance(ctx, userID string) (*InstanceStatus, error)` - Get QwenPawInstance CR by name (userID), map status
- `ActivateInstance(ctx, userID, email string) (*InstanceStatus, error)` - Create new CR or update existing to desiredState=Running
- `DeactivateInstance(ctx, userID string) error` - Set desiredState=Stopped
- `GetConnectInfo(ctx, userID string) (*ConnectInfo, error)` - Read API token from K8s Secret `qwenpaw-token-{userID}`, get ingress host from CR status

Note: You'll need to add the workpaw-operator module as a dependency:
```bash
go get github.com/workpaw/workpaw-operator@latest
```

If the operator module isn't published, use a local replace directive in go.mod:
```
replace github.com/workpaw/workpaw-operator => /Users/zhangsan/workpaw/workpaw-operator
```

Then: `go get github.com/workpaw/workpaw-operator/api/v1alpha1`

### 2. `internal/handler/instance.go`

```go
package handler

type InstanceHandler struct {
    instanceService *service.InstanceService
    logger          *zap.Logger
}

func NewInstanceHandler(svc *service.InstanceService, logger *zap.Logger) *InstanceHandler
func (h *InstanceHandler) GetInstance(c *gin.Context)      // GET /api/instance
func (h *InstanceHandler) ActivateInstance(c *gin.Context) // POST /api/instance/activate
func (h *InstanceHandler) DeactivateInstance(c *gin.Context) // POST /api/instance/deactivate
func (h *InstanceHandler) GetConnectInfo(c *gin.Context)   // GET /api/instance/connect
```

Each handler extracts userID from JWT claims (stored in gin context by auth middleware via key "workpaw_claims").

**Important:** The auth middleware stores `*service.WorkPawClaims` under key "workpaw_claims". Add a helper:
```go
func getClaims(c *gin.Context) *service.WorkPawClaims {
    val, _ := c.Get("workpaw_claims")
    claims, _ := val.(*service.WorkPawClaims)
    return claims
}
```

### 3. Update `internal/router/router.go`

Add instance routes AFTER auth routes:
```go
// Instance routes (require auth)
instanceGroup := r.Group("/api/instance")
instanceGroup.Use(middleware.Auth(jwtSvc))
instanceGroup.GET("", instanceHandler.GetInstance)
instanceGroup.POST("/activate", instanceHandler.ActivateInstance)
instanceGroup.POST("/deactivate", instanceHandler.DeactivateInstance)
instanceGroup.GET("/connect", instanceHandler.GetConnectInfo)
```

### Acceptance

- `go build ./...` passes
- Instance service can create/read/update QwenPawInstance CRDs
- Connect info reads token from K8s Secret
- Commit: `feat: implement instance management API`

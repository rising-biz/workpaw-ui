# Task 2.3: Reconcile - 创建/停止实例

**Work in:** `/Users/zhangsan/workpaw/workpaw-operator`

**Files to modify:**
- `internal/controller/qwenpawinstance_controller.go`

**Implement the full Reconcile logic:**

### Core Reconcile method:
```go
func (r *QwenPawInstanceReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    // 1. Get the QwenPawInstance CR
    // 2. Switch on spec.desiredState:
    //    - "Running" → reconcileRunning()
    //    - "Stopped" → reconcileStopped()
}
```

### reconcileRunning:
1. **ensureTokenSecret** - Create Secret `qwenpaw-token-{username}` with random UUID v4 token (key: `api-token`)
2. **ensureStatefulSet** - Create StatefulSet with:
   - replicas=1
   - image from spec.image
   - env QWENPAW_TOKEN from Secret
   - VolumeClaimTemplate from spec.storage
   - port 8080
3. **ensureService** - ClusterIP Service targeting the StatefulSet
4. **ensureIngress** - Ingress with host `{username}.{baseDomain}`, TLS
5. **updateStatus** - Check Pod readiness, update status.currentState, status.ingressHost

### reconcileStopped:
1. Scale StatefulSet replicas to 0 (keep PVC data)
2. Update status.currentState to "Stopped"

### Required imports:
- `appsv1 "k8s.io/api/apps/v1"`
- `corev1 "k8s.io/api/core/v1"`
- `networkingv1 "k8s.io/api/networking/v1"`
- `"github.com/google/uuid"`

### Config access:
The reconciler needs a `Config` struct field with `BaseDomain`, `IngressClass`, `TLSSecret`, `StorageClass`, default resource values. Add a `Config` field to the reconciler struct.

### RBAC markers needed at top of file:
```go
//+kubebuilder:rbac:groups=workpaw.workpaw.io,resources=qwenpawinstances,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=workpaw.workpaw.io,resources=qwenpawinstances/status,verbs=get;update;patch
//+kubebuilder:rbac:groups=workpaw.workpaw.io,resources=qwenpawinstances/finalizers,verbs=update
//+kubebuilder:rbac:groups=apps,resources=statefulsets,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups="",resources=services;secrets;configmaps,verbs=get;list;watch;create;update;patch;delete
//+kubebuilder:rbac:groups=networking.k8s.io,resources=ingresses,verbs=get;list;watch;create;update;patch;delete
```

**Acceptance:** `go build ./...` passes. Reconcile handles Running (create all resources) and Stopped (scale to 0). Status is updated correctly.

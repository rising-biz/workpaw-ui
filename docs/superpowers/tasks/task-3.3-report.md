# Task 3.3 Report: Instance Management API

**Status:** DONE
**Commit:** c8e58e5 feat: implement instance management API

## What Was Built

### Files Created

1. **`internal/service/instance.go`** - InstanceService managing QwenPawInstance CRDs
   - `NewInstanceService(cfg)` - Initializes K8s clients (in-cluster or kubeconfig fallback), registers CRD scheme
   - `GetInstance(ctx, userID)` - Gets QwenPawInstance CR by name (userID), maps to InstanceStatus
   - `ActivateInstance(ctx, userID, email)` - Creates new CR or updates existing to desiredState=Running
   - `DeactivateInstance(ctx, userID)` - Sets desiredState=Stopped (no-op if CR missing)
   - `GetConnectInfo(ctx, userID)` - Reads API token from K8s Secret `qwenpaw-token-{userID}`, builds ingress URL

2. **`internal/handler/instance.go`** - InstanceHandler with Gin endpoints
   - `GET /api/instance` - Returns instance status
   - `POST /api/instance/activate` - Creates or resumes instance
   - `POST /api/instance/deactivate` - Stops instance
   - `GET /api/instance/connect` - Returns ingress URL + API token
   - `getClaims()` helper extracts `*service.WorkPawClaims` from gin context

3. **`internal/middleware/middleware.go`** - Added Auth middleware
   - Validates `Authorization: Bearer <token>` header
   - Stores `*service.WorkPawClaims` in context under key `"workpaw_claims"`
   - Returns 401 on missing/invalid/expired token

### Files Modified

4. **`internal/router/router.go`** - Added instance routes after auth routes
   - Instance group `/api/instance` with Auth middleware
   - Graceful degradation: warns and skips routes if K8s is unreachable

### Dependencies Added

- `github.com/workpaw/workpaw-operator` via local replace directive
- `k8s.io/api@v0.36.0`, `k8s.io/client-go@v0.36.0`, `sigs.k8s.io/controller-runtime@v0.24.1`
- Transitive K8s deps: apimachinery, kube-openapi, klog, structured-merge-diff, etc.

## Build Verification

- `go build ./...` - PASS (zero errors)
- `go vet ./...` - PASS (zero warnings)
- `go mod tidy` - Clean (no unused deps)

## Test Summary

No unit tests were written (not in task scope). Manual verification:
- All files compile cleanly
- All Go vet checks pass
- Module dependencies resolve correctly

## Design Decisions

1. **Graceful K8s degradation**: If K8s is unreachable at startup, instance routes are skipped (warn log) rather than crashing the server. Auth routes still work.

2. **Scheme registration**: Only `corev1` and `workpawv1alpha1` are registered in the scheme (no full client-go scheme) to keep the binary lean.

3. **Ingress URL fallback**: If CR status has no ingressHost yet, falls back to `{userID}.{baseDomain}` from config.

4. **Deactivate idempotency**: Deactivating a non-existent instance returns nil (already stopped).

5. **Auth middleware placement**: Added to `middleware.go` alongside existing CORS/RequestID/Logger, following the established pattern.

## Concerns

- **No unit tests**: The task brief did not include tests. Controller-runtime's `envtest` would be ideal for integration tests but requires a real API server binary.
- **Operator replace directive**: The `go.mod` uses a local `replace` directive pointing to `/Users/zhangsan/workpaw/workpaw-operator`. This must be updated to a proper module path/version before production deployment.
- **No RBAC/authorization**: All authenticated users can manage their own instance. Admin-level operations (listing all instances, etc.) are not yet implemented (planned for Task 3.4).
- **Secret naming convention**: The API token secret name `qwenpaw-token-{userID}` assumes the operator creates this secret. If the operator changes this convention, the control plane must be updated.

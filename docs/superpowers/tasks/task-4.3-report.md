# Task 4.3 Report: 容器状态页

## Status: DONE

## Commit

- `3fe1300` feat: implement container status page with polling

## Files Changed

### Created
- `src/stores/useInstanceStore.ts` - Zustand store for container instance management
  - Types: `InstanceStatus`, `InstanceInfo`, `InstanceState`
  - Actions: `fetchInstance`, `activate`, `deactivate`, `pollUntilRunning`
  - Polling: up to 60 iterations at 3-second intervals (3 minutes max)
  - Auth header reads `workpaw_token` from localStorage
  - Control plane URL from `VITE_CONTROL_PLANE_URL` env var (defaults to `http://localhost:8080`)

- `src/pages/ContainerStatus.tsx` - Container status UI page
  - Shows spinner + "正在检测容器状态..." while loading
  - Shows "新建部署" button when status is `not_found`
  - Shows "激活容器" button when status is `stopped`
  - Shows spinner + "容器正在启动中，请稍候..." when status is `creating`
  - Shows error message in red when error exists

### Modified
- `src/App.tsx` - Integrated container status routing
  - Added `useInstanceStore` import and usage
  - Added `useEffect` to fetch instance when authenticated
  - Routes to `ContainerStatusPage` when instance is null or not running
  - Shows "WorkPaw - 容器运行中" placeholder when instance is running (Task 4.4 will replace with Chat page)

## Build Verification

- `pnpm build` passes cleanly
- TypeScript compilation: OK
- Vite build: 42 modules transformed, built in 567ms

## Concerns

None. Implementation follows the task brief exactly. No files from Task 4.4 were touched.

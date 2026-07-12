# Task 4.3: 容器状态页

**Work in:** `/Users/zhangsan/workpaw/workpaw-desktop`

## Files to Create

### 1. `src/stores/useInstanceStore.ts`

```typescript
import { create } from "zustand";

type InstanceStatus = "not_found" | "creating" | "running" | "stopped";

interface InstanceInfo {
  status: InstanceStatus;
  ingress_url: string;
  api_token: string;
  created_at: string;
  last_active_at: string;
  policy: {
    idle_timeout_minutes: number;
    schedule_stop: string;
  };
}

interface InstanceState {
  instance: InstanceInfo | null;
  loading: boolean;
  error: string | null;
  fetchInstance: () => Promise<void>;
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  pollUntilRunning: () => Promise<void>;
}

function getControlPlaneUrl(): string {
  return import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8080";
}

function getAuthHeader(): HeadersInit {
  const token = localStorage.getItem("workpaw_token") || "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export const useInstanceStore = create<InstanceState>((set, get) => ({
  instance: null,
  loading: false,
  error: null,

  fetchInstance: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${getControlPlaneUrl()}/api/instance`, {
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const instance = await res.json();
      set({ instance, loading: false });
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  activate: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${getControlPlaneUrl()}/api/instance/activate`, {
        method: "POST",
        headers: getAuthHeader(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await get().pollUntilRunning();
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  deactivate: async () => {
    try {
      await fetch(`${getControlPlaneUrl()}/api/instance/deactivate`, {
        method: "POST",
        headers: getAuthHeader(),
      });
      set((state) => ({
        instance: state.instance ? { ...state.instance, status: "stopped" } : null,
      }));
    } catch (err) {
      set({ error: String(err) });
    }
  },

  pollUntilRunning: async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`${getControlPlaneUrl()}/api/instance`, {
          headers: getAuthHeader(),
        });
        const instance = await res.json();
        set({ instance });
        if (instance.status === "running") {
          set({ loading: false });
          return;
        }
      } catch {
        // retry
      }
    }
    set({ error: "容器启动超时，请重试", loading: false });
  },
}));
```

### 2. `src/pages/ContainerStatus.tsx`

```tsx
import { useEffect } from "react";
import { useInstanceStore } from "../stores/useInstanceStore";

export function ContainerStatusPage() {
  const { instance, loading, error, fetchInstance, activate } = useInstanceStore();

  useEffect(() => {
    fetchInstance();
  }, [fetchInstance]);

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-96 space-y-6 text-center">
        <h2 className="text-xl font-semibold">QwenPaw 容器</h2>

        {loading && (
          <div className="space-y-4">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-gray-500">正在检测容器状态...</p>
          </div>
        )}

        {!loading && instance?.status === "not_found" && (
          <div className="space-y-4">
            <p className="text-gray-500">尚未部署个人 QwenPaw 容器</p>
            <button onClick={activate} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white hover:bg-blue-700">
              新建部署
            </button>
          </div>
        )}

        {!loading && instance?.status === "stopped" && (
          <div className="space-y-4">
            <p className="text-gray-500">容器已停止</p>
            <button onClick={activate} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white hover:bg-blue-700">
              激活容器
            </button>
          </div>
        )}

        {!loading && instance?.status === "creating" && (
          <div className="space-y-4">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-gray-500">容器正在启动中，请稍候...</p>
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
```

### 3. Update `src/App.tsx`

Replace the "Loading..." placeholder with proper routing:
- If `instance.status !== "running"` → show `ContainerStatusPage`
- If `instance.status === "running"` → show Chat page placeholder (will be replaced by Task 4.4)

```tsx
import { useInstanceStore } from "./stores/useInstanceStore";
import { ContainerStatusPage } from "./pages/ContainerStatus";

// In the App component, after auth check:
const { instance } = useInstanceStore();

// After auth check:
if (!isAuthenticated) return <LoginPage />;

// Fetch instance on auth
useEffect(() => {
  if (isAuthenticated) fetchInstance();
}, [isAuthenticated]);

if (!instance || instance.status !== "running") {
  return <ContainerStatusPage />;
}

// running → show main app (Chat placeholder for now)
return <div>WorkPaw - 容器运行中</div>;
```

### Acceptance

- InstanceStore created with fetch/activate/deactivate/poll
- ContainerStatusPage shows correct UI for each state (not_found, stopped, creating, running)
- App.tsx routes to ContainerStatusPage when not running
- `pnpm build` passes
- Commit: `feat: implement container status page with polling`

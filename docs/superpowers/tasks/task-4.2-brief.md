# Task 4.2: SSO 登录页

**Work in:** `/Users/zhangsan/workpaw/workpaw-desktop`

**Files to create:**

### 1. `src/stores/useAuthStore.ts` - Auth 状态管理 (zustand)

```typescript
import { create } from "zustand";

interface AuthUser {
  userId: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  loadFromStorage: () => void;
}

const TOKEN_KEY = "workpaw_token";

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  setToken: (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, isAuthenticated: true });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  loadFromStorage: () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      set({ token, isAuthenticated: true });
    }
  },
}));
```

### 2. `src/pages/Login.tsx` - SSO 登录页

```tsx
import { useState } from "react";
import { open } from "@tauri-apps/plugin-shell";

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlPlaneUrl = import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8080";

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${controlPlaneUrl}/api/auth/login`);
      if (!response.ok) throw new Error("Failed to get login URL");
      const data = await response.json();
      await open(data.auth_url);
    } catch (err) {
      setError("登录失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-80 space-y-6 text-center">
        <h1 className="text-2xl font-bold">WorkPaw</h1>
        <p className="text-gray-500">企业级 AI 助手</p>
        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "正在打开浏览器..." : "企业账号登录"}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
```

### 3. `src/lib/deepLink.ts` - Deep Link 回调处理

```typescript
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useAuthStore } from "../stores/useAuthStore";

export function setupDeepLink() {
  onOpenUrl((urls) => {
    const url = urls[0];
    if (!url) return;

    try {
      const parsed = new URL(url);
      if (parsed.protocol === "workpaw:" && parsed.hostname === "callback") {
        const token = parsed.searchParams.get("token");
        if (token) {
          useAuthStore.getState().setToken(token);
        }
      }
    } catch {
      console.error("Failed to parse deep link URL:", url);
    }
  });
}
```

### 4. Update `src/App.tsx` - Wire up auth flow

Replace the existing App component with auth-aware routing:
- Call `useAuthStore.loadFromStorage()` on mount
- Call `setupDeepLink()` on mount
- If not authenticated → show LoginPage
- If authenticated → show a placeholder "Loading..." (will be replaced by ContainerStatus in next task)

### 5. Update `src/main.tsx`

Import the CSS file if not already imported: `import "./index.css";`

### 6. Install missing Tauri plugins if needed:

```bash
pnpm add @tauri-apps/plugin-shell @tauri-apps/plugin-deep-link
```

Check `src-tauri/Cargo.toml` for the Rust side plugins. If they're not there, add:
```toml
tauri-plugin-shell = "2"
tauri-plugin-deep-link = "2"
```

Check `src-tauri/src/main.rs` or `src-tauri/src/lib.rs` to ensure plugins are registered.

### 7. Configure deep link in `src-tauri/tauri.conf.json` or capabilities:

Add deep link scheme `workpaw` to the Tauri configuration. Check the Tauri 2 docs for the correct format (it may be in capabilities/*.json).

**Acceptance:** Login page renders, clicking login button calls Control Plane /api/auth/login, deep link handler is set up. App shows Login when not authenticated.

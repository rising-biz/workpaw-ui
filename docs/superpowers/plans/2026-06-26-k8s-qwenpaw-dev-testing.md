# K8s QwenPaw Dev Testing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将开发/测试从前端直连本地 QwenPaw 进程（127.0.0.1:8088）切换为通过 control-plane 走真实 K8s QwenPaw 容器（dev-login → `/api/instance/activate` → `/api/instance/connect` → Pod ingress）。

**Architecture:** 现有集群已部署 operator + CRD + ingress。control-plane 本地以 debug 模式运行，经 kubeconfig 直连集群读写 `QwenPawInstance` CR 与 token Secret。前端本地运行，dev-login 拿 JWT 后自动激活 `test` 实例并经 `/api/instance/connect` 取得 `https://test.qwenpaw.workpaw.internal` + api_token，随后所有 Pod API 调用直连该 ingress 并带 Bearer。本机用 `/etc/hosts` + mkcert 解决 DNS/TLS，operator 零改动。

**Tech Stack:** React 19 + Vite + Zustand（web/desktop/admin）；Go + Gin + Viper（control-plane）；K8s + operator-sdk（operator）；vitest（desktop/admin 测试）。

## Global Constraints

- QwenPaw 镜像锁定 `agentscope/qwenpaw:v1.1.12`，不得升级。
- `ingress.base_domain` 必须为 `qwenpaw.workpaw.internal`（与 operator 硬编码一致）。
- dev-login 用户固定 `test@workpaw.local` → `instanceName` → `test` → ingress 主机 `test.qwenpaw.workpaw.internal`。
- control-plane 必须以 `debug` 模式运行（注册 `POST /api/auth/dev-login`）。
- 实例命名空间 `workpaw-instances`。
- **不修改 operator 代码**（除非 Task 6 触发 CORS 兜底，届时单独评估）。
- 前端 UI 文案用中文（与现有一致）。
- 三个前端各自独立 git 仓库，提交按仓库分别进行。

## File Structure

| 仓库 | 文件 | 责任 | 动作 |
|---|---|---|---|
| workpaw-web | `.env.development` | dev 环境变量 | 改 |
| workpaw-web | `src/lib/api.ts` | control-plane API 客户端；加 `devLogin()` | 改 |
| workpaw-web | `src/stores/useInstanceStore.ts` | 实例激活/轮询/连接编排 + token 桥接 | 改（重写） |
| workpaw-web | `src/components/InstanceBootstrap.tsx` | 认证后驱动 ensureConnected 并门控渲染 | 新建 |
| workpaw-web | `src/App.tsx` | `RequireAuth` 去 dev 旁路；挂载 InstanceBootstrap | 改 |
| workpaw-web | `src/pages/Login.tsx` | dev 模式一键 dev-login | 改 |
| workpaw-web | `src/vite-env.d.ts` | 更新 env 注释 | 改 |
| workpaw-desktop | `.env` | 去 `VITE_POD_URL`，加 `VITE_DEV_MODE` | 改 |
| workpaw-desktop | `src/App.tsx` | 删除 `directPodUrl` 旁路 | 改 |
| workpaw-desktop | `src/pages/Login.tsx` | dev 模式 dev-login 为主路径 | 改 |
| workpaw-desktop | `src/pages/Login.test.tsx` | 锁定 dev 模式 dev-login 行为 | 新建 |
| workpaw-control-plane/console | `.env.development` | control-plane URL | 新建/改 |
| workpaw-control-plane | `config.yaml` | 核对 K8s 配置（预期无需改） | 核对 |

---

## Task 1: 核对集群与 control-plane 前置条件（含 operator 本机运行）

> 已核实现状（2026-06-26）：物理 KubeSphere 集群；CRD 已装；`workpaw-system` 命名空间为空（operator 从未以 Deployment 部署）；ingress 由 `kubesphere-router`（ingress-nginx 衍生）提供，IngressClass `nginx`，实例 Ingress ADDRESS = 节点 IP `10.21.16.35/36/40`，443 可达；已有实例 `peizhenfei` Running 8 天；`qwenpaw-tls` Secret 不存在。
>
> **集群变更约束**：operator 本机 `make run`（不在集群内跑 Pod）；任何集群写操作（建 Secret 等）执行前必须给用户确切命令并经确认。

**Files:** 核对 `workpaw-control-plane/config.yaml`（预期无改动）

**Interfaces:** 产出"operator 运行中、control-plane 可用、dev-login 可用、test 实例可激活"的运行时前提，供后续任务验证。

- [ ] **Step 1: 只读核对集群现状**

Run（只读）:
```
export KUBECONFIG=~/.kube/config
kubectl get crd qwenpawinstances.workpaw.workpaw.io
kubectl get ingressclass nginx
kubectl get qwenpawinstance -n workpaw-instances
kubectl get secret -n workpaw-instances | grep qwenpaw-token
```
Expected: CRD 存在；IngressClass `nginx` 存在；至少 `peizhenfei` 实例 Running；`qwenpaw-token-peizhenfei` 存在。`qwenpaw-tls` 此刻应不存在（Task 2 建）。

- [ ] **Step 2: 核对 control-plane `config.yaml`**

Run: `cat workpaw-control-plane/config.yaml`
Expected 包含且与集群一致：
- `server.mode: debug`
- `kubernetes.kubeconfig: /Users/zhangsan/.kube/config`
- `kubernetes.namespace: workpaw-instances`
- `kubernetes.qwenpaw_image: agentscope/qwenpaw:v1.1.12`
- `ingress.base_domain: qwenpaw.workpaw.internal`
- `postgres` 指向本地 5433；`jwt.private_key_path: keys/jwt.pem`

若 `server.mode` 非 debug，改为 `debug` 后提交：
```
cd workpaw-control-plane && git add config.yaml && git commit -m "chore: ensure debug mode for dev-login in dev config"
```
若全部一致，无提交。

- [ ] **Step 3: 本机启动 operator（`make run`）**

> 这是本机进程，非集群变更。它用 `~/.kube/config` 直连集群，监听 `QwenPawInstance` CR 变化并调谐 Pod/Service/Ingress/Secret。

Run（新终端，保持运行）:
```
cd workpaw-operator && make run
```
Expected: operator 日志显示 "Starting manager" / "Starting EventSource" 且无 RBAC/连接错误。保持该终端运行。若报权限错，检查 kubeconfig 用户对 `workpaw-instances` 命名空间 `qwenpawinstances` CRD 的读写权限（只读核对：`kubectl auth can-i create qwenpawinstances.workpaw.workpaw.io -n workpaw-instances`，应为 yes）。

- [ ] **Step 4: 启动 control-plane 并验证 health + dev-login**

Run（新终端）: `cd workpaw-control-plane && go run . serve --dev`
Run（另一终端）:
```
curl -s localhost:8090/health
curl -s -X POST localhost:8090/api/auth/dev-login
```
Expected: `/health` 返回 JSON 且 k8s 字段为 ok；`dev-login` 返回 `{"access_token":"...","refresh_token":"...","user":{"user_id":"test-user","email":"test@workpaw.local",...}}`。若 dev-login 404，说明未以 debug 启动，回到 Step 2。

- [ ] **Step 5: 用 dev-login token 验证可创建 test 实例并取 connect 信息**

> 此步会**在集群中创建** `qwenpawinstance/test` CR 及其 Pod/Service/Ingress/`qwenpaw-token-test` Secret（由 Step 3 的 operator 调谐）。这是本次工作预期的创建，但执行前向用户说明。

把 Step 4 的 access_token 存入 `$T`，Run：
```
T=<粘贴 access_token>
curl -s -H "Authorization: Bearer $T" localhost:8090/api/instance
curl -s -X POST -H "Authorization: Bearer $T" localhost:8090/api/instance/activate
# 轮询至 running（operator 调谐，最多 ~3 分钟）
curl -s -H "Authorization: Bearer $T" localhost:8090/api/instance
curl -s -H "Authorization: Bearer $T" localhost:8090/api/instance/connect
```
Expected: activate 后 `GET /api/instance` 的 `status` 最终为 `running`；`connect` 返回 `{"ingress_url":"https://test.qwenpaw.workpaw.internal","api_token":"<uuid>"}`。同时 `kubectl get qwenpawinstance test -n workpaw-instances` 为 Running、`kubectl get secret qwenpaw-token-test -n workpaw-instances` 存在、`kubectl get ingress qwenpaw-test -n workpaw-instances` 存在且 ADDRESS 含 `10.21.16.35`。

---

## Task 2: 配置本机可达性（DNS + TLS + NodePort）

> 已核实：kubesphere-router Service 为 **NodePort**，HTTPS 在 **NodePort 30167**（非标准 443；节点 443 虽开但 TLS 握手被 reset）。`10.21.16.35:30167` 可达且 mkcert 证书受信任。`qwenpaw-tls` Secret 原不存在 → mkcert 造通配证书为**必做**，peizhenfei 与 test 实例 Ingress 均引用 `qwenpaw-tls`，共用。
>
> 因 TLS 在 30167，control-plane 必须返回带 `:30167` 的 URL（否则前端打 :443 失败）→ 触发"ingress 非 443 兜底"：control-plane `IngressConfig` 加 `Port`，`instance.go` 两处 URL 拼接加端口后缀，`config.yaml` 配 `ingress.port: 30167`。**此兜底已执行**（Task 1 末）。
>
> **集群变更约束**：`/etc/hosts` 是本机变更；`kubectl apply` 建 `qwenpaw-tls` Secret 是集群变更，执行前必须给用户确切命令并经确认。

**Files:** control-plane 代码改动已在 Task 1 兜底完成；本任务无新增仓库文件改动。

**Interfaces:** 产出可访问的 `https://test.qwenpaw.workpaw.internal:30167/api/agent/health`（受信任证书），供 Task 3/4/6 验证。

- [ ] **Step 1: 添加 `/etc/hosts` 条目（本机变更，待用户 sudo）**

Run（需 sudo，用户在终端执行）:
```
echo "10.21.16.35  test.qwenpaw.workpaw.internal" | sudo tee -a /etc/hosts
```
Expected: 文件新增一行。验证：`ping -c1 test.qwenpaw.workpaw.internal` 解析到 `10.21.16.35`。

- [x] **Step 2: mkcert 造本地可信通配证书（本机）** — 已完成

已生成 `/Users/zhangsan/workpaw/_wildcard.qwenpaw.workpaw.internal.pem` 与 `-key.pem`；mkcert 根 CA 已在系统钥匙串。

- [x] **Step 3: 创建 `qwenpaw-tls` Secret（集群变更）** — 已完成（用户已确认）

`kubectl get secret qwenpaw-tls -n workpaw-instances` 存在（kubernetes.io/tls，2 data）。peizhenfei 与 test 的 Ingress 均引用之。

- [ ] **Step 4: 验证 Pod 健康端点可达且证书受信任**

Run（待 /etc/hosts 就绪）:
```
curl -s https://test.qwenpaw.workpaw.internal:30167/api/agent/health
```
Expected: 200 且 `{"status":"healthy",...}`，**无** `-k`。已用 `--resolve "test.qwenpaw.workpaw.internal:30167:10.21.16.35"` 验证通过；待 /etc/hosts 就绪后无需 `--resolve`。

- [ ] **Step 5: 浏览器复核**

浏览器访问 `https://test.qwenpaw.workpaw.internal:30167/api/agent/health`，确认无证书警告、返回 JSON。

---

## Task 3: workpaw-web 切换到 K8s 连接流程

**Files:**
- Modify: `workpaw-web/.env.development`
- Modify: `workpaw-web/src/lib/api.ts`
- Modify: `workpaw-web/src/stores/useInstanceStore.ts`
- Create: `workpaw-web/src/components/InstanceBootstrap.tsx`
- Modify: `workpaw-web/src/App.tsx`
- Modify: `workpaw-web/src/pages/Login.tsx`
- Modify: `workpaw-web/src/vite-env.d.ts`

**Interfaces:**
- Consumes: control-plane `POST /api/auth/dev-login`、`GET /api/instance`、`POST /api/instance/activate`、`GET /api/instance/connect`（均已在 `ControlPlaneApi` 实现或本任务新增 `devLogin`）。
- Produces: `useInstanceStore.ensureConnected()`（认证后调用一次，完成激活→轮询→连接→桥接）；`setApiBaseUrl(ingress_url)` + `setAuthToken(api_token)` 使 `api/request.ts` 全部页面请求自动指向 Pod 并带 Bearer。

> web 仓库无 vitest（`package.json` 无 test 脚本），本任务以 `tsc` 类型检查 + 浏览器手动验证为门控（与该仓库既有模式一致）。

- [ ] **Step 1: 改 `.env.development`**

写入 `workpaw-web/.env.development`（完整内容）：
```
VITE_CONTROL_PLANE_URL=http://localhost:8090
VITE_DEV_MODE=true
```
（删除原 `VITE_API_BASE_URL=http://127.0.0.1:8088` 行。）

- [ ] **Step 2: 在 `src/lib/api.ts` 的 `ControlPlaneApi` 增加 `devLogin`**

在文件顶部 `import type {...}` 区域追加 `DevLoginResponse` 类型（与现有类型并列）：
```ts
export interface DevLoginResponse {
  access_token: string;
  refresh_token?: string;
  user: {
    user_id: string;
    email: string;
    name: string;
    roles: string[];
  };
}
```
在 `ControlPlaneApi` 类内（`getConnectInfo` 之后）新增方法：
```ts
  devLogin(): Promise<DevLoginResponse> {
    return this.client.post<DevLoginResponse>("/api/auth/dev-login");
  }
```

- [ ] **Step 3: 重写 `src/stores/useInstanceStore.ts`**

完整替换文件内容：
```ts
import { create } from "zustand";
import {
  createControlPlaneApi,
  createPodAgentApi,
  type PodAgentApi,
} from "@/lib/api";
import type { InstanceInfo, InstanceConnectResponse } from "@/types";
import { useAuthStore } from "./useAuthStore";
import { setApiBaseUrl, setAuthToken } from "@/api/config";

// ---------------------------------------------------------------------------
// Instance store — drives the Control Plane → K8s Pod connect flow.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 60; // 3 min

interface InstanceState {
  instance: InstanceInfo | null;
  connectInfo: InstanceConnectResponse | null;
  podAgentApi: PodAgentApi | null;
  connected: boolean;
  isLoading: boolean;
  error: string | null;

  fetchInstance: () => Promise<void>;
  activateInstance: () => Promise<void>;
  pollUntilRunning: () => Promise<void>;
  ensureRunning: () => Promise<void>;
  connectToPod: () => Promise<void>;
  ensureConnected: () => Promise<void>;
  reset: () => void;
}

export const useInstanceStore = create<InstanceState>((set, get) => ({
  instance: null,
  connectInfo: null,
  podAgentApi: null,
  connected: false,
  isLoading: false,
  error: null,

  fetchInstance: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = useAuthStore.getState().token;
      const api = createControlPlaneApi(() => token);
      const instance = await api.getInstance();
      set({ instance, isLoading: false });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "获取实例信息失败";
      set({ error: message, isLoading: false });
    }
  },

  activateInstance: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = useAuthStore.getState().token;
      const api = createControlPlaneApi(() => token);
      const instance = await api.activateInstance();
      set({ instance });
    } catch (err) {
      const message = err instanceof Error ? err.message : "激活实例失败";
      set({ error: message, isLoading: false });
    }
  },

  pollUntilRunning: async () => {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      try {
        const token = useAuthStore.getState().token;
        const api = createControlPlaneApi(() => token);
        const instance = await api.getInstance();
        set({ instance });
        if (instance.status === "running") {
          set({ isLoading: false });
          return;
        }
      } catch {
        // retry
      }
    }
    set({ error: "AI 助手启动超时，请稍后重试", isLoading: false });
  },

  ensureRunning: async () => {
    await get().fetchInstance();
    const status = get().instance?.status;
    if (status && status !== "running") {
      await get().activateInstance();
      await get().pollUntilRunning();
    }
  },

  connectToPod: async () => {
    set({ isLoading: true, error: null });
    try {
      const token = useAuthStore.getState().token;
      const api = createControlPlaneApi(() => token);
      const connectInfo = await api.getConnectInfo();
      const podAgentApi = createPodAgentApi(
        connectInfo.ingress_url,
        connectInfo.api_token,
      );
      // Bridge to the page-level API stack (api/request.ts): route all
      // /api/* calls to the pod ingress and attach the pod API token.
      setApiBaseUrl(connectInfo.ingress_url);
      setAuthToken(connectInfo.api_token);
      set({ connectInfo, podAgentApi, connected: true, isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "连接 Pod 失败";
      set({ error: message, isLoading: false });
    }
  },

  ensureConnected: async () => {
    await get().ensureRunning();
    if (get().instance?.status === "running") {
      await get().connectToPod();
    }
  },

  reset: () => {
    setApiBaseUrl(null);
    set({
      instance: null,
      connectInfo: null,
      podAgentApi: null,
      connected: false,
      isLoading: false,
      error: null,
    });
  },
}));
```

- [ ] **Step 4: 新建 `src/components/InstanceBootstrap.tsx`**

完整内容：
```tsx
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/useAuthStore";
import { useInstanceStore } from "@/stores/useInstanceStore";

/**
 * After authentication, drives the Control Plane → K8s Pod connect flow
 * (ensureConnected) and gates rendering of children until the pod is
 * connected, so page-level API calls always have a base URL + token.
 */
export function InstanceBootstrap({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const connected = useInstanceStore((s) => s.connected);
  const error = useInstanceStore((s) => s.error);
  const ensureConnected = useInstanceStore((s) => s.ensureConnected);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!token || started) return;
    setStarted(true);
    void ensureConnected();
  }, [token, started, ensureConnected]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {error ?? "正在连接您的 AI 助手..."}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 5: 改 `src/App.tsx` —— 去 dev 旁路 + 挂载 InstanceBootstrap**

改 `RequireAuth`（删除 VITE_DEV_MODE 放行分支），改为：
```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```
在 import 区追加：
```tsx
import { InstanceBootstrap } from "@/components/InstanceBootstrap";
```
把受保护路由元素改为包裹 `InstanceBootstrap`：
```tsx
          <Route
            path="/"
            element={
              <RequireAuth>
                <InstanceBootstrap>
                  <MainLayout />
                </InstanceBootstrap>
              </RequireAuth>
            }
          >
```
（其余路由不变。）

- [ ] **Step 6: 改 `src/pages/Login.tsx` —— dev 模式一键 dev-login**

在 import 区追加：
```tsx
import { createControlPlaneApi } from "@/lib/api";
```
把 `handleDevLogin` 替换为调用 API 的版本：
```tsx
  const handleDevLogin = async () => {
    setError(null);
    try {
      const api = createControlPlaneApi(() => null);
      const data = await api.devLogin();
      setToken(data.access_token);
      navigate("/");
    } catch {
      setError("Dev 登录失败，请确认 control-plane 已以 debug 模式运行");
    }
  };
```
把"开发模式"区块（原 `showDevMode` 粘贴 token 输入框整段，含 `setShowDevMode` 按钮、`{showDevMode && (...)}`）替换为：
```tsx
          {/* Dev mode: one-click dev-login (no real SSO) */}
          {import.meta.env.VITE_DEV_MODE === "true" && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleDevLogin}
              disabled={isLoading}
            >
              开发模式：一键登录
            </Button>
          )}
```
删除不再使用的 `devToken`/`setDevToken`/`showDevMode`/`setShowDevMode` state 与相关 `Input`/`Label` import（若 `Input`、`Label` 仅此处使用）。保留 SSO 主按钮 `handleLogin`。

- [ ] **Step 7: 改 `src/vite-env.d.ts` 注释**

完整替换文件内容：
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONTROL_PLANE_URL?: string;
  /** Legacy: local QwenPaw base URL. Unused in the K8s dev flow (pod URL comes from /api/instance/connect). */
  readonly VITE_API_BASE_URL?: string;
  /** When "true", use /api/auth/dev-login (no real SSO) and walk the real Control Plane → K8s Pod connect flow. */
  readonly VITE_DEV_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 8: 类型检查**

Run: `cd workpaw-web && npx tsc -b --noEmit`
Expected: 无错误。若该命令因项目引用配置报错，改用 `npm run build` 作为门控。

- [ ] **Step 9: 浏览器手动验证**

确保 Task 1/2 完成（control-plane 运行、Pod running、DNS/TLS 就绪）。Run: `cd workpaw-web && npm run dev`
在浏览器打开 dev 地址：
1. 自动跳转 `/login`，点击"开发模式：一键登录" → 跳转 `/`。
2. 观察 Network：先 `POST /api/auth/dev-login`（200），随后 `GET /api/instance`、`POST /api/instance/activate`、轮询 `GET /api/instance`，最后 `GET /api/instance/connect`（200，返回 `https://test.qwenpaw.workpaw.internal` + token）。
3. 进入 `/agents` 页面，确认 `GET https://test.qwenpaw.workpaw.internal/api/agents` 带 `Authorization: Bearer ...` 且 200 返回数据。
Expected: 全部成功，无 401/CORS/证书错误。若 CORS 预检失败，记录现象并到 Task 6 处理。

- [ ] **Step 10: 提交**

```
cd workpaw-web && git add -A && git commit -m "feat: switch dev flow to control-plane dev-login + K8s pod connect"
```

---

## Task 4: workpaw-desktop 移除本地旁路 + dev-login 为主

**Files:**
- Modify: `workpaw-desktop/.env`
- Modify: `workpaw-desktop/src/App.tsx`
- Modify: `workpaw-desktop/src/pages/Login.tsx`
- Create: `workpaw-desktop/src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: control-plane `POST /api/auth/dev-login`、`GET /api/instance`（store 已自带 `fetchInstance`→自动 `activate`→`pollUntilRunning`，无需改 store）。
- Produces: 无 `VITE_POD_URL` 旁路；dev 模式下 `LoginPage.handleLogin` 直接走 dev-login。

> desktop store（`useInstanceStore`）已实现自动激活（`fetchInstance` 内 `not_found`/`stopped` → `activate` → `pollUntilRunning`），本任务不改 store。

- [ ] **Step 1: 写失败测试 `src/pages/Login.test.tsx`**

完整内容：
```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./Login";

vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../lib/authCallback", () => ({ getAuthCallbackUrl: vi.fn() }));

describe("LoginPage (dev mode)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_DEV_MODE", "true");
    vi.stubEnv("VITE_CONTROL_PLANE_URL", "http://localhost:8090");
  });

  it("calls /api/auth/dev-login directly and stores the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "fake-jwt",
          user: {
            user_id: "test-user",
            email: "test@workpaw.local",
            name: "Test User",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: /登录/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:8090/api/auth/dev-login",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(localStorage.getItem("workpaw_token")).toBe("fake-jwt");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd workpaw-desktop && npx vitest run src/pages/Login.test.tsx`
Expected: FAIL（当前 `handleLogin` 在 dev 模式仍先调 `getAuthCallbackUrl`/`/api/auth/login`，不会直接打 `/api/auth/dev-login`；或按钮文案不匹配）。

- [ ] **Step 3: 改 `.env`**

写入 `workpaw-desktop/.env`（完整内容）：
```
VITE_CONTROL_PLANE_URL=http://localhost:8090
VITE_DEV_MODE=true
```
（删除原 `VITE_POD_URL=http://127.0.0.1:8088` 行。）

- [ ] **Step 4: 改 `src/App.tsx` —— 删除 `directPodUrl` 旁路**

完整替换 `App.tsx` 内容：
```tsx
import { useEffect, useState } from "react";
import { useAuthStore } from "./stores/useAuthStore";
import { useInstanceStore } from "./stores/useInstanceStore";
import { useChatStore } from "./stores/useChatStore";
import { LoginPage } from "./pages/Login";
import { ContainerGate } from "./components/ContainerGate";
import { ChatPage } from "./pages/Chat";
import { InboxPage } from "./pages/Inbox";
import { CronJobsPage } from "./pages/CronJobs";
import { FilesPage } from "./pages/Files";
import { MainLayout, type NavPage } from "./layouts/MainLayout";
import { setupAuthCallback } from "./lib/authCallback";

function getControlPlaneUrl(): string {
  return import.meta.env.VITE_CONTROL_PLANE_URL || "http://localhost:8090";
}

function App() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const loadFromStorage = useAuthStore((state) => state.loadFromStorage);
  const instance = useInstanceStore((state) => state.instance);
  const fetchInstance = useInstanceStore((state) => state.fetchInstance);
  const setConnection = useChatStore((state) => state.setConnection);

  const [currentPage, setCurrentPage] = useState<NavPage>("chat");

  useEffect(() => {
    loadFromStorage();
    setupAuthCallback();
  }, [loadFromStorage]);

  // Control Plane flow: fetch instance (auto-activates when not running).
  useEffect(() => {
    if (isAuthenticated) {
      fetchInstance();
    }
  }, [isAuthenticated, fetchInstance]);

  // When instance is running, fetch connect info and wire pod URL + token.
  useEffect(() => {
    if (!isAuthenticated || !instance || instance.status !== "running") return;

    const fetchConnectInfo = async () => {
      try {
        const token = localStorage.getItem("workpaw_token") || "";
        const res = await fetch(`${getControlPlaneUrl()}/api/instance/connect`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (res.ok) {
          const data = await res.json();
          setConnection(data.ingress_url, data.api_token);
          return;
        }
      } catch {
        // Fall back to instance data
      }
      if (instance.ingress_url && instance.api_token) {
        setConnection(instance.ingress_url, instance.api_token);
      }
    };

    fetchConnectInfo();
  }, [isAuthenticated, instance, setConnection]);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (!instance || instance.status !== "running") {
    return <ContainerGate />;
  }

  return (
    <MainLayout currentPage={currentPage} onNavigate={setCurrentPage}>
      {currentPage === "chat" && <ChatPage />}
      {currentPage === "inbox" && <InboxPage />}
      {currentPage === "cron" && <CronJobsPage />}
      {currentPage === "files" && <FilesPage />}
    </MainLayout>
  );
}

export default App;
```

- [ ] **Step 5: 改 `src/pages/Login.tsx` —— dev 模式 dev-login 为主路径**

把 `handleLogin` 替换为：
```tsx
  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      // Dev mode: skip OIDC, use dev-login directly.
      if (import.meta.env.VITE_DEV_MODE === "true") {
        const devResp = await fetch(`${controlPlaneUrl}/api/auth/dev-login`, { method: "POST" });
        if (!devResp.ok) throw new Error("Dev login failed");
        const data = await devResp.json();
        setToken(data.access_token);
        setUser({ userId: data.user.user_id, email: data.user.email, name: data.user.name });
        return;
      }
      // Production: OIDC via system browser.
      const callbackUrl = await getAuthCallbackUrl();
      const loginResp = await fetch(
        `${controlPlaneUrl}/api/auth/login?redirect_uri=${encodeURIComponent(callbackUrl)}`,
      );
      if (loginResp.status === 503) {
        const devResp = await fetch(`${controlPlaneUrl}/api/auth/dev-login`, { method: "POST" });
        if (!devResp.ok) throw new Error("Dev login failed");
        const data = await devResp.json();
        setToken(data.access_token);
        setUser({ userId: data.user.user_id, email: data.user.email, name: data.user.name });
        return;
      }
      if (!loginResp.ok) throw new Error("Failed to get login URL");
      const data = await loginResp.json();
      await open(data.auth_url);
    } catch {
      setError("登录失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };
```
把按钮文案改为按模式切换：
```tsx
          <Button onClick={handleLogin} disabled={loading} size="lg" className="w-full">
            {loading ? "登录中..." : import.meta.env.VITE_DEV_MODE === "true" ? "开发模式登录" : "企业账号登录"}
          </Button>
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `cd workpaw-desktop && npx vitest run src/pages/Login.test.tsx`
Expected: PASS。

- [ ] **Step 7: 类型检查 + 全量测试**

Run:
```
cd workpaw-desktop && npx tsc --noEmit
cd workpaw-desktop && npm test
```
Expected: 类型无错误；全部测试通过。

- [ ] **Step 8: 手动验证（Tauri dev）**

确保 Task 1/2 完成。Run: `cd workpaw-desktop && npm run tauri dev`
1. 登录页点击"开发模式登录" → 进入主界面（先经 ContainerGate"启动中"，Pod running 后进入）。
2. 观察 Network/日志：`dev-login` → `GET /api/instance` → 自动 `activate` → 轮询至 running → `GET /api/instance/connect` → `setConnection`。
3. 进入 Chat，发一条消息，确认走 `https://test.qwenpaw.workpaw.internal` 且带 Bearer，正常响应。
Expected: 全部成功。CORS 不影响 Tauri（非浏览器）。

- [ ] **Step 9: 提交**

```
cd workpaw-desktop && git add -A && git commit -m "feat: drop local pod bypass, use dev-login + control-plane connect"
```

---

## Task 5: workpaw-control-plane/console 配置 control-plane URL

**Files:**
- Create/Modify: `workpaw-control-plane/console/.env.development`

**Interfaces:** admin 仅连 control-plane（`/api/admin/*` + `/api/auth/dev-login`），不连 Pod。`devLogin()` 已存在于 `src/lib/api.ts`。

- [ ] **Step 1: 写 `.env.development`**

若不存在则创建 `workpaw-control-plane/console/.env.development`，内容：
```
VITE_CONTROL_PLANE_URL=http://localhost:8090
```
（admin 不需要 `VITE_DEV_MODE`；其 `devLogin()` 由登录页直接调用，与该标志无关。）

- [ ] **Step 2: 类型检查 + 测试**

Run:
```
cd workpaw-control-plane/console && npx tsc -b --noEmit
cd workpaw-control-plane/console && npm test
```
Expected: 无错误，测试通过（`.env` 改动不影响现有测试）。

- [ ] **Step 3: 手动验证**

确保 Task 1 完成（control-plane 运行）。Run: `cd workpaw-control-plane/console && npm run dev`
1. 登录页用 dev 登录（admin 已有 dev-login 入口）。
2. 进入仪表盘/用户/策略等页面，确认 `GET /api/admin/*` 正常加载（control-plane 返回数据）。
Expected: 管理页面正常。admin 不访问 Pod，无需 DNS/TLS。

- [ ] **Step 4: 提交**

```
cd workpaw-control-plane/console && git add -A && git commit -m "chore: pin control-plane URL for dev against K8s cluster"
```

---

## Task 6: 端到端验证 + CORS 兜底

**Files:** 无（仅验证；若触发 CORS 兜底则另起任务）

- [ ] **Step 1: 确认本机无本地 QwenPaw 进程**

Run: `lsof -iTCP:8088 -sTCP:LISTEN`
Expected: 无输出（无进程监听 8088）。

- [ ] **Step 2: web 端到端**

Run: `cd workpaw-web && npm run dev`，dev-login → `/agents` 拉到数据。打开 DevTools Network，确认所有 Pod 请求目的地为 `https://test.qwenpaw.workpaw.internal`、带 `Authorization: Bearer`、200。

- [ ] **Step 3: desktop 端到端**

Run: `cd workpaw-desktop && npm run tauri dev`，dev-login → Chat 发消息成功。

- [ ] **Step 4: admin 端到端**

Run: `cd workpaw-control-plane/console && npm run dev`，dev-login → 管理页面加载。

- [ ] **Step 5: CORS 预检检查（仅 web）**

在 web DevTools Network 中找到一条带 `Authorization` 的 Pod 请求，确认其前的 `OPTIONS` 预检返回 200 且含 `Access-Control-Allow-Headers: Authorization`。
- 若通过：完成。
- 若被拦（预检失败）：启用兜底——在 `workpaw-operator/internal/controller/qwenpawinstance_controller.go` 的 StatefulSet 容器 env（当前只有 `QWENPAW_TOKEN`、`QWENPAW_AUTH_ENABLED`）追加 QwenPaw 的 CORS 环境变量（查 QwenPaw 源码 `~/github/QwenPaw` 确认变量名，通常为 `QWENPAW_CORS_ORIGINS` 之类，设为允许 `http://localhost:5173`），`make deploy` 重新部署 operator，重启 `test` 实例 Pod 后重测。此为 operator 唯一允许的改动，单独提交：
```
cd workpaw-operator && git add -A && git commit -m "fix: allow web dev origin CORS on qwenpaw pod for dev testing"
```

- [ ] **Step 6: 验证标准核对**

确认全部满足：
- 本机无 8088 QwenPaw 进程。
- web/desktop/admin 均经 control-plane + K8s Pod 完成登录与读写。
- Pod 流量目的地为 `https://test.qwenpaw.workpaw.internal`。

---

## 兜底：ingress 非 443

仅当 Task 2 Step 3 发现 ingress 不在标准 443 可达时执行（否则跳过）。

- 在 `workpaw-control-plane/internal/config/config.go` 的 `IngressConfig` 增加 `Port int` 与 `Scheme string` 字段（mapstructure `port`/`scheme`），`Load()` 设默认 `Scheme:"https"`、`Port:0`。
- 改 `internal/service/instance.go:308` 与 `:363`：当 `Port>0` 时 URL 拼 `:Port`；当 `Scheme=="http"` 时用 `http://`。
- `config.yaml` 配 `ingress.scheme: http` 与 `ingress.port: <实际端口>`（并相应调整 TLS 策略，可能需要 ingress `ssl-redirect: "false"`）。
- `cd workpaw-control-plane && go build ./... && go run . serve --dev` 验证 connect 返回的 URL 带正确端口/协议。
- 提交：`cd workpaw-control-plane && git commit -m "feat: configurable ingress scheme/port for non-443 dev clusters"`。

## Self-Review（计划自检）

- **Spec 覆盖**：spec 第 3 节流程 → Task 1+3+4；第 4 节可达性 → Task 2；第 5 节 web 接线 → Task 3；desktop → Task 4；admin → Task 5；第 7 节验证 → Task 6；第 8 节风险兜底 → Task 6 Step 5 + 末尾"ingress 非 443"。operator 零改动 → 仅 Task 6 Step 5/CORS 兜底例外。✓
- **占位符**：`<INGRESS_ADDR>`、`<实际端口>`、`<粘贴 access_token>` 均为运行时由命令产出/填入的值，已给出获取命令，非 TBD。无其它占位符。✓
- **类型一致**：`devLogin()` 返回 `DevLoginResponse`（Task 3 Step 2 定义），Login.tsx 用 `data.access_token`/`data.user.*`（一致）；`ensureConnected`/`connected`（store 定义，InstanceBootstrap 消费，命名一致）；desktop `setToken`/`setUser` 签名与 `useAuthStore` 一致。✓

# 设计：用 Kubernetes 中的 QwenPaw 容器进行开发测试

- 日期：2026-06-26
- 状态：待评审
- 范围：workpaw-web、workpaw-desktop、workpaw-control-plane/console、workpaw-control-plane（workpaw-operator、workpaw-ui 不改）

## 1. 背景与目标

当前开发/测试时，前端绕过 control-plane，直连本机 QwenPaw 进程：

- `workpaw-web/.env.development`：`VITE_API_BASE_URL=http://127.0.0.1:8088` + `VITE_DEV_MODE=true`，跳过 SSO、直连本地 QwenPaw。
- `workpaw-desktop/.env`：`VITE_POD_URL=http://127.0.0.1:8088`，跳过 control-plane、直连本地 QwenPaw。
- `workpaw-control-plane/console` / `workpaw-ui`：不连 QwenPaw。

目标：不再使用本地 QwenPaw 进程，改为使用 Kubernetes 中的 QwenPaw 容器进行测试，并更新各服务配置。前端走真实 K8s 链路：dev-login（免真实 IdP）→ 本地 control-plane → 真实 `QwenPawInstance` CR + token Secret + Ingress → 集群中的 `agentscope/qwenpaw:v1.1.12` 容器。

## 2. 关键决策（已与用户确认）

1. **目标集群**：已有集群在跑（operator + CRD + ingress 已装），本次只改各服务配置指向它，不搭集群。
2. **前端流程**：dev-login + 真实 K8s 连接流程（不用真实 SSO，但走真实 `/api/instance/connect`）。dev 用户实例**自动激活**，无需手动点"启动"。
3. **可达性**：本机不解析 `*.qwenpaw.workpaw.internal`，采用方案 1——`/etc/hosts` + mkcert，不改 operator。
4. **方案 1 要点**：单 dev-login 用户（`test@workpaw.local` → 实例名 `test` → ingress 主机 `test.qwenpaw.workpaw.internal`），保留 `base_domain=qwenpaw.workpaw.internal` 与 `qwenpaw-tls` Secret，operator 零改动，真实 HTTPS。

## 3. 目标 dev 流程

control-plane 本地运行（`go run . serve --dev`，`:8090`，debug 模式）。前端本地运行，流程如下：

1. `POST /api/auth/dev-login` → `{access_token, refresh_token, user{test@workpaw.local, roles:[user,admin]}}`；JWT 存为 `workpaw_token`。
2. `GET /api/instance` → 首次 `{status:"not_found"}`。
3. `POST /api/instance/activate` → 创建 `QwenPawInstance` CR `test`（`DesiredState:Running`）；operator 调谐出 StatefulSet + Service + Ingress + `qwenpaw-token-test` Secret。
4. 轮询 `GET /api/instance` 至 `status:"running"`。
5. `GET /api/instance/connect` → `{ingress_url:"https://test.qwenpaw.workpaw.internal", api_token:<uuid>}`。
6. 前端设置 Pod base URL = `ingress_url`，后续所有 Pod API 调用带 `Authorization: Bearer <api_token>`。

dev-login 用户固定为 `test@workpaw.local`（`internal/handler/auth.go:316` DevLogin），`instanceName` 取邮箱本地部分 → `test`（`internal/service/instance.go:119`）。

## 4. Layer 2：本地访问 Pod ingress

### 4.1 DNS — 一行 `/etc/hosts`
```
<INGRESS_ADDR>  test.qwenpaw.workpaw.internal
```
- `<INGRESS_ADDR>` 取自集群 ingress controller 可达地址：LB 类型用 `kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}'`；kind/port-forward 场景用 `127.0.0.1`。
- 单 dev 用户，一行足够。

### 4.2 端口前提（风险点）
control-plane 构造 URL 不带端口（`instance.go:308`、`:363`：`https://{name}.{base_domain}`，默认 443）。因此 ingress controller 必须在 `<INGRESS_ADDR>:443` 可达。
- **假设**：集群 ingress 在标准 443 可达（默认路径）。
- **兜底**（仅当不在 443）：给 `IngressConfig` 加 `port`/`scheme` 字段，改 `instance.go:308` 与 `:363` 拼接逻辑，`config.yaml` 配 `ingress.port`。

### 4.3 TLS
先查现有证书：
```
kubectl get secret qwenpaw-tls -n workpaw-instances -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -subject -ext subjectAltName
```
- 若已是受本机信任的 `*.qwenpaw.workpaw.internal` 通配证书 → 无需操作。
- 否则 mkcert：
  ```
  mkcert -install
  mkcert "*.qwenpaw.workpaw.internal"
  kubectl create secret tls qwenpaw-tls -n workpaw-instances \
    --cert=_wildcard.qwenpaw.workpaw.internal.pem \
    --key=_wildcard.qwenpaw.workpaw.internal-key.pem --dry-run=client -o yaml | kubectl apply -f -
  ```
  web（浏览器）与 desktop（Tauri/系统根）均信任，无需前端跳过证书校验的代码。
- 兜底：不装 mkcert 时，desktop 可在 dev 下给 reqwest 开 `danger_accept_invalid_certs(true)`；但 web 浏览器无法对 fetch 跳过证书，仍需 mkcert 或真实证书。

### 4.4 CORS（风险点，需实测）
web 带 `Authorization: Bearer` 访问 Pod 属非简单请求，触发 CORS 预检（OPTIONS）。当前本地 dev 不带 token（简单请求、无预检），"能跑"不代表 K8s 链路也能跑。
- 需验证 QwenPaw 对 web dev origin（如 `http://localhost:5173`）的预检返回 `Access-Control-Allow-Headers: Authorization`。
- desktop（Tauri）非浏览器，不受 CORS 限制。
- 兜底（若被拦）：给 operator 的 Pod spec 加 QwenPaw CORS 环境变量（小幅 operator 改动，必要时可接受）；Vite dev proxy 因 Pod URL 按用户动态变化、较重，不推荐。

## 5. Layer 1：前端接线

### 5.1 workpaw-web（主要代码工作）

现状：`useInstanceStore`（`src/stores/useInstanceStore.ts`）有 `fetchInstance`/`connectToPod` 但无 activate、无轮询、未被 `App.tsx` 引用（死代码）；`api/config.ts` 的 `setApiBaseUrl()`/`setAuthToken()`（存 `qwenpaw_auth_token`）已存在但无人调用；`lib/api.ts` 的 `ControlPlaneApi` 已有 `getInstance/activateInstance/deactivateInstance/getConnectInfo`，缺 `devLogin`；`pages/Login.tsx` 的 `handleDevLogin` 是粘贴 JWT 的手动框，未调 `/api/auth/dev-login`；`App.tsx` 的 `RequireAuth` 在 `VITE_DEV_MODE=true` 时直接放行。

**配置 `.env.development`**
```
VITE_CONTROL_PLANE_URL=http://localhost:8090
VITE_DEV_MODE=true
# 删除 VITE_API_BASE_URL=http://127.0.0.1:8088
```
`VITE_DEV_MODE` 语义从"跳过认证直连本地 QwenPaw"改为"用 dev-login 走真实 K8s 链路"。

**代码改动**
1. `src/lib/api.ts` — `ControlPlaneApi` 增加 `devLogin()`：`POST /api/auth/dev-login`，返回 `{access_token, user}`。
2. `src/stores/useInstanceStore.ts` — 新增 `activateInstance()` 动作（调 `api.activateInstance()`）；新增 `ensureRunning()`：`fetchInstance` → 若 `status` 非 `running`（`not_found`/`stopped`/`creating`）则 `activateInstance` → 轮询 `fetchInstance` 至 `running`（带超时）。`connectToPod()` 末尾增加桥接：`setApiBaseUrl(connectInfo.ingress_url)` + `setAuthToken(connectInfo.api_token)`，使 `api/request.ts`（页面栈）自动带 Pod URL + Bearer。
3. `src/App.tsx` — 新增 effect：`isAuthenticated` 后调 `ensureRunning()` → `connectToPod()`；`RequireAuth` 去掉 `VITE_DEV_MODE` 直接放行（dev 也必须有 token，来自 dev-login）。
4. `src/pages/Login.tsx` — `VITE_DEV_MODE=true` 时，把"手动粘贴 token"改为"一键 dev-login"按钮（调 `api.devLogin()` → `setToken` → 跳转）；保留 SSO 按钮给非 dev。
5. `src/vite-env.d.ts` — 更新 `VITE_DEV_MODE` 注释；确认 `VITE_CONTROL_PLANE_URL` 已声明。

### 5.2 workpaw-desktop（改动较小）

现状：`App.tsx:29,36-42,53,81-91` 为 `VITE_POD_URL` 旁路；控制面流程在 `45-79`；`instance.status!=="running"` 时渲染 `<ContainerGate />`（手动启动，无自动激活）；`Login.tsx:26-34` 的 dev-login 仅作 503 兜底。

**配置 `.env`**
```
VITE_CONTROL_PLANE_URL=http://localhost:8090
VITE_DEV_MODE=true
# 删除 VITE_POD_URL=http://127.0.0.1:8088
```

**代码改动**
1. `src/App.tsx` — 删除 `directPodUrl` 旁路（`29`、`36-42`、`53`、`81-91`），统一走控制面流程（`45-79` 保留）。新增自动激活：实例 effect 中若 `status` 为 `not_found`/`stopped`，自动 `POST /api/instance/activate`，然后继续轮询；`<ContainerGate />` 作为"启动中"状态展示。
2. `src/pages/Login.tsx` — `VITE_DEV_MODE=true` 时直接调 `POST /api/auth/dev-login`（主路径），不走 OIDC；非 dev 保留现有 OIDC + 503 兜底。
3. `src/stores/useInstanceStore.ts` — 新增 `activateInstance()` 动作。
4. `src/lib/podApi.ts` — `getPodUrl()` 对 `VITE_POD_URL` 的兜底可保留或清理（可选）；token 来自 connect（`setConnection` 已带 `api_token`），`podHeaders()` 已会发 Bearer，无需改。

### 5.3 workpaw-control-plane/console
仅 `.env.development`（新建或补全）：`VITE_CONTROL_PLANE_URL=http://localhost:8090`。`devLogin()` 已存在，不连 Pod，无代码改动。

### 5.4 不改的
`workpaw-ui`、`workpaw-operator` 无前端接线改动。

## 6. Layer 3：后端配置

### 6.1 workpaw-control-plane（`config.yaml`）
预期无需改动，核对以下项与现有集群一致：
- `server.mode: debug`（注册 `/api/auth/dev-login` 的前提）
- `kubernetes.kubeconfig: /Users/zhangsan/.kube/config`
- `kubernetes.namespace: workpaw-instances`
- `kubernetes.qwenpaw_image: agentscope/qwenpaw:v1.1.12`
- `ingress.base_domain: qwenpaw.workpaw.internal`
- `postgres` 本地 5433；`jwt.private_key_path: keys/jwt.pem`

前置条件（非配置）：kubeconfig 对应用户在 `workpaw-instances` 命名空间对 `QwenPawInstance` CRD 和 Secret 有读写权限。

### 6.2 workpaw-operator
无配置/代码改动。前置确认：operator 在跑、CRD 已装、硬编码 `base_domain=qwenpaw.workpaw.internal` 与 `/etc/hosts` 主机一致。

### 6.3 workpaw-ui
无改动。

## 7. 搭建步骤与验证

**搭建顺序**
1. 集群前置检查：`kubectl get pods -n workpaw-system`（operator Running）、`kubectl get crd qwenpawinstances.workpaw.workpaw.io`、ingress-nginx 已装、`qwenpaw-tls` Secret 存在于 `workpaw-instances`、kubeconfig RBAC 可用。
2. control-plane：`cd workpaw-control-plane && go run . serve --dev`；`curl localhost:8090/health` 显示 k8s ok；`curl -X POST localhost:8090/api/auth/dev-login` 返回 `test@workpaw.local` 的 JWT。
3. 启动 dev 用户 Pod：用 dev-login token 调 `POST /api/instance/activate`（或前端自动激活）；轮询 `GET /api/instance` 至 `running`。验证：`kubectl get qwenpawinstance test -n workpaw-instances` = Running、Secret `qwenpaw-token-test` 存在、Ingress `test.qwenpaw.workpaw.internal` 已创建。
4. DNS：`/etc/hosts` 加 `<INGRESS_ADDR> test.qwenpaw.workpaw.internal`；`curl -k https://test.qwenpaw.workpaw.internal/api/agent/health` 返回 ok。
5. TLS：检查 `qwenpaw-tls` 证书 SAN；不受信任则 mkcert 造 `*.qwenpaw.workpaw.internal` 替换 Secret。
6. 前端：
   - web：`npm run dev` → dev-login → 自动激活/连接 → 打开 `/agents` 能从 Pod 拉到数据。
   - desktop：`npm run tauri dev` → dev-login → 连接 → Chat 可用。
   - admin：`npm run dev` → dev-login → 管理页面加载（仅控制面）。
7. CORS 实测：web devtools 观察 Pod API（带 Bearer）预检通过；被拦则启用兜底。

**验证标准（"不再用本地 QwenPaw"）**：本机无 `:8088` QwenPaw 进程；web/desktop/admin 全部经控制面 + K8s Pod 完成登录与数据读写；Pod 流量目的地为 `https://test.qwenpaw.workpaw.internal`。

**测试方式**：手动端到端冒烟（步骤 1–7）。operator 已有的 Kind e2e（`make test-e2e`）不在本次范围。

## 8. 风险与兜底

| 风险 | 默认处理 | 兜底 |
|---|---|---|
| ingress 不在 443 | 假设 443 可达 | control-plane 加 `ingress.port`/`scheme` 配置 + 改 `instance.go` URL 拼接 |
| TLS 证书不受信任 | 先用现有 `qwenpaw-tls` | mkcert 造通配证书替换 Secret |
| CORS 预检拦截 Bearer | 先实测 | operator Pod spec 加 QwenPaw CORS 环境变量 |
| kubeconfig RBAC 不足 | 前置检查 | 授予 `workpaw-instances` 命名空间 CRD/Secret 读写权限 |

## 9. 不在本次范围

- 搭建新的 K8s 集群（kind/minikube 等）。
- 真实 SSO/OIDC 流程（dev-login 替代）。
- operator 代码改动（方案 1 保持零改动，除非触发 CORS 兜底）。
- 多用户通配 DNS（nip.io，属方案 2）。
- automated e2e 测试（仅手动冒烟）。

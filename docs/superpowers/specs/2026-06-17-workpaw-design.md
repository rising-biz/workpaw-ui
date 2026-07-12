# WorkPaw 整体架构设计

> 日期：2026-06-17
> 状态：已确认
> 基于 QwenPaw v1.1.12

## 1. 项目概述

WorkPaw 是基于 QwenPaw 开发的企业级私有化多用户版本。每个企业用户拥有独立的 QwenPaw 容器实例，通过 Tauri 2 桌面客户端使用 Agent，通过 Web 应用配置 Agent，通过管理后台管理全局策略。

### 核心约束

- 只定制前端交互界面，后端完全使用 QwenPaw 容器
- QwenPaw 版本锁定 v1.1.12
- 功能照抄 QwenPaw console，UI 风格根据企业场景重新设计
- 使用 Shadcn UI 替代 Ant Design
- 第一版只支持中文

## 2. 整体架构

### 三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        企业用户桌面                              │
│  ┌──────────────────────────┐                                   │
│  │   workpaw-desktop        │                                   │
│  │   (Tauri 2 + React)      │                                   │
│  │                          │                                   │
│  │  SSO登录(系统浏览器)      │                                   │
│  │  容器状态查询/启停        │──── ① ────┐                      │
│  │  Chat 对话 + Sessions    │           │                       │
│  └──────────────────────────┘           │                       │
└─────────────────────────────────────────┼───────────────────────┘
                                          │
                          ② 通过 Ingress  │  ① Control Plane API
                             域名访问     │
                                          │
┌─────────────────────────────────────────┼───────────────────────┐
│                    企业 K8s 集群         │                       │
│                                         │                       │
│  ┌─────────────────────┐               │                       │
│  │ workpaw-control-    │◄──────────────┘                       │
│  │ plane (Go/Gin)      │                                       │
│  │                     │                                       │
│  │ • OIDC Token 验证    │                                       │
│  │ • 实例查询/启停 API  │──── ③ ────┐                          │
│  │ • 管理 API          │           │                           │
│  │ • 审计日志           │           │                           │
│  └─────────────────────┘           │                           │
│                                     │                           │
│  ┌─────────────────────┐           │                           │
│  │ workpaw-operator    │◄──────────┘                           │
│  │ (K8s Operator)      │                                       │
│  │                     │                                       │
│  │ • CRD: QwenPawInst  │                                       │
│  │ • Pod 生命周期管理   │                                       │
│  │ • 休眠/唤醒策略     │                                       │
│  └──────────┬──────────┘                                       │
│             │ 创建/管理                                         │
│             ▼                                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ 用户 A 的            │  │ 用户 B 的            │              │
│  │ QwenPaw Pod          │  │ QwenPaw Pod          │  ...        │
│  │ (v1.1.12)            │  │ (v1.1.12)            │              │
│  └──────────┬──────────┘  └─────────────────────┘              │
│             │                                                   │
│  ┌──────────┴──────────────────────────────────┐               │
│  │            K8s Ingress                       │               │
│  │  TLS 终止 / 路由转发                         │               │
│  │  user-a.qwenpaw.workpaw.internal            │               │
│  │  user-b.qwenpaw.workpaw.internal            │               │
│  │  web-config.workpaw.internal                │               │
│  │  admin.workpaw.internal                     │               │
│  │  control-plane.workpaw.internal             │               │
│  └─────────────────────────────────────────────┘               │
│                                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐              │
│  │ workpaw-web (Nginx) │  │ workpaw-control-plane/console       │              │
│  │ 用户配置应用         │  │ (Nginx) 管理后台    │              │
│  └─────────────────────┘  └─────────────────────┘              │
│                                                                 │
│  ┌─────────────────────┐                                       │
│  │ PostgreSQL          │                                       │
│  │ (审计日志等)         │                                       │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 三条核心数据流

| 流 | 路径 | 用途 |
|----|------|------|
| ① | 客户端 → Control Plane | SSO 验证、实例查询/启停 |
| ② | 客户端/Web/Admin → K8s Ingress → QwenPaw Pod | 直连使用 Agent / 配置 Agent |
| ③ | Control Plane → K8s API (Operator) | 容器生命周期编排 |

### 网络模型

- 前端不直连 Pod IP，统一通过 K8s Ingress 访问
- 每个用户的 QwenPaw Pod 通过 Ingress 暴露独立域名（如 `user-a.qwenpaw.workpaw.internal`）
- Ingress 负责 TLS 终止、路由转发
- Pod 重启后 IP 变化不影响前端，Ingress 自动更新后端端点

### QwenPaw Pod API 访问令牌

每个 QwenPaw Pod 启动时自动生成唯一的 Access Token，防止其他用户通过 Ingress URL 非法访问：

**令牌生命周期：**
1. Operator 创建 Pod 时，生成随机 Access Token（UUID v4）
2. Token 存储在 K8s Secret 中（`qwenpaw-token-user-a`）
3. Token 通过环境变量注入 QwenPaw Pod（QwenPaw 原生支持 token 认证）
4. Control Plane 从 Secret 读取 Token，通过 `GET /api/instance/connect` 返回给前端
5. 前端在访问 QwenPaw Pod 时携带此 Token（`Authorization: Bearer <token>`）

**`GET /api/instance/connect` 返回示例：**
```json
{
  "ingress_url": "https://user-a.qwenpaw.workpaw.internal",
  "api_token": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**安全保障：**
- 每个 Pod 的 Token 唯一且随机，Pod 重建时重新生成
- Token 存储在 K8s Secret 中，只有 Control Plane 的 ServiceAccount 有权读取
- 前端拿到 Token 后缓存在本地（Tauri secure store / localStorage），不持久化到磁盘明文
- 即使 Ingress URL 泄露，没有 Token 也无法访问 QwenPaw API

## 3. 技术栈

### 全局统一

| 层面 | 选型 |
|------|------|
| Go 后端 | Gin + Zap + Viper + Cobra |
| 数据库 | PostgreSQL |
| 前端框架 | React + Vite + TypeScript |
| UI 组件 | Shadcn UI |
| 状态管理 | zustand |
| 国际化 | i18next（第一版只配中文） |

### 六个仓库

| 仓库 | 组件 | 技术栈 | 部署位置 |
|------|------|--------|----------|
| workpaw-ui | 共享 UI 包 | React + Shadcn UI + TS | npm 包 |
| workpaw-desktop | Tauri 2 桌面客户端 | React + Vite + Tauri 2 | 用户桌面 |
| workpaw-web | Web 配置应用 | React + Vite + Shadcn UI | K8s (Nginx) |
| workpaw-control-plane/console | 管理后台 | React + Vite + Shadcn UI | K8s (Nginx) |
| workpaw-control-plane | Control Plane API | Go + Gin + Zap + Viper | K8s (Pod) |
| workpaw-operator | K8s Operator | Go + Operator SDK | K8s (Pod) |

每个仓库的 CLAUDE.md 中添加其他仓库的本地路径，方便 Agent 开发时参考代码。

## 4. SSO 认证

### 协议

OIDC / OAuth 2.0，支持 Keycloak、Auth0、Azure AD、Okta 等标准 OIDC Provider。

### Tauri 桌面端登录流程

```
Tauri 客户端                          Control Plane                    OIDC Provider
    │                                      │                              │
    │── GET /auth/login ──────────────────→│                              │
    │←── 返回 auth_url ────────────────────│                              │
    │                                      │                              │
    │── 打开系统浏览器 ──────────────────────────────────────────────────→│
    │                                      │                              │
    │                                      │←── OIDC callback (code) ─────│
    │                                      │── 验证 code, 签发 JWT ──────→│
    │                                      │                              │
    │←── workpaw://callback?token=jwt ─────│                              │
    │                                      │                              │
```

- Control Plane 签发自己的 JWT（不直接传递 OIDC token 给客户端）
- JWT payload 包含：`user_id`, `email`, `roles`（user/admin）
- 后续所有 API 用此 JWT 做 Bearer Token 认证
- Tauri 2 deep link scheme: `workpaw://`

### Web 应用登录流程

标准 Web OAuth 流程，OIDC 回调到 Control Plane，签发 JWT 后重定向回 Web 应用。

## 5. Control Plane API

### 认证 API（/api/auth）

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/auth/login` | 返回 OIDC 登录页 URL（含 state + PKCE） |
| `GET` | `/api/auth/callback` | OIDC 回调，验证 code，签发 WorkPaw JWT |
| `POST` | `/api/auth/refresh` | 刷新 JWT token |
| `POST` | `/api/auth/logout` | 注销 |

### 实例管理 API（/api/instance）— 用户侧

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/instance` | 查询当前用户的 QwenPaw 实例状态 |
| `POST` | `/api/instance/activate` | 激活实例（不存在则创建，已停止则启动） |
| `POST` | `/api/instance/deactivate` | 停止实例 |
| `GET` | `/api/instance/connect` | 获取实例的 Ingress 域名 + 连接信息 |

实例状态机：

```
                    activate
    ┌──────────┐ ──────────→ ┌──────────┐
    │  不存在   │             │ Creating │
    └──────────┘ ←─ 删除 ──  └────┬─────┘
                                  │ ready
                                  ▼
    ┌──────────┐  deactivate  ┌──────────┐
    │ Stopped  │ ←─────────── │ Running  │
    └──────────┘ ──────────→  └──────────┘
         ▲        activate         │
         │                         │ 空闲超时 / 定时策略
         └─────────────────────────┘
```

`GET /api/instance` 返回示例：

```json
{
  "status": "running",
  "ingress_url": "https://user-a.qwenpaw.workpaw.internal",
  "created_at": "2026-06-17T10:00:00Z",
  "last_active_at": "2026-06-17T14:30:00Z",
  "policy": {
    "idle_timeout_minutes": 30,
    "schedule_stop": "22:00"
  }
}
```

### 管理 API（/api/admin）— 管理员侧

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/api/admin/instances` | 列出所有用户实例（分页 + 过滤） |
| `GET` | `/api/admin/instances/:userId` | 查看指定用户实例详情 |
| `DELETE` | `/api/admin/instances/:userId` | 强制删除用户实例 |
| `GET` | `/api/admin/stats` | 使用统计 |
| `GET` | `/api/admin/audit-logs` | 审计日志查询 |
| `PUT` | `/api/admin/policy` | 更新全局策略 |
| `GET` | `/api/admin/policy` | 查询全局策略 |

所有 `/api/admin/*` 路由通过 JWT 中的 `roles` 字段校验管理员权限。

### 中间件链

```
请求 → [CORS] → [RequestID] → [Zap 日志] → [JWT 验证] → [权限校验] → Handler
                                                                    ↓
                                                              [审计日志记录]
```

### 配置（Viper）

```yaml
server:
  port: 8080
  mode: release

oidc:
  issuer_url: https://idp.enterprise.com
  client_id: workpaw
  client_secret: ${OIDC_CLIENT_SECRET}
  redirect_url: https://control-plane.workpaw.internal/api/auth/callback

jwt:
  secret: ${JWT_SECRET}
  expire_hours: 24

kubernetes:
  kubeconfig: ""
  namespace: workpaw-instances
  qwenpaw_image: qwenpaw/qwenpaw:v1.1.12

ingress:
  base_domain: qwenpaw.workpaw.internal
  class: nginx
  tls_secret: workpaw-tls

postgres:
  host: postgres.workpaw.svc
  port: 5432
  database: workpaw
  user: ${PG_USER}
  password: ${PG_PASSWORD}

policy:
  default_idle_timeout_minutes: 30
  default_schedule_stop: "22:00"
```

## 6. K8s Operator

### CRD: QwenPawInstance

```yaml
apiVersion: workpaw.io/v1alpha1
kind: QwenPawInstance
metadata:
  name: user-a
  namespace: workpaw-instances
  labels:
    workpaw.io/user-id: "uid-123"
    workpaw.io/user-email: "user-a@enterprise.com"
spec:
  image: qwenpaw/qwenpaw:v1.1.12
  resources:
    requests:
      cpu: "500m"
      memory: "1Gi"
    limits:
      cpu: "2000m"
      memory: "4Gi"
  storage:
    size: 10Gi
    storageClass: standard
  policy:
    idleTimeoutMinutes: 30
    scheduleStop: "22:00"
    scheduleStart: ""
  desiredState: Running

status:
  currentState: Running
  podName: qwenpaw-user-a-0
  podIP: 10.0.1.23
  ingressHost: user-a.qwenpaw.workpaw.internal
  lastActiveAt: "2026-06-17T14:30:00Z"
  conditions:
    - type: Ready
      status: "True"
    - type: Idle
      status: "False"
```

### Reconcile 逻辑

- `desiredState=Running` 且 `currentState=Stopped`：创建 StatefulSet + Service + Ingress + PVC，等待 Pod Ready
- `desiredState=Stopped` 且 `currentState=Running`：Scale Pod 到 0（保留 PVC 数据）
- `desiredState=Running` 且 `currentState=Running`：检查 Pod 健康，更新 status

### 每个用户实例管理的 K8s 资源

```
workpaw-instances/
├── StatefulSet: qwenpaw-user-a      # Pod 编排（有状态，绑定 PVC）
├── Service:     qwenpaw-user-a      # ClusterIP Service
├── Ingress:     qwenpaw-user-a      # 对外暴露域名
├── PVC:         data-qwenpaw-user-a # 持久化存储
├── Secret:      qwenpaw-token-user-a # API Access Token
└── ConfigMap:   qwenpaw-user-a      # 环境变量等配置
```

使用 StatefulSet 而非 Deployment，因为 QwenPaw 是有状态应用（SQLite / 文件系统），需要 Pod 名稳定和 PVC 绑定稳定。

### 空闲检测机制

- Control Plane 维护每个实例的 `lastActiveAt`（对话请求时更新）
- Operator 内置定时检查器，周期性对比空闲时长与策略
- 超时则更新 CR 的 `desiredState=Stopped`，触发 Reconcile 停止 Pod

### Pod 生命周期策略（组合策略）

1. **空闲超时** — 用户 N 分钟没有对话活动，自动停止 Pod
2. **定时策略** — 非工作时间自动停止（如每晚 10 点）
3. **手动停止** — 用户通过客户端主动停止

### Operator CLI（Cobra）

```bash
workpaw-operator serve          # 启动 Operator（生产模式）
workpaw-operator serve --dev    # 开发模式（本地 kubeconfig）
workpaw-operator install-crd    # 安装 CRD 到集群
workpaw-operator version        # 版本信息
```

## 7. 前端设计

### 7.1 Tauri 桌面客户端（workpaw-desktop）

#### 布局（仿企业微信风格）

```
┌──────────────────────────────────────────────────────────────┐
│ ┌────┐ ┌─────────────────┐ ┌──────────────────────────────┐ │
│ │    │ │                 │ │                              │ │
│ │ 头 │ │   侧边栏        │ │        主内容区              │ │
│ │ 像 │ │                 │ │                              │ │
│ │    │ │  ┌───────────┐  │ │   ┌──────────────────────┐   │ │
│ │────│ │  │ 会话列表   │  │ │   │    Chat 对话区       │   │ │
│ │    │ │  │           │  │ │   │                      │   │ │
│ │ 💬 │ │  │ Session 1  │  │ │   │  [消息气泡列表]      │   │ │
│ │ 📋 │ │  │ Session 2  │  │ │   │  [流式输出]          │   │ │
│ │    │ │  │ Session 3  │  │ │   │                      │   │ │
│ │    │ │  │    ...     │  │ │   └──────────────────────┘   │ │
│ │    │ │  └───────────┘  │ │                              │ │
│ │    │ │                 │ │   ┌──────────────────────┐   │ │
│ │    │ │                 │ │   │  输入框 + 发送按钮    │   │ │
│ │    │ │                 │ │   └──────────────────────┘   │ │
│ └────┘ └─────────────────┘ └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

#### 左侧栏导航

```
┌──────────┐
│ [头像]    │  ← 点击打开 Profile 菜单
├──────────┤     (个人信息、设置、退出登录)
│  💬 对话  │  ← Chat 主界面
│  📋 会话  │  ← 历史会话列表
├──────────┤
│  ⚙️ 配置  │  ← 点击打开系统浏览器跳转 Web 配置应用
└──────────┘
```

#### 页面结构

```
pages/
├── Login/                    # SSO 登录页
├── ContainerStatus/          # 容器状态页（检测/新建/激活）
├── Chat/                     # 对话页（核心）
│   ├── 对话消息列表（流式输出）
│   ├── Agent 选择器
│   ├── 输入框（文本 + 文件附件）
│   └── 会话侧栏
└── Sessions/                 # 会话管理页
    ├── 全部会话列表
    ├── 搜索
    └── 批量操作
```

#### 状态管理（zustand）

```
stores/
├── useAuthStore          # 登录状态、JWT token、用户信息
├── useInstanceStore      # QwenPaw 实例状态、Ingress URL
├── useSessionStore       # 会话列表、当前会话
├── useChatStore          # 当前对话消息、流式输出状态
└── useAgentStore         # Agent 列表、当前选中 Agent
```

#### 应用启动流程

```
App 启动 → 检查本地 JWT
  ├── 无 token → Login 页 → 系统浏览器 OIDC → deep link 回调 → 保存 token
  └── 有 token → GET /api/instance
        ├── not_found → 提示新建部署
        ├── stopped → 提示激活容器
        ├── creating → 显示进度
        └── running → 获取 Ingress URL → 进入 Chat
```

#### Tauri 2 配置

- Deep Link scheme: `workpaw://`（SSO 回调）
- Shell: 打开系统浏览器
- Store: 本地持久化 JWT token 和 Control Plane 地址

### 7.2 Web 配置应用（workpaw-web）

#### 连接流程

1. 用户 OIDC 登录
2. 从 Control Plane 获取 Ingress URL（`GET /api/instance/connect`）
3. 所有后续请求直连 QwenPaw Pod 的 `/api/*` 接口

#### 页面模块

```
pages/
├── Login/
├── Agents/        # Agent 管理（创建/编辑/列表）
├── Skills/        # Skills 管理（安装/配置/市场）
├── Models/        # 模型配置（Provider/API Key/参数）
├── Channels/      # 渠道配置（钉钉/飞书/微信/Discord/Telegram...）
├── Security/      # 安全设置（工具防护/文件访问控制）
└── Settings/      # 全局设置（环境变量/定时任务/备份）
```

### 7.3 管理后台（workpaw-control-plane/console）

独立的前端应用，只给管理员授权入口。所有 API 走 Control Plane 的 `/api/admin/*` 路由。

#### 页面模块

```
pages/
├── Login/          # 管理员登录（OIDC + admin role 校验）
├── Dashboard/      # 总览（活跃实例数/资源用量/最近活动）
├── Instances/      # 实例管理（列表/详情/强制操作）
├── AuditLogs/      # 审计日志（列表/筛选/导出）
├── Policy/         # 全局策略（空闲超时/定时停止/资源配额）
└── OIDC/           # OIDC 配置（连接信息/测试连接）
```

### 7.4 共享 UI 包（workpaw-ui）

```
workpaw-ui/
├── components/    # 通用 UI 组件（Button、Table、Dialog、Card...）
├── hooks/         # 通用 hooks（useFetch、useDebounce...）
├── lib/           # 工具函数（formatDate、cn className 合并...）
└── types/         # QwenPaw API 类型定义

workpaw-desktop ──→ 引用 workpaw-ui
workpaw-web     ──→ 引用 workpaw-ui
workpaw-control-plane/console   ──→ 引用 workpaw-ui
```

workpaw-ui 只放通用/无业务逻辑的组件。带业务逻辑的组件放各自项目中。

### 7.5 功能边界划分

| 功能 | Tauri 客户端 | Web 配置应用 | 管理后台 |
|------|:---:|:---:|:---:|
| Chat 对话 | ✅ | | |
| Sessions 会话管理 | ✅ | | |
| Agents 管理 | | ✅ | |
| Skills 管理 | | ✅ | |
| Models 配置 | | ✅ | |
| Channels 渠道 | | ✅ | |
| Security 安全 | | ✅ | |
| Settings 设置 | | ✅ | |
| 实例管理 | | | ✅ |
| 审计日志 | | | ✅ |
| 全局策略 | | | ✅ |
| OIDC 配置 | | | ✅ |
| Coding Mode | TODO | | |

## 8. Phase 1 纵向 MVP

### 目标

一个用户能登录、启动容器、和 Agent 对话。

### 各仓库交付物

**workpaw-control-plane:**
- OIDC 登录 + JWT 签发
- 实例管理 API（查询/激活/停止/连接）
- Zap 请求日志中间件
- Dockerfile + K8s 部署 YAML

**workpaw-operator:**
- CRD: QwenPawInstance
- Reconcile: 创建 StatefulSet + Service + Ingress + PVC
- Reconcile: 停止（scale to 0）/ 启动（scale to 1）
- status 更新
- Dockerfile + K8s 部署 YAML

**workpaw-ui:**
- QwenPaw API 类型定义
- API 客户端骨架
- 基础 Shadcn UI 组件
- 通用 hooks

**workpaw-desktop:**
- SSO 登录页
- 容器状态页
- Chat 对话页（流式输出 + 文件上传 + Agent 选择）
- Sessions 会话列表页
- Profile 菜单

### 开发顺序

```
Week 1-2: 后端基础
├── workpaw-operator: CRD + 基础 Reconcile
├── workpaw-control-plane: 骨架 + OIDC + JWT
└── workpaw-ui: 骨架 + 类型 + API 客户端

Week 3-4: 联调 + 前端
├── workpaw-control-plane: 实例管理 API
├── workpaw-desktop: 登录 + 容器状态 + 对话
└── 本地 K8s 端到端联调

Week 5-6: 打磨 + 测试
├── workpaw-desktop: Sessions + Profile + 错误处理
├── 端到端测试
└── Docker 镜像 + K8s 部署验证
```

### 验收标准

- [ ] 用户打开 Tauri 客户端，点击登录，系统浏览器完成 OIDC 认证
- [ ] 回到客户端，显示容器状态（未部署/已停止/运行中）
- [ ] 用户点击"新建部署"，等待容器就绪（约 1-2 分钟）
- [ ] 容器就绪后自动进入 Chat 页，能和 Agent 正常对话
- [ ] 对话支持流式输出、文件上传
- [ ] 用户能停止容器、再次激活容器
- [ ] 会话历史持久化（QwenPaw Pod PVC 中）

### 开发环境

| 工具 | 用途 |
|------|------|
| k3d / minikube | 本地 K8s 集群 |
| Tilt / Skaffold | K8s 开发热重载 |
| mkcert | 本地 HTTPS 证书 |
| dex / keycloak | 本地 OIDC Provider |

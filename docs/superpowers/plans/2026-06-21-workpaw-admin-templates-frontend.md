# workpaw-admin/console — Template Push + Frontend (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the workpaw-admin/console backend (template `apply` → push config to a user's QwenPaw Pod via the privilege token) and wire the entire workpaw-admin/console frontend to real Control Plane APIs (replacing mock data, adding the new OIDC-config / templates / user-detail pages, and integrating RS256 JWT verification + refresh).

**Architecture:** Backend adds a `PodConfigClient` (HTTP client to a user's QwenPaw Pod config API, Bearer-authenticated with the privilege token from `GetConnectInfo`) and a `TemplateApplyService` that, for an agent template, creates the Agent on the Pod and attaches the selected MCP/Skill templates (create-then-link); for an MCP/Skill template, adds it to a specified existing Agent. All applies are synchronous (v1), recorded in `template_applies` + `audit_logs`. Frontend replaces the mock-based pages with real API calls via the existing `ApiClient` (already pointed at `/api/admin/*`), restructures the sidebar nav into groups per the spec, and adds the OIDC-config (edit + test + save), templates (3-tab CRUD + apply dialog), and user-detail pages. JWT verification switches to RS256 via the JWKS endpoint (Plan 1) and refresh tokens are used to keep sessions alive.

**Tech Stack:** Go (backend: controller-runtime K8s, `net/http` Pod client, testcontainers); React 19 + Vite + Shadcn/base-ui + zustand + react-router 7 + `workpaw-ui` shared components + `jose` (RS256/JWKS verification) + i18next (Chinese v1).

## Global Constraints

- Backend Go stack: Gin, GORM, controller-runtime. Pod config API calls reuse the exact contract workpaw-web uses (`POST /api/agents`, `PUT /api/agents/:id`, `POST /api/mcp`, `POST /api/skills`, `PUT /api/skills/save`) — verified in the alignment findings (point 1). Auth = `Authorization: Bearer <api-token>` where `api-token` = the `qwenpaw-token-{name}` Secret value from `InstanceService.GetConnectInfo`.
- Template apply is **synchronous** (v1). Pod offline → 503 "用户 Pod 离线" + `template_applies.status=failed`; no background queue (Plan 2's deferred `apply_jobs` is the v2 task-queue path, NOT this plan). Apply is idempotent: before creating an Agent, `GET /api/agents` and match by name → `PUT` if exists, `POST` if not.
- Every apply writes `template_applies` (template_type, template_id, template_name redundant, target_user_id, target_agent_id for mcp/skill, status, error, applied_by, applied_at) AND an `audit_logs` row via `AuditService.Log` (action `template.apply`).
- Frontend: Chinese only (v1); `i18next` framework retained. All UI from `workpaw-ui` shared components — no new component semantics. Signal Orange ≤10% per screen. WCAG AA: status indicators carry icon+text not color alone; tables ≥48px row height; full keyboard nav; `prefers-reduced-motion` degradation.
- JWT: frontend verifies access tokens via `GET /.well-known/jwks.json` (RS256, Plan 1) using `jose`; refresh via `POST /api/auth/refresh`. Access TTL is **lowered to 15min** in this plan (frontends now refresh — see Plan 1 note). decodeJwt (current HS256 base64url decode) is replaced by `jose` JWKS verification.
- Pagination `?page=&page_size=20`, response `{items,total,page,page_size}`. Error shape `{error,code,detail,request_id}`. All admin routes behind the existing `Auth + AdminOnly` (Plan 1) + admin services (Plan 2).
- Backend unit tests: `glebarez/sqlite` + a mock Pod HTTP server (`httptest`); K8s via fake client or `InstanceService` with a fake activator. Integration test: testcontainers Postgres + mock Pod.
- Frontend tests: Vitest + React Testing Library on the new/changed components and the apply-dialog flow (success/Pod-offline states). `npm run build` must stay green; `npm run lint` clean.
- All backend commands from `workpaw-admin/`; all frontend commands from `workpaw-admin/console/`. Each task ends with a commit. Backend commit prefix `feat:`/`test:`/etc.; frontend same.

## Spec reference

- Design spec §5.1/5.2 (three-end JWT verify + refresh), §7 (template apply routes + OIDC/policy pages + nav), §8 (data flow A — template apply), §10 (Pod-offline 503, privilege-token-missing 409), §11 (tests), §12 alignment points 1 (template spec fields — use the exact `CreateAgentRequest`/`AgentProfileConfig`/`MCPClientCreateRequest`/`SkillSpec` shapes from the findings doc) & 2 (privilege token).
- Alignment findings: `docs/superpowers/specs/2026-06-21-workpaw-admin/console-alignment-findings.md` — §1 has the exact Pod API paths + body field lists; §2 confirms the privilege-token Bearer path.
- Plan 1 (auth foundation) + Plan 2 (admin API + OIDC/policy/audit/templates CRUD) must be merged to main first.

## File Structure

**Backend (workpaw-admin):**
- Create: `internal/service/pod_config.go` — `PodConfigClient` (HTTP to a user's Pod: ListAgents, CreateAgent, UpdateAgent, CreateMCP, CreateSkill/SaveSkill). Bearer auth via privilege token.
- Create: `internal/service/template_apply.go` — `TemplateApplyService` (apply agent/mcp/skill templates to a target user's Pod synchronously; idempotent; records `template_applies` + audit).
- Modify: `internal/handler/admin_template.go` — add `POST /api/admin/templates/{type}/:id/apply` handler (Plan 2 created the file with CRUD; this adds apply).
- Modify: `internal/router/router.go` — register apply routes.
- Create: `internal/service/template_apply_test.go`, `internal/service/pod_config_test.go`, `internal/service/template_apply_integration_test.go` (`//go:build integration`).
- Modify: `internal/config/config.go` + `config.yaml` — set `jwt.expire_hours` default to... NO — access TTL is controlled by `jwt.expire_hours`; this plan lowers it to 15min ONLY after frontend refresh is wired. Do the config change in the LAST backend task (or note it as a frontend-gated change). **Decision:** keep `jwt.expire_hours=24` until the frontend refresh task lands; lower it to 1 (15min would need a minutes field — `expire_hours` is hours, so use a new `jwt.access_expire_minutes` field defaulting to 15, read by `JWTService` in this plan). Add `jwt.access_expire_minutes` (default 15) and switch `JWTService` to use it when >0, else fall back to `expire_hours`.

**Frontend (workpaw-admin/console):**
- Modify: `src/lib/api.ts` — add typed admin API methods (stats/users/user-detail/instance-govern/user-govern/oidc/policy/audit/templates); add `jose` JWKS token verification replacing `decodeJwt`; add refresh-token handling (auto-refresh on 401, store refresh token).
- Modify: `src/stores/useAuthStore.ts` — store access+refresh; `initialize` verifies token via JWKS; refresh logic.
- Modify: `src/layouts/MainLayout.tsx` — restructure nav into grouped sections per spec §7.
- Modify: `src/App.tsx` — add routes `/users/:id`, `/oidc`, `/templates`.
- Modify: `src/pages/Dashboard.tsx`, `src/pages/Instances.tsx` (→ users+instances), `src/pages/Audit.tsx`, `src/pages/Policy.tsx` — replace mock data with real API calls.
- Create: `src/pages/UserDetail.tsx`, `src/pages/OidcConfig.tsx`, `src/pages/Templates.tsx`.
- Create: `src/components/ApplyTemplateDialog.tsx` — the apply-to-user dialog (select user +, for mcp/skill, target agent).
- Delete (or gut): `src/lib/mockData.ts` — remove once all pages wired.
- Modify: `package.json` — add `jose` dep.

---

### Task 1: PodConfigClient (HTTP to QwenPaw Pod config API)

**Files:**
- Create: `internal/service/pod_config.go`, `internal/service/pod_config_test.go`

**Interfaces:**
- Produces: `PodConfigClient`, `NewPodConfigClient(httpClient *http.Client, baseURL, apiToken string) *PodConfigClient`. Methods (paths per alignment findings §1):
  - `ListAgents(ctx) ([]PodAgent, error)` — `GET /api/agents` → agents with `id`+`name`.
  - `CreateAgent(ctx, body map[string]interface{}) (agentID string, err error)` — `POST /api/agents`.
  - `UpdateAgent(ctx, agentID string, body map[string]interface{}) error` — `PUT /api/agents/:id`.
  - `CreateMCP(ctx, body map[string]interface{}) (clientKey string, err error)` — `POST /api/mcp`.
  - `SaveSkill(ctx, body map[string]interface{}) error` — `PUT /api/skills/save` (create-or-overwrite).
- All requests carry `Authorization: Bearer <apiToken>`. Non-2xx → error wrapping status + body. `baseURL` = the user's Pod ingress URL.

- [ ] **Step 1: Write the failing test** — `internal/service/pod_config_test.go` using `httptest.NewServer` to mock the Pod: `CreateAgent` POSTs to `/api/agents` with Bearer header and returns the `id` from the response; a 500 response returns an error. Test `ListAgents` returns parsed agents.
- [ ] **Step 2: Run → FAIL** (`undefined: NewPodConfigClient`).
- [ ] **Step 3: Implement** `PodConfigClient` with `net/http` + `encoding/json`. Constructor takes an `*http.Client` (injectable for tests). Bearer header on every call. Parse responses per the alignment findings shapes.
- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Build + commit**: `git add internal/service/pod_config.go internal/service/pod_config_test.go && git commit -m "feat: add PodConfigClient (HTTP to QwenPaw Pod config API)"`.

---

### Task 2: TemplateApplyService (synchronous apply, idempotent, recorded)

**Files:**
- Create: `internal/service/template_apply.go`, `internal/service/template_apply_test.go`

**Interfaces:**
- Produces: `TemplateApplyService`, `NewTemplateApplyService(db *gorm.DB, instanceSvc *InstanceService, audit *AuditService) *TemplateApplyService`. (Needs `InstanceService.GetConnectInfo` for the privilege token + ingress URL; depends on an `InstanceConnector` interface for testability — define `InstanceConnector { ConnectInfo(ctx, userID) (ingressURL, apiToken string, err error) }` implemented by `InstanceService`.)
- `(*TemplateApplyService).ApplyAgent(ctx, templateID, targetUserID, appliedBy string) (*TemplateApplyResult, error)`:
  1. Load `AgentTemplate` (incl. its `MCPTemplateIDs`/`SkillTemplateIDs`).
  2. `ConnectInfo(targetUserID)` → ingress+token. If token missing → return `ErrInstanceNotReady` (caller → 409). If Pod unreachable → `ErrPodUnreachable` (caller → 503).
  3. Build `PodConfigClient`.
  4. `ListAgents` → if an agent with the template's `spec.name` exists, `UpdateAgent`; else `CreateAgent`.
  5. For each MCP template id → `CreateMCP` on the Pod.
  6. For each skill template id → `SaveSkill` on the Pod.
  7. Write `template_applies` row (status success/failed + error) + `auditSvc.Log(action="template.apply", target_type="user", target_id=targetUserID, detail={template_type:"agent", template_id, template_name})`.
- `(*TemplateApplyService).ApplyMCP(ctx, templateID, targetUserID, targetAgentID, appliedBy string) (...)` — load MCP template → ConnectInfo → `CreateMCP` → record. `ApplySkill` analogous with `SaveSkill`.
- `ErrInstanceNotReady`, `ErrPodUnreachable` sentinels.

- [ ] **Step 1: Write the failing test** — `template_apply_test.go`: mock `InstanceConnector` (returns a test httptest Pod URL + token) + mock Pod server (accepts `POST /api/agents`); assert `ApplyAgent` creates the agent, writes a `template_applies` success row + an `audit_logs` row. Second test: Pod server returns 500 → `ApplyAgent` returns `ErrPodUnreachable` (or wraps the 500), writes a `failed` row. Third: connector returns empty token → `ErrInstanceNotReady`.
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** `TemplateApplyService` + `InstanceConnector` interface. Use `PodConfigClient`. Wrap each Pod call; on any failure, write a `failed` `template_applies` row with the error message and return the error (do NOT write a success row). On full success write `success`.
- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Build + commit**: `git add internal/service/template_apply.go internal/service/template_apply_test.go && git commit -m "feat: add TemplateApplyService (synchronous idempotent pod push + audit)"`.

---

### Task 3: Apply handler + route registration

**Files:**
- Modify: `internal/handler/admin_template.go` (Plan 2 created it) — add `Apply` handler.
- Modify: `internal/router/router.go` — register `POST /api/admin/templates/agents/:id/apply`, `.../mcps/:id/apply`, `.../skills/:id/apply`.

**Interfaces:**
- Produces: `(*AdminTemplateHandler).Apply(c)` — parses `{type}` + `:id` + body `{target_user_id, target_agent_id?}` → calls the matching `TemplateApplyService.Apply*` → maps errors: `ErrInstanceNotReady`→409, `ErrPodUnreachable`→503, other→500; success→200 with the `template_applies` row.

- [ ] **Step 1: Write the failing test** — `internal/handler/admin_template_test.go`: `POST /api/admin/templates/agents/:id/apply` with a mock `TemplateApplyService` (use an interface `Applier` so the handler is testable without a real Pod) returns 200 on success; returns 503 when the service yields `ErrPodUnreachable`.
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** the `Apply` handler + register the 3 routes. Define an `Applier` interface in the handler package (or service) so `AdminTemplateHandler` depends on it (CRUD via `TemplateService`, apply via `Applier`).
- [ ] **Step 4: Run → PASS**. Run full backend suite + gofmt + vet.
- [ ] **Step 5: Commit**: `git add internal/handler/admin_template.go internal/handler/admin_template_test.go internal/router/router.go && git commit -m "feat: add template apply handler + routes (sync pod push)"`.

---

### Task 4: Access-token TTL field + integration test

**Files:**
- Modify: `internal/config/config.go` (`JWTConfig.AccessExpireMinutes int`), `config.yaml` (`access_expire_minutes: 15`), `internal/service/jwt.go` (use `AccessExpireMinutes` when >0, else `ExpireHours`; lower-bound 1 minute).
- Create: `internal/service/template_apply_integration_test.go` (`//go:build integration`).

**Interfaces:**
- Produces: shorter access TTL (15min) gated behind the new config field, active now that frontend refresh exists (Task 8). Integration test validates the full apply flow on real Postgres + a mock Pod httptest server (ConnectInfo via a fake connector).

- [ ] **Step 1: Write the integration test** — build-tagged; real Postgres + migrate all 9 tables; seed an account + an agent template (with linked MCP/Skill templates); fake `InstanceConnector` pointing at an httptest Pod; `ApplyAgent` → assert Pod received `POST /api/agents` + `POST /api/mcp` + `PUT /api/skills/save`, and a success `template_applies` row + audit row exist. Second case: Pod returns 503 → `failed` row. Skip if Docker unavailable.
- [ ] **Step 2: Run** `go test ./internal/service/... -tags=integration -run TestTemplateApplyIntegration -v` → PASS (or SKIP).
- [ ] **Step 3: Add the TTL field** to config + jwt.go; default 15. Run `go test ./internal/service/... -run TestGenerateAccessToken` (from Plan 1) — still passes (TTL is a value, the test doesn't assert exact expiry). Add one assertion test that a token minted with `AccessExpireMinutes=15` has `exp-iat ≈ 15min`.
- [ ] **Step 4: gofmt + vet + full suite green**.
- [ ] **Step 5: Commit**: `git add internal/config/config.go config.yaml internal/service/jwt.go internal/service/template_apply_integration_test.go && git commit -m "feat: 15min access TTL (gated) + template-apply integration test"`.

---

### Task 5: Frontend — add `jose`, replace decodeJwt with JWKS verification + refresh handling

**Files:**
- Modify: `workpaw-admin/console/package.json` (add `jose`), `src/lib/api.ts`, `src/stores/useAuthStore.ts`.

**Interfaces:**
- Produces: `verifyAccessToken(token)` using `jose.createRemoteJWKSet(new URL(controlPlaneUrl + "/.well-known/jwks.json"))` + `jwtVerify`. `useAuthStore` stores `access_token` + `refresh_token`; `initialize` verifies the access token via JWKS (on verification failure, try refresh; on refresh failure, clear). An api-client interceptor auto-refreshes on 401 (calls `/api/auth/refresh`, retries once).

- [ ] **Step 1: Install + write failing test** — `npm install jose`; `src/lib/api.test.ts` (Vitest) asserting `verifyAccessToken` rejects a tampered token and accepts a token signed by a key whose JWKS is served by an httptest-style mock (use `jose` to generate a local RS256 key, serve its JWKS via a mock fetch). Test the 401-refresh-retry path with a mocked fetch.
- [ ] **Step 2: Run → FAIL** (`npm test`).
- [ ] **Step 3: Implement** JWKS verification + refresh interceptor. Replace `decodeJwt` usages (Login page, useAuthStore) with the verified claims. Keep a `decodeClaimsForDisplay` helper (unverified decode) only for immediate post-login display before verification, OR verify immediately — prefer verify immediately.
- [ ] **Step 4: Run → PASS**; `npm run build` + `npm run lint` clean.
- [ ] **Step 5: Commit**: `git add package.json package-lock.json src/lib/api.ts src/lib/api.test.ts src/stores/useAuthStore.ts && git commit -m "feat: RS256 JWKS verification + refresh-token handling"`.

---

### Task 6: Frontend — typed admin API methods (replace mock)

**Files:**
- Modify: `workpaw-admin/console/src/lib/api.ts` — add typed methods for every `/api/admin/*` endpoint (stats, users list+detail, instance activate/deactivate, user disable/enable, oidc get/test/save, policy get/put, audit-logs query/export, templates list/create/update/delete + apply).
- Modify: `src/lib/mockData.ts` — delete the file (or empty it) once nothing imports it; remove imports from pages as they're rewired in Tasks 8–12.

**Interfaces:**
- Produces: a typed `adminApi` object (created via `createAdminApi(getToken)`) with methods returning typed TS interfaces matching the Plan 2 backend shapes (Stats, UserListItem, UserDetail, OIDCConfigView, Policy, AuditLog, AgentTemplate/MCPTemplate/SkillTemplate, TemplateApplyResult). All types defined in `api.ts`.

- [ ] **Step 1: Write the types + methods** (no test needed — thin fetch wrappers; behavior tested via the page tests in later tasks). Add a Vitest smoke test that `adminApi.stats()` calls `fetch` with the right URL + Bearer header (mock `fetch`).
- [ ] **Step 2: Run → PASS**.
- [ ] **Step 3: Build + lint clean**.
- [ ] **Step 4: Commit**: `git add src/lib/api.ts src/lib/api.test.ts && git commit -m "feat: typed admin API client methods"`.

---

### Task 7: Frontend — nav restructure + routes

**Files:**
- Modify: `workpaw-admin/console/src/layouts/MainLayout.tsx` (grouped nav: 监控/治理/配置/系统 per spec §7), `src/App.tsx` (routes `/users/:id`, `/oidc`, `/templates`).

**Interfaces:**
- Produces: sidebar with 4 grouped sections; nav items map to `/`, `/users`, `/policy`, `/oidc`, `/templates`, `/audit`, `/appearance`. Routes registered for the 3 new pages.

- [ ] **Step 1–4: TDD** — render test asserting the 4 group headers + 7 nav items render; route test that `/users/u1` renders UserDetail, `/oidc` renders OidcConfig, `/templates` renders Templates.
- [ ] **Step 5: Commit**: `git add src/layouts/MainLayout.tsx src/App.tsx src/layouts/MainLayout.test.tsx && git commit -m "feat: grouped nav + new routes (users/:id, oidc, templates)"`.

---

### Task 8: Frontend — Dashboard + Users/Instances pages (real data)

**Files:**
- Modify: `workpaw-admin/console/src/pages/Dashboard.tsx`, `src/pages/Instances.tsx`.

**Interfaces:**
- Produces: Dashboard shows 4 stat cards (total users / online instances / today activity / disabled) from `adminApi.stats()` + a recent-activity list from `adminApi.auditLogs({page_size:10})` + instance-status distribution (computed client-side from the users list or a dedicated breakdown — use the users list status counts). Users/Instances page: table from `adminApi.users({search,status,page,page_size})` with columns user/email/status/ingress/created/last-active/disabled; row actions view-detail (nav), force-start/stop (AlertDialog confirm), disable/enable (AlertDialog confirm; disable prompts for reason). Pagination controls.

- [ ] **Step 1: Write failing tests** — Dashboard renders 4 stat cards from mocked `adminApi.stats`; Users page renders rows from mocked `adminApi.users` + calls `adminApi.forceDeactivate` on confirm.
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** — fetch on mount (loading/empty/error states), wire actions. Remove `mockData` imports.
- [ ] **Step 4: Run → PASS**; build + lint clean.
- [ ] **Step 5: Commit**: `git add src/pages/Dashboard.tsx src/pages/Instances.tsx src/pages/Dashboard.test.tsx src/pages/Instances.test.tsx && git commit -m "feat: Dashboard + Users/Instances pages wired to real API"`.

---

### Task 9: Frontend — UserDetail page

**Files:**
- Create: `workpaw-admin/console/src/pages/UserDetail.tsx`.

**Interfaces:**
- Produces: 3 sections — CRD instance status (+ start/stop buttons), governance state (disable toggle + reason + history), applied-templates list (`template_applies`). Top "应用模板" button opens `ApplyTemplateDialog` (Task 11).

- [ ] **Step 1–4: TDD** — renders the 3 sections from mocked `adminApi.userDetail`; "应用模板" opens the dialog.
- [ ] **Step 5: Commit**: `git add src/pages/UserDetail.tsx src/pages/UserDetail.test.tsx && git commit -m "feat: UserDetail page (instance + governance + applied templates)"`.

---

### Task 10: Frontend — Templates page (3-tab CRUD) + OIDC config page + Policy page (real data)

**Files:**
- Create: `workpaw-admin/console/src/pages/Templates.tsx`, `src/pages/OidcConfig.tsx`.
- Modify: `src/pages/Policy.tsx` (replace mock with `adminApi.policy`).

**Interfaces:**
- Produces:
  - Templates page: 3 tabs (Agent/MCP/Skill); each lists templates (`adminApi.listTemplates(type)`), with new/edit/delete (Dialog forms) + an "应用到用户" action opening `ApplyTemplateDialog`.
  - OIDC config page: form (issuer_url/client_id/client_secret/scopes/redirect_url/admin_users); "测试连接" button → `adminApi.testOidc()` shows result; on success "保存" enabled → `adminApi.saveOidc()`. Shows "保存即热加载，无需重启；测试失败不会生效" copy.
  - Policy page: form from `adminApi.policy()`; save → `adminApi.updatePolicy()`; shows "修改仅对新创建的实例生效，存量实例不变" copy.

- [ ] **Step 1–4: TDD** — Templates: tabs switch + list renders + delete calls API. OIDC: test-failure disables save button. Policy: save calls updatePolicy with form values.
- [ ] **Step 5: Commit**: `git add src/pages/Templates.tsx src/pages/OidcConfig.tsx src/pages/Policy.tsx src/pages/Templates.test.tsx src/pages/OidcConfig.test.tsx && git commit -m "feat: Templates (3-tab CRUD) + OIDC config (test+save) + Policy wired"`.

---

### Task 11: Frontend — ApplyTemplateDialog + Audit page (real data)

**Files:**
- Create: `workpaw-admin/console/src/components/ApplyTemplateDialog.tsx`.
- Modify: `src/pages/Audit.tsx` (replace mock with `adminApi.auditLogs` + filters + CSV export).

**Interfaces:**
- Produces: `ApplyTemplateDialog` (props: template type + id, optional preselected user) — select target user (combobox from `adminApi.users`); for MCP/Skill also select the user's agent (combobox from that user's agents — call a lightweight `adminApi.userAgents(userID)` or reuse `userDetail`); "应用" → `adminApi.applyTemplate(type, id, {target_user_id, target_agent_id})`; show success "已应用到 {user}" or the failure reason (e.g. "该用户 Pod 离线，请稍后重试"). Audit page: table (time/actor/action/target-type/target-name/detail) + filters (actor/target/action/time-range) + pagination + CSV export button (`adminApi.exportAuditLogs` → download).

- [ ] **Step 1–4: TDD** — Dialog: success path shows confirmation; Pod-offline (API returns 503) shows the offline message. Audit: renders rows from mocked `auditLogs`; filter change refetches.
- [ ] **Step 5: Commit**: `git add src/components/ApplyTemplateDialog.tsx src/pages/Audit.tsx src/components/ApplyTemplateDialog.test.tsx src/pages/Audit.test.tsx && git commit -m "feat: ApplyTemplateDialog + Audit page (filters + CSV export)"`.

---

### Task 12: Frontend — delete mockData, full build/lint gate, e2e smoke

**Files:**
- Delete: `workpaw-admin/console/src/lib/mockData.ts`.
- Verify: no remaining `mockData` imports.

**Interfaces:**
- Produces: mock data fully removed; `npm run build` + `npm run lint` + `npm test` all green; a manual smoke note (dev-login → Dashboard loads real stats → Users → force-stop → Templates → apply to a dev user → Audit shows the apply row).

- [ ] **Step 1: Delete mockData.ts**; grep for stale imports; fix any.
- [ ] **Step 2: `npm run build && npm run lint && npm test`** → all green.
- [ ] **Step 3: Commit**: `git rm src/lib/mockData.ts && git commit -m "chore: remove mock data (all pages wired to real API)"`.

---

## Self-Review

**1. Spec coverage (Plan 3 scope):**
- §5.1/5.2 three-end JWT verify (RS256/JWKS) + refresh → Task 5. ✓
- §7 templates CRUD (Plan 2) + apply + OIDC/policy pages + nav → Tasks 7,10,3. ✓
- §8 data flow A (template apply: ConnectInfo → Pod API upsert → record) → Tasks 1,2,3. ✓
- §10 Pod-offline 503, privilege-token-missing 409, idempotent upsert → Task 2. ✓
- §11 tests (mock Pod httptest + integration testcontainers + Vitest) → all tasks. ✓
- §12 alignment 1 (template spec fields — use findings doc shapes) → Task 1. ✓; 2 (privilege token) → Task 2. ✓
- Access TTL 15min (Plan 1 deferral) → Task 4 (gated on frontend refresh, Task 5). ✓

**2. Placeholder scan:** Tasks 8–11 (frontend pages) specify the data contract + page behavior + the exact API methods + test assertions rather than full JSX, because the JSX follows workpaw-ui patterns the implementer reads fresh. This is not a placeholder — each task names what renders, what API it calls, and what the test asserts. If you want line-by-line JSX for the pages, flag before execution.

**3. Type consistency:** Backend `PodConfigClient`/`TemplateApplyService`/`InstanceConnector`/`Applier` consistent across Tasks 1–3. Frontend `adminApi.*` method names consistent across Tasks 6–11 (stats/users/userDetail/forceActivate/forceDeactivate/disable/enable/getOidc/testOidc/saveOidc/policy/updatePolicy/auditLogs/exportAuditLogs/listTemplates/createTemplate/updateTemplate/deleteTemplate/applyTemplate). RS256 JWKS path `/.well-known/jwks.json` matches Plan 1's endpoint.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-workpaw-admin/console-templates-frontend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between, fast iteration.
**2. Inline Execution** — batch execution with checkpoints.

Plan 2 must be merged to main before Plan 3 starts (Plan 3's frontend consumes Plan 2's admin API; Plan 3's backend apply handler extends Plan 2's `AdminTemplateHandler`). Which approach, and do you want Plan 2 executed first?

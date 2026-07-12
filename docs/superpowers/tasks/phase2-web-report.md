# Phase 2 Report: workpaw-web MVP

## Status: DONE

## Commit
- `d4bc9f6` — `feat: implement workpaw-web MVP` (37 files, 8844 insertions)

## Build
- `npm run build` passes cleanly (TypeScript + Vite production build)
- Output: ~297 kB JS (95 kB gzipped), ~39 kB CSS (7 kB gzipped)

## Files Created

### Core
| File | Description |
|------|-------------|
| `src/types/index.ts` | Inline type definitions (Auth, Instance, Agent, Model types from workpaw-ui) |
| `src/lib/api.ts` | ApiClient, ControlPlaneApi, PodAgentApi classes + factory functions |
| `src/stores/useAuthStore.ts` | Auth state: JWT decode, login/logout, localStorage persistence |
| `src/stores/useInstanceStore.ts` | Instance state: Pod connection, agent API initialization |

### Pages
| File | Description |
|------|-------------|
| `src/pages/Login.tsx` | SSO login with OIDC redirect + dev-mode manual token input |
| `src/pages/Agents.tsx` | Agent card list, create/edit dialog, toggle enabled, delete |
| `src/pages/Placeholder.tsx` | Placeholder pages for Skills, Models, Channels, Settings |

### Layout & Routing
| File | Description |
|------|-------------|
| `src/layouts/MainLayout.tsx` | Sidebar navigation + content area with user info |
| `src/App.tsx` | React Router with auth guard, route definitions |
| `src/main.tsx` | Entry point |

### UI Components (Shadcn-style)
- `button.tsx` (moved from stale `@` dir), `card.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `badge.tsx`, `dialog.tsx`

### Deployment
| File | Description |
|------|-------------|
| `Dockerfile` | Multi-stage build: node:20-alpine builder + nginx:alpine production |
| `nginx.conf` | SPA routing, static asset caching, security headers, gzip |
| `.dockerignore` | Excludes node_modules, dist, .git |

## Key Decisions

1. **Inline types instead of workpaw-ui import** — workpaw-ui was not npm-linked, so all needed types (Auth, Instance, Agent, Model) were replicated in `src/types/index.ts`. This is easily replaceable later when the package is linked.

2. **Native `<dialog>` not used** — the Dialog component uses a fixed overlay div approach for broader compatibility and simpler styling control.

3. **Dev-mode login** — the Login page includes a collapsible "development mode" section for manually pasting a JWT token, useful before OIDC is configured.

4. **Removed `baseUrl` from tsconfig** — TypeScript 6.0 deprecated `baseUrl`; `paths` with relative prefixes works without it.

5. **Removed stale `@` directory** — shadcn had generated components at project root `/@/` instead of `/src/`. Moved to correct `src/` location and deleted the stale directory.

## Concerns

1. **No auth refresh** — The current implementation does not handle token refresh. When the token expires, the user is redirected to `/login`. A refresh token flow should be added in Phase 3.

2. **No error boundary** — Unhandled errors will show the default React error screen. An error boundary component should be added.

3. **CORS** — The dev server at port 5173 will need the Control Plane and Pod APIs to allow CORS. In production, this is handled by nginx reverse proxy or same-origin deployment.

4. **Skills/Models/Channels/Settings** — These are placeholder pages only. Real implementation deferred to later phases.

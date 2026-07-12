# Task 4.2 Report: SSO 登录页

**Status:** DONE

**Commits:**
- `db69536` - feat: implement SSO login with deep link callback

## Summary

Successfully implemented SSO login functionality for the workpaw-desktop Tauri 2 application with deep link callback support.

## Files Created

1. **src/stores/useAuthStore.ts** - Zustand-based authentication state management
   - Token and user state management
   - LocalStorage persistence
   - Login/logout methods

2. **src/pages/Login.tsx** - SSO login page UI
   - Chinese-only interface ("企业账号登录")
   - Calls Control Plane `/api/auth/login` endpoint
   - Opens system browser for SSO authentication
   - Error handling with Chinese error messages

3. **src/lib/deepLink.ts** - Deep link callback handler
   - Listens for `workpaw://callback?token=xxx` URLs
   - Extracts token from callback URL
   - Updates auth store with received token

## Files Modified

1. **src/App.tsx** - Wired auth flow
   - Loads token from storage on mount
   - Sets up deep link listener on mount
   - Shows LoginPage when not authenticated
   - Shows placeholder "Loading..." when authenticated (ready for ContainerStatus integration)

2. **src-tauri/Cargo.toml** - Added Rust dependencies
   - `tauri-plugin-shell = "2"`
   - `tauri-plugin-deep-link = "2"`

3. **src-tauri/src/lib.rs** - Registered Tauri plugins
   - Initialized shell plugin
   - Initialized deep-link plugin

4. **src-tauri/tauri.conf.json** - Configured deep link scheme
   - Added `workpaw` scheme to deep-link plugin configuration

5. **src-tauri/capabilities/default.json** - Added permissions
   - `shell:default`
   - `deep-link:default`

6. **tsconfig.json** - Updated TypeScript configuration
   - Changed lib from ES2020 to ES2023 to support `toReversed()`, `replaceAll()`, and `at()` methods

7. **src/components/ui/calendar.tsx** - Fixed TypeScript error
   - Removed unsupported `table` property from react-day-picker classNames (incompatible with react-day-picker v10)

8. **package.json** - Added dependencies
   - `zustand@5.0.14`
   - `@tauri-apps/plugin-shell@2.3.5`
   - `@tauri-apps/plugin-deep-link@2.4.9`

## Test Summary

- ✅ Frontend build successful (`pnpm build`)
- ✅ Rust compilation successful
- ✅ Tauri app binary compiled at `src-tauri/target/debug/workpaw-desktop` (31MB)
- ⚠️ DMG bundling failed (unrelated to SSO implementation - requires create-dmg tool)

## Build Issues Resolved

1. **TypeScript lib version**: Updated from ES2020 to ES2023 to support modern array/string methods used in ai-elements components
2. **Calendar component**: Removed incompatible `table` className property from shadcn calendar component (react-day-picker v10 compatibility)

## Known Limitations

1. **DMG bundling**: The `pnpm tauri build --debug` command fails at the DMG bundling stage due to missing `create-dmg` tool. This is a build environment issue, not a code issue. The app binary itself compiles successfully.

2. **API client integration**: The login page currently uses direct `fetch()` calls. Future integration with the workpaw-ui API client (when available) would be beneficial.

3. **User data fetching**: The auth store only stores the token. Fetching user profile data after login is not implemented (could be done in a follow-up task).

## Acceptance Criteria

✅ Login page renders correctly
✅ Login button calls Control Plane `/api/auth/login` endpoint
✅ Deep link handler is set up and listening for `workpaw://callback` URLs
✅ App shows LoginPage when not authenticated
✅ App shows placeholder when authenticated
✅ All required Tauri plugins installed and configured
✅ Deep link scheme `workpaw` configured in Tauri
✅ Build verification passed (frontend + Rust compilation)

## Next Steps

The following would be natural follow-ups:
- Implement user profile fetching after token is set
- Add loading state while checking token validity
- Integrate with workpaw-ui API client when available
- Replace "Loading..." placeholder with actual ContainerStatus component (Task 4.3)

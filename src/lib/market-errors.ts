import { getUIText } from "../components/ui/ui-text";

/**
 * User-facing market errors; API payloads and implementation details stay out of UI copy.
 *
 * 纯函数（签名向后兼容）：文案表收编进 UIText 词典（I18N-01），经 getUIText()
 * 读取——UITextProvider 挂载后其覆盖对这里的纯函数同样生效；未挂载时用默认词表。
 */
export function marketErrorMessage(error: unknown, fallback?: string): string {
  const t = getUIText().marketErrors;
  const value = error && typeof error === "object" ? error as { message?: unknown; detail?: unknown; status?: unknown } : {};
  const message = typeof value.message === "string" ? value.message : typeof error === "string" ? error : "";
  const detail = typeof value.detail === "string" ? value.detail : "";
  const raw = `${message} ${detail}`;
  if (/dependencies must be published|dependenc.*(?:unpublished|not published)/i.test(raw)) return t.dependenciesUnpublished;
  if (/already exists|already installed|duplicate|同名|conflict/i.test(raw)) return /plugin|插件/i.test(raw)
    ? t.duplicatePlugin
    : t.duplicateContent;
  if (/market item not found|template not found|unavailable reference/i.test(raw)) return t.itemUnavailable;
  if (/after \d+ retries|(?:HTTP|returned)\s*503\b|temporarily unavailable/i.test(raw)) return t.sourceUnavailable;
  if (value.status === 401) return t.unauthorized;
  if (value.status === 403) return t.forbidden;
  if (value.status === 404) return t.notFound;
  if (value.status === 409) return t.conflict;
  if (value.status === 413) return t.payloadTooLarge;
  if (value.status === 422) return t.validationFailed;
  if (typeof value.status === "number" && value.status >= 500) return t.serverUnavailable;
  if (/failed to fetch|network|download|fetch failed/i.test(raw)) return t.networkFailed;
  // Keep authored recovery instructions, never raw API JSON or request dumps.
  if (/[\u3400-\u9fff]/.test(message) && !/[{}]|Pod API|Traceback/i.test(message) && message.length <= 500) return message;
  return fallback ?? t.operationFailed;
}

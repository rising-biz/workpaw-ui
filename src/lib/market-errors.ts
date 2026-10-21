/** User-facing market errors; API payloads and implementation details stay out of UI copy. */
export function marketErrorMessage(error: unknown, fallback = "操作未完成，请重新读取后重试。"): string {
  const value = error && typeof error === "object" ? error as { message?: unknown; detail?: unknown; status?: unknown } : {};
  const message = typeof value.message === "string" ? value.message : typeof error === "string" ? error : "";
  const detail = typeof value.detail === "string" ? value.detail : "";
  const raw = `${message} ${detail}`;
  if (/dependencies must be published|dependenc.*(?:unpublished|not published)/i.test(raw)) return "此专家关联的技能或连接器尚未全部上架。请先让管理员发布依赖，再重试。";
  if (/already exists|already installed|duplicate|同名|conflict/i.test(raw)) return /plugin|插件/i.test(raw)
    ? "已有同名插件，当前安装没有覆盖它。请进入我的插件核对来源和版本后处理。"
    : "已有同名内容，当前操作没有覆盖它。请进入对应的“我的”页面核对内容后重试。";
  if (/market item not found|template not found|unavailable reference/i.test(raw)) return "此内容或关联模板已下架、失效。请刷新市场；仍不可用时联系管理员。";
  if (/after \d+ retries|(?:HTTP|returned)\s*503\b|temporarily unavailable/i.test(raw)) return "此来源暂时不可用，已重试仍未恢复。可以先使用其他来源，或稍后刷新。";
  if (value.status === 401) return "登录已过期，请重新登录后重试。";
  if (value.status === 403) return "当前账号没有执行此操作的权限，请联系管理员。";
  if (value.status === 404) return "此内容已不存在或不可用，请重新读取后重试。";
  if (value.status === 409) return "内容或安装状态发生冲突。请进入对应的“我的”页面核对后重试。";
  if (value.status === 413) return "安装包太大，请让发布者缩小后重新上传。";
  if (value.status === 422) return "配置未通过校验，请检查必填字段和安装包类型。";
  if (typeof value.status === "number" && value.status >= 500) return "服务暂时不可用，请稍后重新读取并重试。";
  if (/failed to fetch|network|download|fetch failed/i.test(raw)) return "连接或下载失败，请检查网络后重试。";
  // Keep authored recovery instructions, never raw API JSON or request dumps.
  if (/[\u3400-\u9fff]/.test(message) && !/[{}]|Pod API|Traceback/i.test(message) && message.length <= 500) return message;
  return fallback;
}

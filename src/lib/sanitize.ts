import DOMPurify, { type Config } from "dompurify"

/**
 * 消毒与导出安全工具（PERM-09）：不可信 HTML 渲染、不可信 URL 进 href、
 * 不可信字符串进 CSV 三条出口的统一防线。
 *
 * 本仓库为 CSR-first（README「消费端注意」）：DOMPurify 需要 `window`，仅浏览器
 * 运行时生效；无 DOM 环境调用 `sanitizeHtml` 无消毒效果，SSR 不在支持范围。
 */

/** DOMPurify 配置类型别名，消费端自定义 config 时可复用。 */
export type SanitizeConfig = Config

/**
 * 锁定的默认配置：DOMPurify 本身只放行白名单属性（全部 `on*` 事件属性默认即被
 * 剥除），这里再显式禁危险标签/属性，并把 URI scheme 收紧到 http/https/mailto/
 * 相对路径（禁 javascript: / data: 等）。`sanitizeHtml` 与默认值做顶层浅合并，
 * 需要在默认基础上增删的场景请展开 `DEFAULT_SANITIZE_CONFIG` 自己拼。
 */
export const DEFAULT_SANITIZE_CONFIG: SanitizeConfig = {
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
  FORBID_ATTR: ["srcdoc", "sandbox", "formaction"],
  // 上游默认正则的收紧版：scheme 只剩 https?/mailto；`[^a-z]` 与
  // `[a-z+.-]+(?:[^a-z+.\-:]|$)` 两个分支放行相对路径/锚点/查询串（负类里的
  // `\-` 必须转义，否则 `.-:` 被解析成范围 0x2E–0x3A，会把 `/` 一并排除），
  // `javascript:` / `data:` 等伪协议不匹配任何一个分支。
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
}

/**
 * 消毒不可信 HTML 为可安全注入 innerHTML 的字符串。
 *
 * @param dirty   不可信 HTML。
 * @param config  与 {@link DEFAULT_SANITIZE_CONFIG} 顶层浅合并（同键覆盖）。
 */
export function sanitizeHtml(dirty: string, config: SanitizeConfig = {}): string {
  // 未开启 RETURN_TRUSTED_TYPES 时运行时必返回 string（类型含 TrustedHTML 联合）。
  return DOMPurify.sanitize(dirty, { ...DEFAULT_SANITIZE_CONFIG, ...config }) as string
}

/** 放行进 href 的 scheme 白名单：http / https / mailto。 */
const SAFE_HREF_PROTOCOLS = /^(?:https?:|mailto:)/i
/** 其余带 scheme 的形态（javascript: / data: / vbscript: …）一律拒绝。 */
const SCHEME_LIKE = /^[a-z][a-z0-9+.-]*:/i

/**
 * 只放行安全 URL 的 `href` 值：http/https/mailto 与相对路径（含 `/`、`#`、`?`、
 * 协议相对 `//host`）原样返回；`javascript:` 等一律返回 `undefined`（调用方
 * 渲染 undefined 属性即可，不要拼接兜底文案）。探测在 trim 后进行——浏览器会
 * 剥除 href 首尾空白，`" javascript:…"` 同样是脚本入口。
 */
export function safeHref(url: string): string | undefined {
  const probe = url.trim()
  if (SAFE_HREF_PROTOCOLS.test(probe)) return url
  if (SCHEME_LIKE.test(probe)) return undefined
  return url
}

/**
 * 转义单个 CSV 单元格：
 * 1. OWASP CSV 注入防护——以 `=` `+` `-` `@` / TAB / CR / LF 开头的单元格加
 *    `'` 前缀，避免 Excel/WPS 当公式执行（=cmd、@SUM 等）。前缀必须在引号
 *    包裹之前加，否则包裹后的引号会掩盖开头的公式字符；
 * 2. RFC 4180 引号转义——含逗号/引号/换行的单元格整体包裹并把内部 `"` 双写。
 */
export function escapeCsvCell(value: string): string {
  let cell = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value
  if (/[",\r\n]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

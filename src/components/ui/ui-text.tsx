import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * Built-in component copy — the accessible labels and sr-only text that
 * components render themselves (close buttons, pagination, carousel, sidebar,
 * command palette), plus the shared copy groups re-used by feature components
 * (PluginTypeTag, ThemeSettings, market-errors) and non-React helpers
 * (VariableForm.validate). Chinese-first per PRODUCT.md; apps that need another
 * language wrap their tree in <UITextProvider> with partial overrides:
 *
 *   <UITextProvider text={{ close: "Close", loading: "Loading" }}>
 *
 * Templates use {token} placeholders (e.g. "共 {total} 条") — this module has
 * no interpolation runtime (no i18next); call sites substitute via String
 * replace (see pagination.tsx / VariableForm.tsx).
 *
 * Every component still allows per-instance overriding through its normal
 * props (children / aria-label spread last), so nothing already working
 * changes behavior.
 */
export interface UIText {
  /** Screen-reader label for the floating close button (Dialog / Sheet). */
  close: string
  /** Spinner status announcement. */
  loading: string
  /** Pagination previous / next controls. */
  previousPage: string
  nextPage: string
  /** Pagination ellipsis (sr-only). */
  morePages: string
  /** Breadcrumb ellipsis (sr-only). */
  more: string
  /** Sidebar trigger button and resize rail. */
  toggleSidebar: string
  /** Mobile sidebar dialog (sr-only). */
  sidebarTitle: string
  sidebarDescription: string
  /** CommandDialog defaults. */
  commandTitle: string
  commandDescription: string
  /** Carousel arrows (sr-only). */
  previousSlide: string
  nextSlide: string
  /** Navigation landmarks: pagination <nav> / breadcrumb <nav> aria-label. */
  paginationLabel: string
  breadcrumbLabel: string
  /** Pagination summary & page-size selector (TABLE-06), {token} templates. */
  paginationTotal: string
  paginationRange: string
  paginationPageSizeLabel: string
  /** Combobox chip remove button (A11Y-04). */
  chipRemove: string
  /** ErrorBoundary default fallback (STATE-04). */
  errorTitle: string
  errorDescription: string
  retry: string
  /** VariableForm built-in validation copy (FORM-10), {token} templates. */
  fileTooLarge: string
  /** Plugin type labels (PluginTypeTag). Unknown keys fall back to general. */
  pluginType: Record<string, string>
  /** ThemeSettings chrome copy; variant names/descriptions stay registry data. */
  themeSettings: {
    variantTitle: string
    variantDescription: string
    variantGroupLabel: string
    modeTitle: string
    modeDescription: string
    modeGroupLabel: string
    modeLight: string
    modeDark: string
    modeSystem: string
    paletteTitle: string
    paletteDescription: string
    swatchBackground: string
    swatchForeground: string
    swatchPrimary: string
    swatchMutedForeground: string
    swatchBorder: string
  }
  /** Market operations copy (market-errors.ts), matched by error shape. */
  marketErrors: {
    operationFailed: string
    dependenciesUnpublished: string
    duplicatePlugin: string
    duplicateContent: string
    itemUnavailable: string
    sourceUnavailable: string
    unauthorized: string
    forbidden: string
    notFound: string
    conflict: string
    payloadTooLarge: string
    validationFailed: string
    serverUnavailable: string
    networkFailed: string
  }
}

/** zh-CN defaults (中文第一版, PRODUCT.md). */
export const defaultUIText: UIText = {
  close: "关闭",
  loading: "加载中",
  previousPage: "上一页",
  nextPage: "下一页",
  morePages: "更多页面",
  more: "更多",
  toggleSidebar: "切换侧栏",
  sidebarTitle: "侧栏",
  sidebarDescription: "移动端侧栏。",
  commandTitle: "命令面板",
  commandDescription: "搜索要运行的命令…",
  previousSlide: "上一张幻灯片",
  nextSlide: "下一张幻灯片",
  paginationLabel: "分页",
  breadcrumbLabel: "面包屑",
  paginationTotal: "共 {total} 条",
  paginationRange: "第 {start}–{end} 条",
  paginationPageSizeLabel: "每页条数",
  chipRemove: "移除",
  errorTitle: "出错了",
  errorDescription: "页面渲染出现问题，可重试；若反复出现请联系管理员。",
  retry: "重试",
  fileTooLarge: "「{label}」的文件超过大小限制（最大 {max}）。",
  pluginType: {
    tool: "工具",
    provider: "模型接入",
    hook: "Hook",
    command: "命令",
    frontend: "UI 扩展",
    app: "应用",
    channel: "通道",
    memory: "记忆",
    general: "通用",
  },
  themeSettings: {
    variantTitle: "主题",
    variantDescription: "选择界面配色风格。五套主题共享相同的界面布局，各有独立的强调色与底色。",
    variantGroupLabel: "主题",
    modeTitle: "模式",
    modeDescription: "跟随系统会按操作系统的深浅设置自动切换。",
    modeGroupLabel: "外观模式",
    modeLight: "浅色",
    modeDark: "深色",
    modeSystem: "跟随系统",
    paletteTitle: "当前色板",
    paletteDescription: "实时反映上方选择。",
    swatchBackground: "背景",
    swatchForeground: "前景",
    swatchPrimary: "主色",
    swatchMutedForeground: "次要文字",
    swatchBorder: "边框",
  },
  marketErrors: {
    operationFailed: "操作未完成，请重新读取后重试。",
    dependenciesUnpublished: "此专家关联的技能或连接器尚未全部上架。请先让管理员发布依赖，再重试。",
    duplicatePlugin: "已有同名插件，当前安装没有覆盖它。请进入我的插件核对来源和版本后处理。",
    duplicateContent: "已有同名内容，当前操作没有覆盖它。请进入对应的“我的”页面核对内容后重试。",
    itemUnavailable: "此内容或关联模板已下架、失效。请刷新市场；仍不可用时联系管理员。",
    sourceUnavailable: "此来源暂时不可用，已重试仍未恢复。可以先使用其他来源，或稍后刷新。",
    unauthorized: "登录已过期，请重新登录后重试。",
    forbidden: "当前账号没有执行此操作的权限，请联系管理员。",
    notFound: "此内容已不存在或不可用，请重新读取后重试。",
    conflict: "内容或安装状态发生冲突。请进入对应的“我的”页面核对后重试。",
    payloadTooLarge: "安装包太大，请让发布者缩小后重新上传。",
    validationFailed: "配置未通过校验，请检查必填字段和安装包类型。",
    serverUnavailable: "服务暂时不可用，请稍后重新读取并重试。",
    networkFailed: "连接或下载失败，请检查网络后重试。",
  },
}

const UITextContext = createContext<UIText>(defaultUIText)

// Module-level mirror of the effective dictionary. Non-React helpers that
// cannot call hooks (market-errors.ts, VariableForm.validate) read it via
// getUIText(), so UITextProvider overrides still reach pure functions once the
// provider has mounted anywhere in the tree (assignment is render-idempotent).
let currentUIText: UIText = defaultUIText

/** Read the effective dictionary outside React (pure helpers); see UITextProvider. */
export function getUIText(): UIText {
  return currentUIText
}

export function UITextProvider({
  text,
  children,
}: {
  /** Partial overrides merged over the zh-CN defaults. */
  text?: Partial<UIText>
  children: ReactNode
}) {
  const value = useMemo(
    () => ({
      ...defaultUIText,
      ...text,
      // Nested groups merge per-key so an override can replace a single label
      // without restating the whole group.
      pluginType: { ...defaultUIText.pluginType, ...text?.pluginType },
      themeSettings: { ...defaultUIText.themeSettings, ...text?.themeSettings },
      marketErrors: { ...defaultUIText.marketErrors, ...text?.marketErrors },
    }),
    [text]
  )
  currentUIText = value
  return <UITextContext.Provider value={value}>{children}</UITextContext.Provider>
}

/** Read the effective copy dictionary. */
export function useUIText(): UIText {
  return useContext(UITextContext)
}

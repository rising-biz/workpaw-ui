import { createContext, useContext, useMemo, type ReactNode } from "react"

/**
 * Built-in component copy — the accessible labels and sr-only text that
 * components render themselves (close buttons, pagination, carousel, sidebar,
 * command palette). Chinese-first per PRODUCT.md; apps that need another
 * language wrap their tree in <UITextProvider> with partial overrides:
 *
 *   <UITextProvider text={{ close: "Close", loading: "Loading" }}>
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
}

const UITextContext = createContext<UIText>(defaultUIText)

export function UITextProvider({
  text,
  children,
}: {
  /** Partial overrides merged over the zh-CN defaults. */
  text?: Partial<UIText>
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ ...defaultUIText, ...text }),
    [text]
  )
  return <UITextContext.Provider value={value}>{children}</UITextContext.Provider>
}

/** Read the effective copy dictionary. */
export function useUIText(): UIText {
  return useContext(UITextContext)
}

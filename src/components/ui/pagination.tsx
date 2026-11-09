import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"

import { cn } from "../../lib/utils"
import { buttonVariants, type Button } from "./button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"
import { useUIText } from "./ui-text"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  const t = useUIText()
  return (
    <nav
      role="navigation"
      aria-label={t.paginationLabel}
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

/**
 * Link-styled pagination control (plain `<a>`, as upstream shadcn). It adds no
 * interactivity of its own: when consumers use it without a real `href` (e.g.
 * rendered as a button-like control) they MUST keep it keyboard-focusable —
 * a real href, or `tabIndex={0}` plus a keydown handler on the caller side.
 */
function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size,
        }),
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const t = useUIText()
  return (
    <PaginationLink
      aria-label={t.previousPage}
      size="default"
      className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon />
      <span className="hidden sm:block">{t.previousPage}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  const t = useUIText()
  return (
    <PaginationLink
      aria-label={t.nextPage}
      size="default"
      className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
      {...props}
    >
      <span className="hidden sm:block">{t.nextPage}</span>
      <ChevronRightIcon />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  const t = useUIText()
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      <span className="sr-only">{t.morePages}</span>
    </span>
  )
}

/** UIText 模板里的 {token} 占位符就地替换（本词典无插值运行时，不引 i18next）。 */
function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match
  )
}

/**
 * 「共 N 条 · 第 X–Y 条」摘要行（TABLE-06）。`current` 为 1-based 页码；总条数
 * 为 0 或页码越界时区间归到 0（不产生 X > Y 或 X > total 的错行）。
 */
function PaginationInfo({
  total,
  pageSize,
  current,
  className,
  ...props
}: React.ComponentProps<"span"> & {
  total: number
  pageSize: number
  current: number
}) {
  const t = useUIText()
  // 越界页码钳制到有效范围（消费端通常自行 clamp，这里是基元自身的兜底，
  // 避免 current 超出末页时渲染出 X > Y 的错行）。
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(current, 1), totalPages)
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return (
    <span
      data-slot="pagination-info"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    >
      {interpolate(t.paginationTotal, { total })}
      {" · "}
      {interpolate(t.paginationRange, { start, end })}
    </span>
  )
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * 每页条数选择器（TABLE-06）：受控 `value` + `onChange(nextSize)`，组合现有
 * Select。`options` 缺省 10/20/50/100；label 走 UIText（可经 UITextProvider 覆盖）。
 */
function PaginationPageSize({
  value,
  onChange,
  options = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value: number
  // 自定义回调签名与 div 原生 onChange 冲突，必须从基础 props 中剔除，
  // 否则交集类型导致任何 `(size: number) => void` 都无法赋值
  onChange: (size: number) => void
  options?: number[]
  className?: string
}) {
  const t = useUIText()
  return (
    <div
      data-slot="pagination-page-size"
      className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <span>{t.paginationPageSizeLabel}</span>
      <Select
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
      >
        <SelectTrigger size="sm" aria-label={t.paginationPageSizeLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
  PaginationInfo,
  PaginationPageSize,
}

import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Button } from "./ui/button"
import { useUIText } from "./ui/ui-text"

export interface ErrorBoundaryProps {
  children: React.ReactNode
  /**
   * 自定义 fallback：ReactNode 或 `(state) => ReactNode`（可拿到 error 并调
   * `reset()` 重试）。缺省用内置的 destructive Alert + 重试按钮（文案走 UIText）。
   */
  fallback?:
    | React.ReactNode
    | ((state: { error: Error; reset: () => void }) => React.ReactNode)
  /** 错误上报钩子（componentDidCatch 透传）；是否重抛由消费端决定。 */
  onError?: (error: Error, info: React.ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * 默认 fallback：不直接渲染 error.message（可能含内部实现细节），只给
 * 可操作的「重试」；文案走 UIText 词典。
 */
function DefaultErrorFallback({ reset }: { error: Error; reset: () => void }) {
  const t = useUIText()
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{t.errorTitle}</AlertTitle>
      <AlertDescription>
        <p>{t.errorDescription}</p>
        <Button variant="outline" size="sm" onClick={reset}>
          {t.retry}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * STATE-04：class 组件错误边界。在路由 / 面板粒度包裹，子树渲染抛错时展示
 * fallback 而不是整页白屏；`reset` 清空错误状态触发重挂载（重试）。
 * 注意：错误边界不捕获事件回调、异步任务与它自身内部的错误。
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    const { fallback } = this.props
    if (typeof fallback === "function") {
      return fallback({ error, reset: this.reset })
    }
    if (fallback !== undefined) {
      return fallback
    }
    return <DefaultErrorFallback error={error} reset={this.reset} />
  }
}

/** HOC：给任意组件包一层 ErrorBoundary（透传原始 props，新增边界 props 可选）。 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  boundaryProps?: Omit<ErrorBoundaryProps, "children">
) {
  function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary {...boundaryProps}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    )
  }
  return WithErrorBoundary
}

export { ErrorBoundary }

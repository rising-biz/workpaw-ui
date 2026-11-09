import { cn } from "../lib/utils";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./ui/select";
import type { ScenarioVariable } from "../types/scenario";
import { getUIText } from "./ui/ui-text";

export interface VariableFormProps {
  variables: ScenarioVariable[];
  values: Record<string, string | File | undefined>;
  onChange: (key: string, value: string | File | undefined) => void;
  /**
   * Per-variable error messages keyed by variable key (usually the output of
   * `VariableForm.validate` mapped back to keys). When present the control is
   * announced as invalid (`aria-invalid`) and the message is wired through
   * `aria-describedby` + `role="alert"`, so required validation closes the
   * loop inside the component instead of relying on out-of-band copy.
   */
  errors?: Record<string, string>;
  disabled?: boolean;
  className?: string;
}

/**
 * Renders form controls for scenario variables.
 *
 * Required-marker semantics: a variable with `required: true` renders its
 * label with a trailing `*` (display only). This marker is NOT a substitute
 * for validation — callers MUST run {@link VariableForm.validate} before
 * consuming `values` and pass the failures back via the `errors` prop (or
 * surface them themselves).
 *
 * Note on ids: each control id is derived from its render index AND variable
 * key (`var-{i}-{key}`) so duplicate or special-character keys cannot collide.
 */
function VariableFormComponent({
  variables,
  values,
  onChange,
  errors,
  disabled,
  className,
}: VariableFormProps) {
  if (variables.length === 0) return null;
  return (
    <div className={cn("space-y-4", className)}>
      {variables.map((v, i) => {
        const id = `var-${i}-${v.key}`;
        const label = v.required ? `${v.label}*` : v.label;
        const val = values[v.key];
        const error = errors?.[v.key];
        const describedBy = error ? `${id}-error` : undefined;
        const ariaProps = {
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
        };
        return (
          <div key={`${i}-${v.key}`} className="space-y-1.5">
            <Label htmlFor={id}>
              {label}
            </Label>
            {v.type === "text" && (
              <Input
                id={id}
                disabled={disabled}
                placeholder={v.placeholder}
                value={(val as string) ?? ""}
                onChange={(e) => onChange(v.key, e.target.value)}
                {...ariaProps}
              />
            )}
            {v.type === "textarea" && (
              <Textarea
                id={id}
                disabled={disabled}
                placeholder={v.placeholder}
                rows={3}
                value={(val as string) ?? ""}
                onChange={(e) => onChange(v.key, e.target.value)}
                {...ariaProps}
              />
            )}
            {v.type === "select" && (
              <Select
                disabled={disabled}
                value={(val as string) ?? v.default ?? ""}
                onValueChange={(value) => onChange(v.key, value)}
              >
                <SelectTrigger id={id} {...ariaProps}>
                  <SelectValue placeholder={v.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {(v.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {v.type === "file" && (
              <Input
                // Uncontrolled by nature: remounting on the
                // defined → undefined transition is what makes external
                // resets visible (values[key] = undefined clears the
                // rendered file name; a plain input cannot do that).
                key={val ? "has-value" : "empty"}
                id={id}
                type="file"
                disabled={disabled}
                accept={v.accept}
                onChange={(e) => onChange(v.key, e.target.files?.[0])}
                {...ariaProps}
              />
            )}
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 字节的人读格式（「{max}」插值用）：B / KB / MB / GB，MB 起保留一位小数。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10} GB`;
}

/**
 * Validate `values` against `variables`:
 *
 * - required 校验：缺值 / 空串的必填变量返回其 label（非必填从不缺值上报）——
 *   调用方把返回的 label 作为错误文案展示（如 "请填写: 主题"）；
 * - 大小校验（FORM-10）：声明了 `maxSizeBytes` 的变量只要提供了 File 就检查
 *   （与 required 无关），超限返回完整错误文案（走 UIText `fileTooLarge` 词条）。
 *
 * 返回数组因此混合两种形态：裸 label（缺值）与完整句子（超限）——两者都是
 * 可直接展示的字符串，键位回填逻辑不受影响。
 *
 * The `*` required marker rendered on labels is display-only; this method
 * is the source of truth for validation.
 */
function validate(
  variables: ScenarioVariable[],
  values: Record<string, string | File | undefined>,
): string[] {
  const problems: string[] = [];
  for (const v of variables) {
    const val = values[v.key];
    // 大小校验先行：只要提供了文件就检查，避免「选了超限文件却提示缺值」。
    if (v.maxSizeBytes != null && val instanceof File && val.size > v.maxSizeBytes) {
      problems.push(
        getUIText()
          .fileTooLarge.replace("{label}", v.label)
          .replace("{max}", formatBytes(v.maxSizeBytes)),
      );
      continue;
    }
    if (!v.required) continue;
    if (val == null) {
      problems.push(v.label);
      continue;
    }
    // File is "present" once defined; strings must be non-empty after trim
    if (typeof val === "string" && val.trim() === "") {
      problems.push(v.label);
    }
  }
  return problems;
}

/**
 * VariableForm: renderable component + static `validate` helper.
 *
 * `VariableForm.validate(...)` is the source of truth for required-field
 * validation; the `*` marker on labels is display-only.
 */
export const VariableForm = Object.assign(VariableFormComponent, { validate });

export type VariableFormStatic = typeof VariableForm;

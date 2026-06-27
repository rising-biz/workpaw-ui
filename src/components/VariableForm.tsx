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

export interface VariableFormProps {
  variables: ScenarioVariable[];
  values: Record<string, string | File | undefined>;
  onChange: (key: string, value: string | File | undefined) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Renders form controls for scenario variables.
 *
 * Required-marker semantics: a variable with `required: true` renders its
 * label with a trailing `*` (display only). This marker is NOT a substitute
 * for validation — callers MUST run {@link VariableForm.validate} before
 * consuming `values` and surface the returned labels as errors.
 *
 * Note on ids: each control id is derived from its render index AND variable
 * key (`var-{i}-{key}`) so duplicate or special-character keys cannot collide.
 */
function VariableFormComponent({
  variables,
  values,
  onChange,
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
        return (
          <div key={`${i}-${v.key}`} className="space-y-1.5">
            <Label htmlFor={id} className="text-sm">
              {label}
            </Label>
            {v.type === "text" && (
              <Input
                id={id}
                disabled={disabled}
                placeholder={v.placeholder}
                value={(val as string) ?? ""}
                onChange={(e) => onChange(v.key, e.target.value)}
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
              />
            )}
            {v.type === "select" && (
              <Select
                disabled={disabled}
                value={(val as string) ?? v.default ?? ""}
                onValueChange={(value) => onChange(v.key, value)}
              >
                <SelectTrigger id={id}>
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
                id={id}
                type="file"
                disabled={disabled}
                onChange={(e) => onChange(v.key, e.target.files?.[0])}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Validate `values` against `variables`' required flags.
 *
 * Returns the labels (not keys) of required variables whose value is
 * missing, empty, or whitespace-only. Non-required variables are never
 * reported. Callers should display the returned labels as error messages
 * (e.g. "请填写: 主题").
 *
 * The `*` required marker rendered on labels is display-only; this method
 * is the source of truth for required validation.
 */
function validate(
  variables: ScenarioVariable[],
  values: Record<string, string | File | undefined>,
): string[] {
  const missing: string[] = [];
  for (const v of variables) {
    if (!v.required) continue;
    const val = values[v.key];
    if (val == null) {
      missing.push(v.label);
      continue;
    }
    // File is "present" once defined; strings must be non-empty after trim
    if (typeof val === "string" && val.trim() === "") {
      missing.push(v.label);
    }
  }
  return missing;
}

/**
 * VariableForm: renderable component + static `validate` helper.
 *
 * `VariableForm.validate(...)` is the source of truth for required-field
 * validation; the `*` marker on labels is display-only.
 */
export const VariableForm = Object.assign(VariableFormComponent, { validate });

export type VariableFormStatic = typeof VariableForm;

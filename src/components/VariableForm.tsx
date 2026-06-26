import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { ScenarioVariable } from "../types/scenario";

export interface VariableFormProps {
  variables: ScenarioVariable[];
  values: Record<string, string | File | undefined>;
  onChange: (key: string, value: string | File | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function VariableForm({
  variables,
  values,
  onChange,
  disabled,
  className,
}: VariableFormProps) {
  if (variables.length === 0) return null;
  return (
    <div className={cn("space-y-4", className)}>
      {variables.map((v) => {
        const id = `var-${v.key}`;
        const label = v.required ? `${v.label}*` : v.label;
        const val = values[v.key];
        return (
          <div key={v.key} className="space-y-1.5">
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

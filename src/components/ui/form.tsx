import * as React from "react"
import type { Label as LabelPrimitive } from "radix-ui"
import { Slot } from "radix-ui"
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { cn } from "../../lib/utils"
import { Label } from "./label"

/**
 * WorkPaw 包装（FORM-01）：校验时机默认 `mode="onBlur"` + `reValidateMode=
 * "onChange"`，显式传 `mode` / `reValidateMode` 可覆盖；其余 props 原样透传。
 *
 * RHF 的 FormProvider 只接收 methods 对象（mode/reValidateMode 是 `useForm()`
 * 的选项，直接传给 FormProvider 会被静默丢弃），因此本组件按 props 形态分流：
 *
 * 1. shadcn 惯用法 `<Form {...form}>`（props 里带 `control`）：原样透传，
 *    校验时机跟随调用方自己的 `useForm()` 配置——此形态下本组件的
 *    mode/reValidateMode 不生效（RHF 机制限制）；
 * 2. 自包含用法 `<Form>…</Form>`（未传 methods）：Form 内部 `useForm()` 自建
 *    表单并应用默认/覆盖后的校验时机，子树内的 FormField / useFormContext
 *    直接取用。
 */
type FormProps = Omit<React.ComponentProps<typeof FormProvider>, "children"> & {
  children?: React.ReactNode
  /** FORM-01 默认 "onBlur"；仅在 Form 自建表单（未透传 methods）时生效。 */
  mode?: "onBlur" | "onChange" | "onSubmit" | "onTouched" | "all"
  /** FORM-01 默认 "onChange"；仅在 Form 自建表单（未透传 methods）时生效。 */
  reValidateMode?: "onChange" | "onBlur"
}

function Form({
  children,
  mode = "onBlur",
  reValidateMode = "onChange",
  ...methods
}: FormProps) {
  const hasMethods = methods.control !== undefined
  const internalForm = useForm({ mode, reValidateMode })
  return (
    <FormProvider {...(hasMethods ? methods : internalForm)}>
      {children}
    </FormProvider>
  )
}

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue
)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>")
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue
)

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId()

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  )
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const { error, formItemId } = useFormField()

  return (
    <Label
      data-slot="form-label"
      data-error={!!error}
      className={cn("data-[error=true]:text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  )
}

function FormControl({ ...props }: React.ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={
        !error
          ? `${formDescriptionId}`
          : `${formDescriptionId} ${formMessageId}`
      }
      aria-invalid={!!error}
      {...props}
    />
  )
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField()

  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error?.message ?? "") : props.children

  if (!body) {
    return null
  }

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  )
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}

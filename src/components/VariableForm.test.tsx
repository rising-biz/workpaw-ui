import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariableForm } from "./VariableForm";
import type { ScenarioVariable } from "../types/scenario";

const vars: ScenarioVariable[] = [
  { key: "topic", label: "主题", type: "text", required: true },
  { key: "tone", label: "语气", type: "select", required: false, options: ["正式", "友好"], default: "正式" },
  { key: "body", label: "正文", type: "textarea", required: false },
  { key: "avatar", label: "头像", type: "file", required: false },
];

describe("VariableForm", () => {
  it("renders a control per variable with required marker", () => {
    const onChange = vi.fn();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    // required marker: label text is "主题*" (exact match proves the "*")
    expect(screen.getByText("主题*")).toBeInTheDocument();
    // non-required labels render without marker (substring ok)
    expect(screen.getByText("语气")).toBeInTheDocument();
    expect(screen.getByLabelText("正文")).toBeInTheDocument();
  });

  it("renders a select control for select-type variables", () => {
    const onChange = vi.fn();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    // select trigger renders and shows its placeholder/default value
    // the tone variable has default "正式"
    const trigger = screen.getByRole("combobox", { name: "语气" });
    expect(trigger).toBeInTheDocument();
  });

  it("renders a file input for file-type variables", () => {
    const onChange = vi.fn();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    const fileInput = screen.getByLabelText("头像") as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.type).toBe("file");
  });

  it("renders a textarea for textarea-type variables", () => {
    const onChange = vi.fn();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    const textarea = screen.getByLabelText("正文") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe("TEXTAREA");
  });

  it("calls onChange when typing in text field", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    const input = screen.getByLabelText("主题*");
    await user.type(input, "hi");
    expect(onChange).toHaveBeenCalledWith("topic", "h");
  });

  it("assigns unique ids even when variable keys repeat", () => {
    const dupVars: ScenarioVariable[] = [
      { key: "tag", label: "标签一", type: "text", required: false },
      { key: "tag", label: "标签二", type: "text", required: false },
    ];
    const onChange = vi.fn();
    render(<VariableForm variables={dupVars} values={{}} onChange={onChange} />);
    const input1 = screen.getByLabelText("标签一") as HTMLInputElement;
    const input2 = screen.getByLabelText("标签二") as HTMLInputElement;
    // both inputs must be addressable (distinct ids), and the labels must point at them
    expect(input1.id).not.toBe(input2.id);
    expect(input1.id).toBeTruthy();
    expect(input2.id).toBeTruthy();
    // label htmlFor wires correctly to each distinct input
    const labels = screen.getAllByText(/标签[一二]/);
    const htmlFor1 = labels.find((l) => l.textContent === "标签一");
    const htmlFor2 = labels.find((l) => l.textContent === "标签二");
    expect(htmlFor1?.getAttribute("for")).toBe(input1.id);
    expect(htmlFor2?.getAttribute("for")).toBe(input2.id);
  });

  it("validate() returns labels of missing required variables", () => {
    const onChange = vi.fn();
    render(
      <VariableForm
        variables={vars}
        values={{ topic: "", tone: "正式" }}
        onChange={onChange}
      />,
    );
    // topic is required and empty -> should be reported
    expect(VariableForm.validate(vars, { topic: "", tone: "正式" })).toEqual([
      "主题",
    ]);
    // all required satisfied -> empty list
    expect(VariableForm.validate(vars, { topic: "x", tone: "正式" })).toEqual([]);
    // undefined value for required counts as missing
    expect(VariableForm.validate(vars, {})).toEqual(["主题"]);
  });

  it("validate() ignores whitespace-only values for required variables", () => {
    expect(VariableForm.validate(vars, { topic: "   " })).toEqual(["主题"]);
  });

  it("validate() does not flag non-required variables", () => {
    // none of tone/body/avatar are required, so only topic matters
    expect(
      VariableForm.validate(vars, { tone: "", body: "", avatar: undefined }),
    ).toEqual(["主题"]);
  });
});

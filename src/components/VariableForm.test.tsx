import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VariableForm } from "./VariableForm";
import type { ScenarioVariable } from "../types/scenario";

const vars: ScenarioVariable[] = [
  { key: "topic", label: "主题", type: "text", required: true },
  { key: "tone", label: "语气", type: "select", required: false, options: ["正式", "友好"], default: "正式" },
  { key: "body", label: "正文", type: "textarea", required: false },
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

  it("calls onChange when typing in text field", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VariableForm variables={vars} values={{}} onChange={onChange} />);
    const input = screen.getByLabelText("主题*");
    await user.type(input, "hi");
    expect(onChange).toHaveBeenCalledWith("topic", "h");
  });
});

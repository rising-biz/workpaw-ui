export type ScenarioVariableType = "text" | "textarea" | "select" | "file";

export interface ScenarioVariable {
  key: string;
  label: string;
  type: ScenarioVariableType;
  required: boolean;
  placeholder?: string;
  options?: string[];
  default?: string;
}

export interface ScenarioExampleTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ScenarioModelPreset {
  provider_id: string;
  model: string;
}

export interface ScenarioAttachment {
  name: string;
  url: string;
  type?: string;
}

export interface Scenario {
  id: string;
  slug: string;
  source: "official" | "enterprise";
  title: string;
  description: string;
  category: string;
  icon: string;
  agent_id: string;
  agent_name: string;
  model_preset: ScenarioModelPreset | null;
  prompt_template: string;
  variables: ScenarioVariable[];
  example_dialogue: ScenarioExampleTurn[];
  sort_order: number;
  enabled: boolean;

  // ── 组合编排层(Phase 1)──
  skills?: string[];                   // 场景声明激活的技能名
  greeting?: string;                   // 开场白
  suggested_prompts?: string[];        // 推荐追问/对话开场白
  attachments?: ScenarioAttachment[];  // 场景级常驻附件(轻量知识)
}

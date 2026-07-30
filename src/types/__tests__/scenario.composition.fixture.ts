import type { Scenario, ScenarioAttachment } from "../scenario";

// 类型级 TDD:构造一个带全部新字段的 Scenario。加字段前 tsc 会报
// "Property 'skills' does not exist on type 'Scenario'"(red)。
export const compositionScenario: Scenario = {
  id: "1",
  slug: "rich-demo",
  source: "official",
  title: "富场景演示",
  description: "d",
  category: "c",
  icon: "i",
  agent_id: "agent-1",
  agent_name: "文档助手",
  model_preset: null,
  prompt_template: "请总结:{{doc}}",
  variables: [],
  example_dialogue: [],
  sort_order: 0,
  enabled: true,
  skills: ["summarize", "format"],
  greeting: "你好，我来帮你总结文档",
  suggested_prompts: ["总结这份报告", "提炼三个要点"],
  attachments: [
    { name: "模板.docx", url: "file://tmpl", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ],
};

export const anAttachment: ScenarioAttachment = { name: "f", url: "u" };

// token-meta.test.ts
import { describe, it, expect } from "vitest";
import { TOKEN_REGISTRY } from "./token-meta";

describe("token-meta", () => {
  it("含 bg-grid-image(grid 组,string,可编辑)", () => {
    const t = TOKEN_REGISTRY.find((x) => x.name === "bg-grid-image");
    expect(t).toBeDefined();
    expect(t!.group).toBe("grid");
    expect(t!.type).toBe("string");
    expect(t!.editable).toBe(true);
    expect(t!.perTheme).toBe(false);
  });
});

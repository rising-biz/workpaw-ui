// backgroundPresets.test.ts
import { describe, it, expect } from "vitest";
import {
  BACKGROUND_PRESETS,
  BACKGROUND_PRESET_IDS,
  DEFAULT_BACKGROUND_PRESET,
  type BackgroundPresetId,
} from "./backgroundPresets";

describe("backgroundPresets 真相源", () => {
  it("恰好 4 套预设", () => {
    expect(BACKGROUND_PRESETS).toHaveLength(4);
  });

  it("id 唯一且与 IDS 派生一致", () => {
    const ids = BACKGROUND_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(BACKGROUND_PRESET_IDS).toEqual(ids);
  });

  it("默认预设在集合内", () => {
    expect(BACKGROUND_PRESET_IDS).toContain(DEFAULT_BACKGROUND_PRESET);
    expect(DEFAULT_BACKGROUND_PRESET).toBe("control-tower");
  });

  it("每套预设 meta 完整", () => {
    for (const p of BACKGROUND_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeGreaterThan(0);
      expect(Object.keys(p.tokens).length).toBeGreaterThan(0);
      expect(p.preview.gridImage.length).toBeGreaterThan(0);
      expect(p.preview.glow.length).toBeGreaterThan(0);
    }
  });

  it("每套预设都设置 bg-grid-image 与 grid-line-opacity 与 bg-glow-intensity", () => {
    for (const p of BACKGROUND_PRESETS) {
      expect(p.tokens["bg-grid-image"]).toBeDefined();
      expect(p.tokens["grid-line-opacity"]).toBeDefined();
      expect(p.tokens["bg-glow-intensity"]).toBeDefined();
    }
  });

  it("纯光晕与极简无网格(bg-grid-image 为 none)", () => {
    const byId = (id: BackgroundPresetId) =>
      BACKGROUND_PRESETS.find((p) => p.id === id)!;
    expect(byId("pure-glow").tokens["bg-grid-image"]).toBe("none");
    expect(byId("minimal").tokens["bg-grid-image"]).toBe("none");
  });
});

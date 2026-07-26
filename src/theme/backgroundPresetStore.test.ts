// backgroundPresetStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  BACKGROUND_PRESET_STORAGE_KEY,
  useBackgroundPresetStore,
} from "./backgroundPresetStore";
import { DEFAULT_BACKGROUND_PRESET } from "./backgroundPresets";

describe("backgroundPresetStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useBackgroundPresetStore.setState({ preset: DEFAULT_BACKGROUND_PRESET });
  });

  it("setPreset 写 state 且持久化为 plain-string", () => {
    useBackgroundPresetStore.getState().setPreset("dot-matrix");
    expect(useBackgroundPresetStore.getState().preset).toBe("dot-matrix");
    expect(localStorage.getItem(BACKGROUND_PRESET_STORAGE_KEY)).toBe("dot-matrix");
  });

  it("key 为 workpaw-bg-preset", () => {
    expect(BACKGROUND_PRESET_STORAGE_KEY).toBe("workpaw-bg-preset");
  });
});

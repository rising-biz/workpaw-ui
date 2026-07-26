import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  BACKGROUND_PRESET_IDS,
  DEFAULT_BACKGROUND_PRESET,
  type BackgroundPresetId,
} from "./backgroundPresets";

/**
 * 背景预设 store — 「哪套背景」轴,与配色变体(variantStore)、明暗(next-themes)
 * 正交。持久化为 PLAIN STRING(下方 key),非 zustand JSON,让 index.html 的
 * no-flash 脚本能直接读裸字符串预应用。id 与默认只在 backgroundPresets.ts 定义。
 */

export const BACKGROUND_PRESET_STORAGE_KEY = "workpaw-bg-preset";

export { DEFAULT_BACKGROUND_PRESET, type BackgroundPresetId } from "./backgroundPresets";

function readInitialPreset(): BackgroundPresetId {
  try {
    const v = localStorage.getItem(BACKGROUND_PRESET_STORAGE_KEY);
    if (v && (BACKGROUND_PRESET_IDS as readonly string[]).includes(v)) {
      return v as BackgroundPresetId;
    }
  } catch (e) {
    console.warn("workpaw: failed to read bg preset from localStorage", e);
  }
  return DEFAULT_BACKGROUND_PRESET;
}

interface BackgroundPresetState {
  preset: BackgroundPresetId;
  setPreset: (preset: BackgroundPresetId) => void;
}

export const useBackgroundPresetStore = create<BackgroundPresetState>((set) => ({
  preset: readInitialPreset(),
  setPreset: (preset) => {
    try {
      localStorage.setItem(BACKGROUND_PRESET_STORAGE_KEY, preset);
    } catch (e) {
      console.warn("workpaw: failed to persist bg preset to localStorage", e);
    }
    set({ preset });
  },
}));

export const useBackgroundPreset = () =>
  useBackgroundPresetStore(
    useShallow((s) => ({ preset: s.preset, setPreset: s.setPreset })),
  );

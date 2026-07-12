import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import {
  DEFAULT_THEME_VARIANT,
  THEME_VARIANT_IDS,
  type ThemeVariant,
} from "./variants";

/**
 * Theme variant store — the "which palette" axis (see variants.ts registry).
 *
 * The "light/dark/system" axis is owned by next-themes (ThemeProvider). This
 * store owns ONLY the variant, persisted as a PLAIN STRING in localStorage
 * (key below), NOT zustand's JSON wrapper. That keeps the no-flash inline
 * script in each app's index.html trivial (read a bare string, set the
 * data-theme attribute) and decoupled from any store serialization format.
 *
 * The variant ids and default are defined ONCE in variants.ts and consumed via
 * THEME_VARIANT_IDS / DEFAULT_THEME_VARIANT — never re-enumerate them here.
 */

export const THEME_VARIANT_STORAGE_KEY = "workpaw-theme-variant";

export { DEFAULT_THEME_VARIANT, type ThemeVariant } from "./variants";

function readInitialVariant(): ThemeVariant {
  try {
    const v = localStorage.getItem(THEME_VARIANT_STORAGE_KEY);
    if (v && (THEME_VARIANT_IDS as readonly string[]).includes(v)) {
      return v as ThemeVariant;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_VARIANT;
}

interface VariantState {
  variant: ThemeVariant;
  setVariant: (variant: ThemeVariant) => void;
}

export const useThemeVariantStore = create<VariantState>((set) => ({
  variant: readInitialVariant(),
  setVariant: (variant) => {
    try {
      localStorage.setItem(THEME_VARIANT_STORAGE_KEY, variant);
    } catch {
      /* ignore */
    }
    set({ variant });
  },
}));

// Return a STABLE object reference (via useShallow) so consumers that
// destructure { variant, setVariant } don't re-render every store change —
// and, critically, don't return a fresh object that breaks useSyncExternalStore's
// snapshot caching (which otherwise throws "Maximum update depth exceeded").
export const useThemeVariant = () =>
  useThemeVariantStore(
    useShallow((s) => ({ variant: s.variant, setVariant: s.setVariant })),
  );

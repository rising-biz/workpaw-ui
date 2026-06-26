import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/**
 * Theme variant store — the "which palette" axis (standard / contrast / soft).
 *
 * The "light/dark/system" axis is owned by next-themes (ThemeProvider). This
 * store owns ONLY the variant, persisted as a PLAIN STRING in localStorage
 * (key below), NOT zustand's JSON wrapper. That keeps the no-flash inline
 * script in each app's index.html trivial (read a bare string, set the
 * data-theme attribute) and decoupled from any store serialization format.
 */

export type ThemeVariant = "standard" | "ember" | "abyss" | "verdant";

export const THEME_VARIANT_STORAGE_KEY = "workpaw-theme-variant";

function readInitialVariant(): ThemeVariant {
  try {
    const v = localStorage.getItem(THEME_VARIANT_STORAGE_KEY);
    if (v === "ember" || v === "abyss" || v === "verdant") return v;
  } catch {
    /* ignore */
  }
  return "standard";
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

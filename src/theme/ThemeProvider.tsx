import { useEffect, useRef, type ReactNode } from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme,
  type ThemeProviderProps as NextThemeProviderProps,
} from "next-themes";
import { DEFAULT_THEME_VARIANT } from "./variants";
import { useThemeVariantStore } from "./variantStore";

/**
 * ThemeProvider — wraps next-themes (mode: light/dark/system → `.dark` class on
 * <html>, with persistence + its own no-flash script) and syncs the theme
 * VARIANT to a `data-theme` attribute on <html>. The DEFAULT variant (indigo,
 * the bare `:root` palette in theme.css) maps to the attribute ABSENT; every
 * other variant sets `data-theme="<id>"`.
 *
 * next-themes touches only the `class` attribute; this provider touches only
 * `data-theme`. No collision. The 10 combos are resolved in CSS by the
 * `:root[data-theme]` + `.dark` matrix in workpaw-ui/src/styles/theme.css.
 *
 * First paint (before React mounts) is handled by the shared no-flash script
 * (`src/theme-init.js`, exported as "workpaw-ui/theme-init.js"), which applies
 * the same mapping from the persisted plain-string variant (see variantStore).
 *
 * Motion: on any variant or resolved-mode change, `.theme-transitioning` is
 * flashed on <html> for 320ms so the whole UI cross-fades its colors (see the
 * MOTION section of theme.css). The class is absent on first mount, so the
 * no-flash guard is untouched. Reduced-motion users get an instant switch via
 * the global @media safeguard.
 */
const TRANSITION_MS = 320;

/**
 * Inner watcher — must live INSIDE NextThemesProvider so it can read the
 * resolved light/dark mode via useTheme(). Applies the data-theme attribute
 * for the variant and flashes the crossfade class on any change (skipping the
 * first mount to preserve the no-flash guarantee).
 */
function ThemeApplier() {
  const variant = useThemeVariantStore((s) => s.variant);
  const { resolvedTheme } = useTheme();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  // Apply the variant attribute. The DEFAULT variant IS the bare `:root`
  // palette, so it removes the attribute; everything else sets its own.
  useEffect(() => {
    const el = document.documentElement;
    if (variant === DEFAULT_THEME_VARIANT) {
      el.removeAttribute("data-theme");
    } else {
      el.setAttribute("data-theme", variant);
    }
  }, [variant]);

  // Flash the crossfade class on variant OR resolved-mode change (not first mount).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = document.documentElement;
    el.classList.add("theme-transitioning");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove("theme-transitioning"), TRANSITION_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [variant, resolvedTheme]);

  return null;
}

export function ThemeProvider({ children, ...props }: NextThemeProviderProps & { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      {...props}
    >
      <ThemeApplier />
      {children}
    </NextThemesProvider>
  );
}

export { useTheme };

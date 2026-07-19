import { useEffect, useRef, type ReactNode } from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme,
  type ThemeProviderProps as NextThemeProviderProps,
} from "next-themes";
import { useThemeVariantStore } from "./variantStore";

/**
 * ThemeProvider — wraps next-themes (mode: light/dark/system → `.dark` class on
 * <html>, with persistence + its own no-flash script) and syncs the theme
 * VARIANT to a `data-theme` attribute on <html> (verdant = attribute absent).
 *
 * next-themes touches only the `class` attribute; this provider touches only
 * `data-theme`. No collision. The 6 combos are resolved in CSS by the
 * `:root[data-theme]` + `.dark` matrix in workpaw-ui/src/styles/theme.css.
 *
 * The variant is persisted as a plain string (see variantStore); each app's
 * index.html has a tiny inline script that pre-sets `data-theme` before paint
 * so there is no flash to verdant on reload.
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

  // Apply the variant attribute.
  useEffect(() => {
    const el = document.documentElement;
    if (variant === "verdant") {
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
      defaultTheme="light"
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

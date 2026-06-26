import { useEffect, type ReactNode } from "react";
import {
  ThemeProvider as NextThemesProvider,
  useTheme,
  type ThemeProviderProps as NextThemeProviderProps,
} from "next-themes";
import { useThemeVariantStore } from "./variantStore";

/**
 * ThemeProvider — wraps next-themes (mode: light/dark/system → `.dark` class on
 * <html>, with persistence + its own no-flash script) and syncs the theme
 * VARIANT to a `data-theme` attribute on <html> (standard = attribute absent).
 *
 * next-themes touches only the `class` attribute; this provider touches only
 * `data-theme`. No collision. The 6 combos are resolved in CSS by the
 * `:root[data-theme]` + `.dark` matrix in workpaw-ui/src/styles/theme.css.
 *
 * The variant is persisted as a plain string (see variantStore); each app's
 * index.html has a tiny inline script that pre-sets `data-theme` before paint
 * so there is no flash to standard on reload.
 */
export function ThemeProvider({ children, ...props }: NextThemeProviderProps & { children: ReactNode }) {
  const variant = useThemeVariantStore((s) => s.variant);

  useEffect(() => {
    const el = document.documentElement;
    if (variant === "standard") {
      el.removeAttribute("data-theme");
    } else {
      el.setAttribute("data-theme", variant);
    }
  }, [variant]);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

export { useTheme };

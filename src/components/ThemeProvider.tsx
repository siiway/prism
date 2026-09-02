// Fluent UI v9 theme provider with dynamic accent color and custom CSS injection

import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  createLightTheme,
  createDarkTheme,
} from "@fluentui/react-components";
import type { BrandVariants } from "@fluentui/react-components";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../lib/api-context";
import { useThemeStore } from "../store/theme";
import { patchTheme } from "../theme";

interface ThemeProviderProps {
  children: ReactNode;
  /** Scheme resolved for this SSR request; null/undefined uses browser hints. */
  initialColorScheme?: "dark" | "light" | null;
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = h / 360,
    sNorm = s / 100,
    lNorm = l / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (sNorm === 0) {
    r = g = b = lNorm;
  } else {
    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;
    r = hue2rgb(p, q, hNorm + 1 / 3);
    g = hue2rgb(p, q, hNorm);
    b = hue2rgb(p, q, hNorm - 1 / 3);
  }
  return `#${Math.round(r * 255)
    .toString(16)
    .padStart(2, "0")}${Math.round(g * 255)
    .toString(16)
    .padStart(2, "0")}${Math.round(b * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function buildBrandVariants(accentHex: string): BrandVariants {
  const [h, s, l] = hexToHsl(accentHex);
  const shades = [
    10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
  ] as const;
  const variants: Record<number, string> = {};
  shades.forEach((shade, i) => {
    const lightness = Math.max(5, Math.min(95, l + (8 - i) * 7));
    variants[shade] = hslToHex(h, s, lightness);
  });
  return variants as BrandVariants;
}

export function ThemeProvider({
  children,
  initialColorScheme,
}: ThemeProviderProps) {
  const api = useApi();
  const { data: siteConfig } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const mode = useThemeStore((s) => s.mode);

  // Seed from the same request-local value the server used so the SSR'd
  // FluentProvider classnames match the client's first paint. The browser
  // falls back to the serialized payload, cookie, or matchMedia when absent.
  const [prefersDark, setPrefersDark] = useState(() => {
    if (typeof window === "undefined") return initialColorScheme === "dark";
    const ssr = initialColorScheme ?? window.__INITIAL__?.colorScheme;
    if (ssr === "dark" || ssr === "light") return ssr === "dark";
    const cookieMatch = document.cookie.match(
      /(?:^|; )prism_color_scheme=(dark|light)/,
    );
    if (cookieMatch) return cookieMatch[1] === "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) return;
    // Sync to the current OS preference, not just future changes. SSR
    // can't read matchMedia, so the first cookieless visit lands with
    // whatever the server defaulted to (light); without this initial
    // sync, dark-mode users would never get flipped. After this runs
    // once, the cookie effect below writes the resolved value so the
    // next SSR pass picks it up — no flash on subsequent visits.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional post-hydration sync to OS preference
    if (mediaQuery.matches !== prefersDark) setPrefersDark(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
    // Intentionally empty deps — the listener handles subsequent changes,
    // and we only want the initial sync on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve the effective scheme: an explicit user choice (light/dark)
  // overrides the OS preference; "system" follows it.
  const resolvedDark = mode === "system" ? prefersDark : mode === "dark";

  // Persist the resolved scheme so the next SSR pass renders the same
  // theme the client will hydrate to. 1-year max-age; samesite=lax is fine
  // since the cookie only encodes a UI preference.
  useEffect(() => {
    const value = resolvedDark ? "dark" : "light";
    document.cookie = `prism_color_scheme=${value}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.setAttribute("data-theme", value);
  }, [resolvedDark]);

  const theme = useMemo(() => {
    const accent = siteConfig?.accent_color ?? "#0078d4";
    try {
      const brand = buildBrandVariants(accent);
      const base = resolvedDark
        ? createDarkTheme(brand)
        : createLightTheme(brand);
      return patchTheme(base, resolvedDark);
    } catch {
      const fallback = resolvedDark ? webDarkTheme : webLightTheme;
      return patchTheme(fallback, resolvedDark);
    }
  }, [siteConfig?.accent_color, resolvedDark]);

  // Inject custom CSS, set document title/icon, and update Safari theme color
  useEffect(() => {
    if (!siteConfig) return;

    document.title = siteConfig.site_name;

    if (siteConfig.site_icon_url) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = siteConfig.site_icon_url;
    }

    if (siteConfig.custom_css) {
      if (!styleRef.current) {
        styleRef.current = document.createElement("style");
        document.head.appendChild(styleRef.current);
      }
      styleRef.current.textContent = siteConfig.custom_css;
    } else if (styleRef.current) {
      styleRef.current.textContent = "";
    }
  }, [siteConfig]);

  useEffect(() => {
    let themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!themeMeta) {
      themeMeta = document.createElement("meta");
      themeMeta.name = "theme-color";
      document.head.appendChild(themeMeta);
    }
    themeMeta.content = theme.colorNeutralBackground1;
  }, [theme]);

  return (
    <FluentProvider
      theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--colorNeutralBackground1)",
      }}
    >
      {children}
    </FluentProvider>
  );
}

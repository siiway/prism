// Fluent UI v9 theme provider with dynamic accent color and custom CSS injection

import {
  FluentProvider,
  webLightTheme,
  webDarkTheme,
  createLightTheme,
  createDarkTheme,
} from "@fluentui/react-components";
import type { BrandVariants } from "@fluentui/react-components";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface ThemeProviderProps {
  children: ReactNode;
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

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { data: siteConfig } = useQuery({
    queryKey: ["site"],
    queryFn: api.site,
    staleTime: 60_000,
  });
  const styleRef = useRef<HTMLStyleElement | null>(null);

  const prefersDark =
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

  const theme = useMemo(() => {
    const accent = siteConfig?.accent_color ?? "#0078d4";
    try {
      const brand = buildBrandVariants(accent);
      return prefersDark ? createDarkTheme(brand) : createLightTheme(brand);
    } catch {
      return prefersDark ? webDarkTheme : webLightTheme;
    }
  }, [siteConfig?.accent_color, prefersDark]);

  // Inject custom CSS and set document title/icon
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

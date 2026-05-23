export type VinylVariant = "solid" | "marbled" | "splatter" | "picture" | "clear";

export type Vinyl = {
  variant: VinylVariant;
  primary: string;
  secondary?: string;
  label: string;
};

export type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

const COLOR_MAP: Record<string, string> = {
  red: "#dc2626",
  crimson: "#be123c",
  ruby: "#be123c",
  maroon: "#7f1d1d",
  burgundy: "#7f1d1d",
  pink: "#ec4899",
  coral: "#fb7185",
  magenta: "#d946ef",
  orange: "#ea580c",
  yellow: "#facc15",
  custard: "#facc15",
  sulphuric: "#facc15",
  ducky: "#facc15",
  gold: "#d97706",
  golden: "#d97706",
  creamy: "#f5e6c8",
  cream: "#fde68a",
  white: "#f1f5f9",
  ghost: "#e5e7eb",
  silver: "#cbd5e1",
  grey: "#71717a",
  gray: "#71717a",
  smoke: "#71717a",
  brown: "#92400e",
  tan: "#a16207",
  green: "#16a34a",
  emerald: "#059669",
  olive: "#65a30d",
  sage: "#84cc16",
  forest: "#15803d",
  jade: "#10b981",
  mint: "#6ee7b7",
  teal: "#0d9488",
  cyan: "#0891b2",
  aqua: "#06b6d4",
  blue: "#2563eb",
  cobalt: "#1d4ed8",
  navy: "#1e3a8a",
  sky: "#3b82f6",
  turquoise: "#06b6d4",
  purple: "#9333ea",
  grape: "#9333ea",
  amethyst: "#9333ea",
  violet: "#7c3aed",
  lavender: "#a78bfa",
  plum: "#86198f",
  glow: "#bef264",
  black: "#0a0a0a",
};

const COLOR_KEYS = Object.keys(COLOR_MAP);

function findColors(text: string): { name: string; hex: string }[] {
  const found: { name: string; hex: string }[] = [];
  for (const key of COLOR_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(text) && !found.some((f) => f.name === key)) {
      found.push({ name: key, hex: COLOR_MAP[key] });
    }
  }
  return found;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelFromColors(colors: { name: string }[], suffix = "") {
  if (colors.length === 0) return suffix.trim();
  const names = colors.slice(0, 2).map((c) => capitalize(c.name)).join(" / ");
  return `${names}${suffix ? ` ${suffix}` : ""}`.trim();
}

export function detectVinyl(descriptions: (string | undefined | null)[]): Vinyl {
  const text = descriptions.filter(Boolean).join(" ").toLowerCase();

  if (/picture\s*disc/.test(text)) {
    return { variant: "picture", primary: "#0a0a0a", label: "Picture Disc" };
  }

  const splatter = /splatter|splattered|stripe/.test(text);
  const marbled = /marbled|swirl|swirled|smoke|tri[\s-]?colou?r|mix\b|shadow/.test(text);
  const clear = /clear|translucent|transparent|coke\s*bottle|frosted/.test(text);
  const glow = /glow/.test(text);

  const colors = findColors(text);

  if (glow) {
    return {
      variant: "solid",
      primary: "#bef264",
      label: "Glow In The Dark",
    };
  }

  if (splatter) {
    return {
      variant: "splatter",
      primary: colors[0]?.hex ?? "#0a0a0a",
      secondary: colors[1]?.hex ?? "#fde68a",
      label: labelFromColors(colors, "Splatter") || "Splatter",
    };
  }
  if (marbled) {
    return {
      variant: "marbled",
      primary: colors[0]?.hex ?? "#71717a",
      secondary: colors[1]?.hex ?? "#0a0a0a",
      label: labelFromColors(colors, "Marbled") || "Marbled",
    };
  }
  if (clear) {
    return {
      variant: "clear",
      primary: colors[0]?.hex ?? "#e5e7eb",
      label: colors[0] ? `Translucent ${capitalize(colors[0].name)}` : "Clear",
    };
  }
  if (colors.length > 0) {
    return {
      variant: "solid",
      primary: colors[0].hex,
      label: `${capitalize(colors[0].name)} Vinyl`,
    };
  }

  return { variant: "solid", primary: "#0a0a0a", label: "Black Vinyl" };
}

// Returns explicit RGB colors Discogs called out for the vinyl body.
//   - Picture disc / unspecified clear → null (any color OK)
//   - Explicit colors → those colors (+ pairwise averages for marbled mixes)
//   - Nothing specified → null (caller treats as black, but won't fire color-blob fallback)
export function expectedVinylColors(
  descriptions: (string | undefined | null)[],
): RGB[] | null {
  const text = descriptions.filter(Boolean).join(" ").toLowerCase();
  if (/picture\s*disc/.test(text)) return null;

  const matched: RGB[] = [];
  for (const key of COLOR_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(text)) {
      matched.push(hexToRgb(COLOR_MAP[key]));
    }
  }
  if (/\bclear\b|translucent|transparent/.test(text) && matched.length === 0) {
    return null;
  }
  if (matched.length > 0) {
    // For marbled/smoke/swirl records the photographed body is often a *mix*
    // of the called-out colors (gray from black+white, etc). Add pairwise
    // averages so the cross-check accepts those blended ring colors.
    if (matched.length >= 2) {
      const blended: RGB[] = [];
      for (let i = 0; i < matched.length; i++) {
        for (let j = i + 1; j < matched.length; j++) {
          blended.push({
            r: Math.round((matched[i].r + matched[j].r) / 2),
            g: Math.round((matched[i].g + matched[j].g) / 2),
            b: Math.round((matched[i].b + matched[j].b) / 2),
          });
        }
      }
      return [...matched, ...blended];
    }
    return matched;
  }
  return null;
}

const BLACK_RGB: RGB = { r: 10, g: 10, b: 10 };

// For the strict ring-color cross-check, treat "no explicit color" as black.
export function ringCheckColors(explicit: RGB[] | null): RGB[] {
  return explicit && explicit.length > 0 ? explicit : [BLACK_RGB];
}

// Extract a color name from free-form text using the same color map detectVinyl
// uses. Used to honor sheet-override notes like "Use pink to create custom SVG
// version" or "Outer green color" — the note literally states the intended
// color, so we should use it directly instead of trying to sample the image.
// Returns the hex string for the first recognized color, or null.
export function colorHexFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const key of COLOR_KEYS) {
    if (new RegExp(`\\b${key}\\b`).test(lower)) return COLOR_MAP[key];
  }
  return null;
}


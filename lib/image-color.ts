import sharp from "sharp";

export type ImageColor = {
  r: number;
  g: number;
  b: number;
  hex: string;
  saturation: number;
  lightness: number;
};

const cache = new Map<string, ImageColor | null>();

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl(r: number, g: number, b: number) {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN:
        h = (gN - bN) / d + (gN < bN ? 6 : 0);
        break;
      case gN:
        h = (bN - rN) / d + 2;
        break;
      case bN:
        h = (rN - gN) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

export async function dominantCenterColor(url: string): Promise<ImageColor | null> {
  if (cache.has(url)) return cache.get(url) ?? null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "DiscogsDashboard/0.1" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      cache.set(url, null);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 20 || h < 20) {
      cache.set(url, null);
      return null;
    }
    const size = Math.min(w, h);
    const inset = Math.round(size * 0.18);
    const cropSize = size - inset * 2;
    const left = Math.round((w - cropSize) / 2);
    const top = Math.round((h - cropSize) / 2);

    const { data, info } = await img
      .extract({ left, top, width: cropSize, height: cropSize })
      .resize(48, 48, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = new Map<string, { r: number; g: number; b: number; w: number }>();
    const channels = info.channels;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { s, l } = rgbToHsl(r, g, b);
      if (l < 0.06 || l > 0.94) continue;
      const weight = s + 0.05;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const b0 = buckets.get(key);
      if (b0) {
        b0.r += r * weight;
        b0.g += g * weight;
        b0.b += b * weight;
        b0.w += weight;
      } else {
        buckets.set(key, { r: r * weight, g: g * weight, b: b * weight, w: weight });
      }
    }
    let best: { r: number; g: number; b: number; w: number } | null = null;
    for (const b of buckets.values()) {
      if (!best || b.w > best.w) best = b;
    }
    if (!best || best.w === 0) {
      cache.set(url, null);
      return null;
    }
    const r = Math.round(best.r / best.w);
    const g = Math.round(best.g / best.w);
    const b = Math.round(best.b / best.w);
    const { s, l } = rgbToHsl(r, g, b);
    const result: ImageColor = {
      r,
      g,
      b,
      hex: rgbToHex(r, g, b),
      saturation: s,
      lightness: l,
    };
    cache.set(url, result);
    return result;
  } catch {
    cache.set(url, null);
    return null;
  }
}

export function isLikelyVinylColor(c: ImageColor): boolean {
  if (c.lightness < 0.18) return false;
  if (c.lightness > 0.85) return false;
  if (c.saturation < 0.35) return false;
  return true;
}

const NAMED_COLORS: { name: string; hex: string; r: number; g: number; b: number }[] = [
  { name: "Red", hex: "#dc2626", r: 220, g: 38, b: 38 },
  { name: "Pink", hex: "#ec4899", r: 236, g: 72, b: 153 },
  { name: "Orange", hex: "#ea580c", r: 234, g: 88, b: 12 },
  { name: "Gold", hex: "#d97706", r: 217, g: 119, b: 6 },
  { name: "Yellow", hex: "#facc15", r: 250, g: 204, b: 21 },
  { name: "Green", hex: "#16a34a", r: 22, g: 163, b: 74 },
  { name: "Emerald", hex: "#059669", r: 5, g: 150, b: 105 },
  { name: "Teal", hex: "#0d9488", r: 13, g: 148, b: 136 },
  { name: "Cyan", hex: "#06b6d4", r: 6, g: 182, b: 212 },
  { name: "Blue", hex: "#2563eb", r: 37, g: 99, b: 235 },
  { name: "Navy", hex: "#1e3a8a", r: 30, g: 58, b: 138 },
  { name: "Purple", hex: "#9333ea", r: 147, g: 51, b: 234 },
  { name: "Violet", hex: "#7c3aed", r: 124, g: 58, b: 237 },
  { name: "Brown", hex: "#92400e", r: 146, g: 64, b: 14 },
  { name: "White", hex: "#f1f5f9", r: 241, g: 245, b: 249 },
];

export function nearestColorName(c: ImageColor): string {
  let best = NAMED_COLORS[0];
  let bestDist = Infinity;
  for (const n of NAMED_COLORS) {
    const d =
      (c.r - n.r) * (c.r - n.r) +
      (c.g - n.g) * (c.g - n.g) +
      (c.b - n.b) * (c.b - n.b);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best.name;
}

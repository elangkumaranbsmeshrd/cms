// Ported verbatim from prototype/app-core.js's rampFrom() — same formula,
// same mix ratios, so a custom accent derives the identical hover/subtle/
// line shades in the real app as it did in the signed-off prototype.
function hexRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: number[]): string =>
  '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);

export interface AccentRamp {
  accent: string;
  hover: string;
  subtle: string;
  line: string;
}

export function rampFrom(hex: string, dark: boolean): AccentRamp {
  const base = hexRgb(hex);
  const white = [255, 255, 255];
  const black = [0, 0, 0];
  if (dark) {
    return {
      accent: toHex(mix(base, white, 0.22)),
      hover: toHex(mix(base, white, 0.38)),
      subtle: toHex(mix(base, hexRgb('#0a0c11'), 0.84)),
      line: toHex(mix(base, hexRgb('#0a0c11'), 0.66)),
    };
  }
  return {
    accent: hex,
    hover: toHex(mix(base, black, 0.22)),
    subtle: toHex(mix(base, white, 0.9)),
    line: toHex(mix(base, white, 0.68)),
  };
}

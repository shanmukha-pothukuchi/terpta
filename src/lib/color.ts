/**
 * Duty-type colors, turned into the translucent fills the board is drawn in.
 *
 * The colors a coordinator picks on the Duty types screen were only ever
 * shown on that screen: every block on the board used one of two hard-coded
 * greys, so picking a color did nothing.
 */

/** Fallback for a duty type with no color, or a color we cannot parse. */
export const NEUTRAL = "#7D93B2";

/** "#E21833" or "#e13" → [226, 24, 51]. Null for anything else. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const body = m[1];
  const full =
    body.length === 3
      ? body
          .split("")
          .map((c) => c + c)
          .join("")
      : body;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** `rgba()` of a duty color, or of the neutral when it does not parse. */
export function withAlpha(hex: string | undefined, alpha: number): string {
  const rgb = parseHex(hex ?? "") ?? parseHex(NEUTRAL)!;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/**
 * A readable version of a duty color for small text on the dark board.
 *
 * UMD red at full strength on a near-black background is legible but harsh
 * at 10.5px, so labels are lifted toward white by `amount` (0 = the color
 * itself, 1 = white).
 */
export function lighten(hex: string | undefined, amount: number): string {
  const rgb = parseHex(hex ?? "") ?? parseHex(NEUTRAL)!;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(rgb[0])},${mix(rgb[1])},${mix(rgb[2])})`;
}

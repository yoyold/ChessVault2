import data from './openings.json';

const table = data as unknown as Record<string, [string, string]>;

export interface OpeningHit { eco: string; name: string; ply: number }

/** Longest known opening for a move sequence (SAN without +/#). */
export function findOpening(sans: string[]): OpeningHit | null {
  let key = '';
  let hit: OpeningHit | null = null;
  const max = Math.min(sans.length, 36);
  for (let i = 0; i < max; i++) {
    key = i ? key + ' ' + sans[i] : sans[i];
    const e = table[key];
    if (e) hit = { eco: e[0], name: e[1], ply: i + 1 };
  }
  return hit;
}

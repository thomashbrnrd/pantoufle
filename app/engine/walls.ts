/** Wall decomposition into solid pieces around openings. Pure, unit-tested. */
import type { Wall } from './schema';

export interface WallPiece {
  /** Along the axis, measured from point a (negative = extension before a). */
  s0: number;
  s1: number;
  z0: number;
  z1: number;
  /** Blocks the visitor: full-height pieces and sills higher than 40 cm. */
  collide: boolean;
}

export function wallFrame(w: Wall) {
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
  const length = Math.hypot(dx, dy);
  return { length, ux: dx / length, uy: dy / length, angle: Math.atan2(dy, dx) };
}

export function wallPieces(w: Wall, levelHeight: number): WallPiece[] {
  const h = w.height ?? levelHeight;
  const [e0, e1] = Array.isArray(w.extend) ? w.extend : [w.extend ?? 0, w.extend ?? 0];
  const { length } = wallFrame(w);
  const start = -e0, end = length + e1;
  const openings = [...(w.openings ?? [])].sort((p, q) => p.from - q.from);
  const pieces: WallPiece[] = [];
  let cur = start;
  for (const o of openings) {
    if (o.from > cur) pieces.push({ s0: cur, s1: o.from, z0: 0, z1: h, collide: true });
    if (o.z[0] > 0) pieces.push({ s0: o.from, s1: o.to, z0: 0, z1: o.z[0], collide: o.z[0] > 40 });
    pieces.push({ s0: o.from, s1: o.to, z0: o.z[1], z1: h, collide: false });
    cur = Math.max(cur, o.to);
  }
  if (cur < end) pieces.push({ s0: cur, s1: end, z0: 0, z1: h, collide: true });
  return pieces.filter((p) => p.s1 - p.s0 >= 0.1 && p.z1 - p.z0 >= 0.1);
}

/** How far a buried wall end is pulled back so its cap hides inside the other wall (cm). */
export const BURIED_END_TRIM = 0.3;

/** Is the plan point strictly inside wall `w`'s footprint (extensions included)? */
function insideWall(w: Wall, x: number, y: number, margin: number): boolean {
  const { length, ux, uy } = wallFrame(w);
  const [e0, e1] = Array.isArray(w.extend) ? w.extend : [w.extend ?? 0, w.extend ?? 0];
  const dx = x - w.a[0], dy = y - w.a[1];
  const s = dx * ux + dy * uy, t = -dx * uy + dy * ux;
  return s > -e0 + margin && s < length + e1 - margin && Math.abs(t) < w.thickness / 2 - margin;
}

/**
 * Walls overlapping at a corner leave their end caps in the plane of the other wall's face,
 * which z-fights (e.g. a white cap flickering through the façade brick). When the last
 * centimetre of a wall runs inside another wall, pull that end back by BURIED_END_TRIM so the
 * cap is buried. T-junctions (a wall merely touching another one's face) are left untouched.
 */
export function trimBuriedEnds(walls: readonly Wall[]): Wall[] {
  return walls.map((w) => {
    const { length, ux, uy } = wallFrame(w);
    let [e0, e1] = Array.isArray(w.extend) ? w.extend : [w.extend ?? 0, w.extend ?? 0];
    const buried = (s: number) => {
      const x = w.a[0] + ux * s, y = w.a[1] + uy * s;
      return walls.some((o) => o !== w && insideWall(o, x, y, 0.05));
    };
    if (buried(-e0 + 1)) e0 -= BURIED_END_TRIM;
    if (buried(length + e1 - 1)) e1 -= BURIED_END_TRIM;
    return { ...w, extend: [e0, e1] as [number, number] };
  });
}

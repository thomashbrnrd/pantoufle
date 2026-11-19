/** 2D collisions on the plan (cm). Pure functions, unit-tested. */

/** Oriented rectangle: centre, unit axis, half length along the axis, half thickness across. */
export interface ObbCollider { kind: 'obb'; cx: number; cy: number; ux: number; uy: number; hl: number; ht: number; owner: string }
/** Capsule around a segment. */
export interface SegmentCollider { kind: 'segment'; ax: number; ay: number; bx: number; by: number; radius: number; owner: string }
export type Collider = ObbCollider | SegmentCollider;

export function obbFromRect(x0: number, y0: number, x1: number, y1: number, owner: string): ObbCollider {
  return { kind: 'obb', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ux: 1, uy: 0, hl: Math.abs(x1 - x0) / 2, ht: Math.abs(y1 - y0) / 2, owner };
}

/** Is a disc of radius r centred on (x, y) overlapping the collider? */
export function hits(c: Collider, x: number, y: number, r: number): boolean {
  if (c.kind === 'obb') {
    const dx = x - c.cx, dy = y - c.cy;
    const s = dx * c.ux + dy * c.uy; // along axis
    const t = -dx * c.uy + dy * c.ux; // across
    return Math.abs(s) < c.hl + r && Math.abs(t) < c.ht + r;
  }
  const dx = c.bx - c.ax, dy = c.by - c.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((x - c.ax) * dx + (y - c.ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (c.ax + t * dx), y - (c.ay + t * dy)) < r + c.radius;
}

export interface World {
  colliders: Collider[];
  /** [x0, y0, x1, y1] walkable bounds. */
  bounds: [number, number, number, number];
  /** Owners currently present in the scene (building, furnishing, variant…). */
  active: (owner: string) => boolean;
}

export function blocked(world: World, x: number, y: number, r: number, ignore?: ReadonlySet<Collider>): boolean {
  const [x0, y0, x1, y1] = world.bounds;
  if (x < x0 || x > x1 || y < y0 || y > y1) return true;
  for (const c of world.colliders) if (!ignore?.has(c) && world.active(c.owner) && hits(c, x, y, r)) return true;
  return false;
}

/**
 * Axis-separated move so the visitor slides along walls. Colliders already overlapping the
 * visitor are ignored, so a door closing on them (or a bad spawn) never traps them.
 */
export function slide(world: World, pos: { x: number; y: number }, dx: number, dy: number, r: number) {
  const inside = new Set(world.colliders.filter((c) => world.active(c.owner) && hits(c, pos.x, pos.y, r)));
  if (!blocked(world, pos.x + dx, pos.y, r, inside)) pos.x += dx;
  if (!blocked(world, pos.x, pos.y + dy, r, inside)) pos.y += dy;
}

export function pointInPolygon(x: number, y: number, p: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!, [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

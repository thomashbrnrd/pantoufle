/**
 * Static detection of z-fighting: two faces lying in the same plane, facing the same way and
 * overlapping flicker on screen. Checks axis-aligned boxes (fixture and furnishing parts, wall
 * pieces of axis-aligned walls) and horizontal polygons (floors, ceilings). Pure, unit-tested.
 */
import type { Project, Wall } from './schema';
import { trimBuriedEnds, wallFrame, wallPieces } from './walls';

/** A rectangle in an axis-aligned plane, with its outward normal. */
interface Face {
  axis: 0 | 1 | 2; // normal along X, Y or Z
  sign: 1 | -1;
  at: number; // plane coordinate (cm)
  // extents on the two other axes, in order (X,Y,Z minus `axis`)
  a0: number; a1: number; b0: number; b1: number;
  owner: string;
  /** Material id: identical materials in the same plane do not flicker visibly. */
  mat: string;
}

type MatSpec = string | { default?: string; n?: string; s?: string; e?: string; w?: string; top?: string; bottom?: string } | undefined;
/** Box face → material, with the box convention (n = −Y, s = +Y, e = +X, w = −X). */
function faceMat(spec: MatSpec, axis: 0 | 1 | 2, sign: 1 | -1): string {
  if (typeof spec === 'string' || !spec) return spec ?? '?';
  const key = axis === 0 ? (sign > 0 ? 'e' : 'w') : axis === 1 ? (sign > 0 ? 's' : 'n') : sign > 0 ? 'top' : 'bottom';
  return spec[key] ?? spec.default ?? '?';
}

export interface ZFight { a: string; b: string; plane: string; area: number; mats: string }

const EPS = 0.01;
const AXES = ['X', 'Y', 'Z'] as const;

function boxFaces(min: readonly number[], max: readonly number[], owner: string, mat: MatSpec): Face[] {
  const faces: Face[] = [];
  for (const axis of [0, 1, 2] as const) {
    const [u, v] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
    for (const sign of [-1, 1] as const) {
      faces.push({ axis, sign, at: sign < 0 ? min[axis]! : max[axis]!, a0: min[u]!, a1: max[u]!, b0: min[v]!, b1: max[v]!, owner, mat: faceMat(mat, axis, sign) });
    }
  }
  return faces;
}

/** Wall faces in box terms: left/right of a→b (plan north up; walking east, left is north). */
function wallMat(w: Wall): MatSpec {
  const { ux, uy } = wallFrame(w);
  const def = w.faces?.default ?? 'paint', left = w.faces?.left ?? def, right = w.faces?.right ?? def;
  if (Math.abs(uy) < 1e-9) return ux > 0 ? { default: def, n: left, s: right } : { default: def, s: left, n: right };
  return uy > 0 ? { default: def, e: left, w: right } : { default: def, w: left, e: right };
}

function wallBoxes(w: Wall, levelHeight: number): Array<{ min: number[]; max: number[] }> {
  const { ux, uy } = wallFrame(w);
  const axisX = Math.abs(uy) < 1e-9, axisY = Math.abs(ux) < 1e-9;
  if (!axisX && !axisY) return []; // oblique walls: not checked
  const ht = w.thickness / 2;
  return wallPieces(w, levelHeight).map((p) => {
    const s0 = Math.min(p.s0, p.s1), s1 = Math.max(p.s0, p.s1);
    if (axisX) {
      const x0 = w.a[0] + ux * s0, x1 = w.a[0] + ux * s1;
      return { min: [Math.min(x0, x1), w.a[1] - ht, p.z0], max: [Math.max(x0, x1), w.a[1] + ht, p.z1] };
    }
    const y0 = w.a[1] + uy * s0, y1 = w.a[1] + uy * s1;
    return { min: [w.a[0] - ht, Math.min(y0, y1), p.z0], max: [w.a[0] + ht, Math.max(y0, y1), p.z1] };
  });
}

/** Horizontal polygon → its bounding rectangle (good enough to flag candidates). */
function polygonFace(points: ReadonlyArray<readonly [number, number]>, z: number, sign: 1 | -1, owner: string, mat: string): Face {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { axis: 2, sign, at: z, a0: Math.min(...xs), a1: Math.max(...xs), b0: Math.min(...ys), b1: Math.max(...ys), owner, mat };
}

/** Faces of everything axis-aligned in the project (first level), in plan cm. Faces that are
 * obviously hidden (pressed against another volume, undersides on the floor) are dropped. */
export function collectFaces(p: Project): Face[] {
  const faces: Face[] = [];
  const solids: Array<{ min: number[]; max: number[]; owner: string }> = [];
  const level = p.building.levels[0]!;
  for (const w of trimBuriedEnds(level.walls)) {
    wallBoxes(w, level.height).forEach((b, i) => {
      faces.push(...boxFaces(b.min, b.max, `mur ${w.id}#${i}`, wallMat(w)));
      solids.push({ ...b, owner: `mur ${w.id}#${i}` });
    });
  }
  for (const r of level.rooms) faces.push(polygonFace(r.polygon, r.floor.z ?? 0, 1, `sol ${r.id}`, r.floor.material));
  const items = [
    ...level.fixtures.map((it) => ({ it, kind: 'existant' })),
    ...p.furnishing.common.items.map((it) => ({ it, kind: 'meublé' })),
    ...p.furnishing.variants.flatMap((v) => v.items.map((it) => ({ it, kind: `variante ${v.id}` }))),
  ];
  for (const { it, kind } of items) {
    const rot = (((it.rotation ?? 0) % 360) + 360) % 360;
    if (rot !== 0) continue; // rotated items: not checked
    const [ox, oy, oz] = it.position ?? [0, 0, 0];
    const parts = [...(it.ref ? p.catalog[it.ref]?.parts ?? [] : []), ...(it.parts ?? [])];
    parts.forEach((part, i) => {
      const name = `${kind} ${it.id}/${part.name ?? `${part.type}#${i}`}`;
      if (part.type === 'box') {
        const min = [part.min[0] + ox, part.min[1] + oy, part.min[2] + oz], max = [part.max[0] + ox, part.max[1] + oy, part.max[2] + oz];
        faces.push(...boxFaces(min, max, name, part.material));
        solids.push({ min, max, owner: name });
      } else if (part.type === 'polygon') {
        faces.push(polygonFace(part.points.map(([x, y]) => [x + ox, y + oy] as const), part.z + oz, part.facing === 'down' ? -1 : 1, name, part.material));
      }
    });
  }
  // A face is hidden when the point just in front of its centre is inside another solid.
  const visible = (f: Face) => {
    if (f.axis === 2 && f.sign < 0 && f.at <= 0.5) return false; // underside on the floor
    const [u, v] = [0, 1, 2].filter((k) => k !== f.axis) as [number, number];
    // Hidden only if a 3 × 3 grid of points just in front of it is entirely inside other solids.
    for (const i of [1 / 6, 1 / 2, 5 / 6]) for (const j of [1 / 6, 1 / 2, 5 / 6]) {
      const pt = [0, 0, 0];
      pt[f.axis] = f.at + f.sign * 0.05; pt[u] = f.a0 + (f.a1 - f.a0) * i; pt[v] = f.b0 + (f.b1 - f.b0) * j;
      if (!solids.some((s) => s.owner !== f.owner && pt.every((c, k) => c > s.min[k]! + 1e-6 && c < s.max[k]! - 1e-6))) return true;
    }
    return false;
  };
  return faces.filter(visible);
}

/** Pairs of coplanar, same-facing, overlapping faces from different parts. */
export function findZFights(faces: Face[], minArea = 25): ZFight[] {
  const out: ZFight[] = [];
  const groups = new Map<string, Face[]>();
  for (const f of faces) {
    const key = `${f.axis}|${f.sign}|${Math.round(f.at / EPS)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const a = g[i]!, b = g[j]!;
        if (a.owner === b.owner || a.mat === b.mat) continue;
        if (a.owner.startsWith('sol ') && b.owner.startsWith('sol ')) continue; // bounding boxes only
        const da = Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0), db = Math.min(a.b1, b.b1) - Math.max(a.b0, b.b0);
        if (da <= EPS || db <= EPS || da * db < minArea) continue;
        out.push({ a: a.owner, b: b.owner, mats: `${a.mat}/${b.mat}`, plane: `${a.sign > 0 ? '+' : '-'}${AXES[a.axis]} = ${+a.at.toFixed(2)}`, area: Math.round(da * db) });
      }
    }
  }
  return out.sort((x, y) => y.area - x.area);
}

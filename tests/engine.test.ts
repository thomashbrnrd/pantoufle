import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BURIED_END_TRIM, trimBuriedEnds, wallPieces } from '../app/engine/walls';
import { blocked, hits, obbFromRect, pointInPolygon, slide, type World } from '../app/engine/collision';
import { doorFrame, doorLeafRect } from '../app/engine/doors';
import { loadProject } from '../app/engine/load';
import { groupProducts, parsePrice } from '../app/composables/useShoppingList';
import type { Wall } from '../app/engine/schema';

describe('wallPieces', () => {
  const facade: Wall = {
    id: 'w', a: [-10, 670], b: [673, 670], thickness: 20, extend: 10,
    openings: [{ id: 'baie', type: 'bay', from: 366, to: 586, z: [0, 222] }],
  };
  it('splits around a floor-level opening and keeps the lintel', () => {
    expect(wallPieces(facade, 250)).toEqual([
      { s0: -10, s1: 366, z0: 0, z1: 250, collide: true },
      { s0: 366, s1: 586, z0: 222, z1: 250, collide: false },
      { s0: 586, s1: 693, z0: 0, z1: 250, collide: true },
    ]);
  });
  it('adds a sill below a window, colliding when higher than 40 cm', () => {
    const w: Wall = { ...facade, openings: [{ id: 'f', type: 'window', from: 100, to: 200, z: [90, 215] }] };
    expect(wallPieces(w, 250).find((p) => p.z0 === 0 && p.s0 === 100)).toMatchObject({ z1: 90, collide: true });
  });
});

describe('trimBuriedEnds', () => {
  // Façade and east wall overlapping at the south-east corner, plus a partition abutting the façade.
  const facade: Wall = { id: 'f', a: [-10, 670], b: [673, 670], thickness: 20, extend: 10 };
  const east: Wall = { id: 'e', a: [673, 79], b: [673, 670], thickness: 20, extend: 10 };
  const partition: Wall = { id: 'p', a: [316, 286], b: [316, 660], thickness: 7 };
  const [f, e, p] = trimBuriedEnds([facade, east, partition]);
  it('pulls back ends buried in another wall (corner overlap → no coplanar caps)', () => {
    expect(f!.extend).toEqual([10, 10 - BURIED_END_TRIM]);
    expect(e!.extend).toEqual([10, 10 - BURIED_END_TRIM]);
  });
  it('leaves free ends and T-junctions untouched', () => {
    expect(p!.extend).toEqual([0, 0]);
  });
});

describe('collision', () => {
  it('blocks within radius of an axis-aligned rectangle', () => {
    const c = obbFromRect(0, 0, 100, 20, 'building');
    expect(hits(c, 50, 35, 18)).toBe(true);
    expect(hits(c, 50, 39, 18)).toBe(false);
  });
  it('handles rotated rectangles', () => {
    const c = { kind: 'obb' as const, cx: 0, cy: 0, ux: Math.SQRT1_2, uy: Math.SQRT1_2, hl: 50, ht: 5, owner: 'x' };
    expect(hits(c, 30, 30, 1)).toBe(true);
    expect(hits(c, 30, -30, 1)).toBe(false);
  });
  it('ignores inactive owners and enforces bounds', () => {
    const world: World = { colliders: [obbFromRect(0, 0, 10, 10, 'variant:bar')], bounds: [-100, -100, 100, 100], active: () => false };
    expect(blocked(world, 5, 5, 1)).toBe(false);
    expect(blocked(world, 150, 0, 1)).toBe(true);
  });
  it('never traps the visitor inside a collider (door closing on them)', () => {
    const world: World = { colliders: [obbFromRect(0, 0, 100, 4, 'building')], bounds: [-500, -500, 500, 500], active: () => true };
    const pos = { x: 50, y: 2 };
    slide(world, pos, 0, 10, 18);
    expect(pos.y).toBe(12);
  });
  it('detects points in polygons', () => {
    expect(pointInPolygon(1, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true);
    expect(pointInPolygon(3, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(false);
  });
});

describe('arboreal-143 project', async () => {
  const dir = join(import.meta.dirname, '..', 'public', 'projects', 'arboreal-143');
  const project = await loadProject(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')));

  it('validates and keeps the Cogedim surfaces as rooms', () => {
    expect(project.building.levels[0]!.rooms.map((r) => r.id)).toEqual(['entree', 'cuisine', 'sejour', 'chambre', 'sde', 'terrasse', 'palier']);
  });
  it('loads the technical spec with a finish schedule for every room', () => {
    const rooms = project.building.levels[0]!.rooms.map((r) => r.id).sort();
    expect(project.spec!.spaces.map((s) => s.room).sort()).toEqual(rooms);
    expect(project.spec!.openings.map((o) => o.opening).sort()).toEqual(['baie-sejour', 'pf-chambre', 'porte-chambre', 'porte-paliere', 'porte-sde']);
  });
  it('the spawn point is in the entrance and free', () => {
    const entree = project.building.levels[0]!.rooms[0]!;
    expect(pointInPolygon(project.meta.start.x, project.meta.start.y, entree.polygon)).toBe(true);
  });
  /** Axis-aligned bounds of a door leaf footprint, rounded to the mm. */
  const leafBounds = (wallId: string, ratio: number) => {
    const w = project.building.levels[0]!.walls.find((x) => x.id === wallId)!;
    const r = doorLeafRect(doorFrame(w, w.openings!.find((o) => o.door)!), ratio);
    const ex = Math.abs(r.ux) * r.hl + Math.abs(r.uy) * r.ht, ey = Math.abs(r.uy) * r.hl + Math.abs(r.ux) * r.ht;
    return [r.cx - ex, r.cy - ey, r.cx + ex, r.cy + ey].map((v) => Math.round(v * 10) / 10);
  };
  it('open doors match the prototype (hinge side, swing side)', () => {
    expect(leafBounds('bedroom-door-wall', 1)).toEqual([308, 294, 312, 377]); // into the bedroom
    expect(leafBounds('bath-entrance', 1)).toEqual([213.5, 209.5, 296.5, 213.5]); // into the entrance
    expect(leafBounds('north-entrance', 1)).toEqual([312.5, 13.5, 316.5, 106.5]); // into the entrance (closed at start)
  });
  it('closed doors fill their opening, flush with the swing-side face', () => {
    expect(leafBounds('bedroom-door-wall', 0)).toEqual([229, 290, 312, 294]);
    expect(leafBounds('bath-entrance', 0)).toEqual([209.5, 130.5, 213.5, 213.5]);
    expect(leafBounds('north-entrance', 0)).toEqual([223.5, 9.5, 316.5, 13.5]);
  });
  it('groups the shopping list by room, variant products first', () => {
    const groups = groupProducts(project, 'bar');
    expect(groups.map((g) => g.roomId)).toEqual(['cuisine', 'sejour', 'chambre', 'sde', 'terrasse']);
    expect(groups[1]!.products.slice(0, 2).map((p) => p.id)).toEqual(['bar', 'tabourets']);
    expect(groupProducts(project, 'table-ronde')[1]!.products[0]!.id).toBe('table');
  });
});

describe('parsePrice', () => {
  it('accepts French formats', () => {
    expect(parsePrice('1 299,90')).toBe(1299.9);
    expect(parsePrice('')).toBe(null);
    expect(parsePrice(null)).toBe(null);
  });
});

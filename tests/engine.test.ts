import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wallPieces } from '../app/engine/walls';
import { blocked, hits, obbFromRect, pointInPolygon, type World } from '../app/engine/collision';
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
  it('detects points in polygons', () => {
    expect(pointInPolygon(1, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(true);
    expect(pointInPolygon(3, 1, [[0, 0], [2, 0], [2, 2], [0, 2]])).toBe(false);
  });
});

describe('arboreal-143 project', async () => {
  const dir = join(import.meta.dirname, '..', 'public', 'projects', 'arboreal-143');
  const project = await loadProject(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')));

  it('validates and keeps the Cogedim surfaces as rooms', () => {
    expect(project.building.levels[0]!.rooms.map((r) => r.id)).toEqual(['entree', 'cuisine', 'sejour', 'chambre', 'sde', 'terrasse']);
  });
  it('the spawn point is in the entrance and free', () => {
    const entree = project.building.levels[0]!.rooms[0]!;
    expect(pointInPolygon(project.meta.start.x, project.meta.start.y, entree.polygon)).toBe(true);
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

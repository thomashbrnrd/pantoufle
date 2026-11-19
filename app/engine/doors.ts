/** Door leaf geometry on a wall opening. Pure (plan cm), unit-tested. */
import type { ObbCollider } from './collision';
import type { Opening, Wall } from './schema';
import { wallFrame } from './walls';

export const DOOR_THICKNESS = 4;

export interface DoorFrame {
  /** Hinge axis on the plan (corner of the leaf on the swing-side face). */
  pivot: [number, number];
  /** Same pivot in the wall's local frame (x along a→b, y towards the right face). */
  pivotLocal: [number, number];
  /** Wall axis and right-hand normal on the plan. */
  u: [number, number];
  r: [number, number];
  /** Leaf runs from the pivot along local x * dirU; it swings towards local y * sideV. */
  dirU: 1 | -1;
  sideV: 1 | -1;
  width: number;
  thickness: number;
  /** Sign of the three.js rotation.y that opens the door. */
  sign: 1 | -1;
  /** Maximum opening angle, degrees. */
  maxAngle: number;
}

export function doorFrame(wall: Wall, opening: Opening): DoorFrame {
  const d = opening.door;
  if (!d) throw new Error(`Opening ${opening.id} has no door`);
  const { ux, uy } = wallFrame(wall);
  const u: [number, number] = [ux, uy];
  const r: [number, number] = [-uy, ux];
  const dirU = d.hinge === 'start' ? 1 : -1;
  const sideV = d.side === 'right' ? 1 : -1;
  const s = d.hinge === 'start' ? opening.from : opening.to;
  const across = (sideV * wall.thickness) / 2;
  return {
    pivot: [wall.a[0] + u[0] * s + r[0] * across, wall.a[1] + u[1] * s + r[1] * across],
    pivotLocal: [s, across],
    u, r, dirU, sideV,
    width: opening.to - opening.from,
    thickness: d.thickness ?? DOOR_THICKNESS,
    sign: (-sideV * dirU) as 1 | -1,
    maxAngle: d.angle ?? 90,
  };
}

/** Leaf footprint (oriented rectangle) for an opening ratio in [0, 1]. */
export function doorLeafRect(f: DoorFrame, openRatio: number): Omit<ObbCollider, 'kind' | 'owner'> {
  const t = ((f.sign * f.maxAngle * openRatio) * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  // Leaf centre in the pivot frame, rotated like three.js rotation.y on the plan.
  const x0 = (f.dirU * f.width) / 2, y0 = (-f.sideV * f.thickness) / 2;
  const lx = x0 * c + y0 * s, ly = -x0 * s + y0 * c;
  const ax = c, ay = -s; // leaf long axis in the wall frame
  return {
    cx: f.pivot[0] + f.u[0] * lx + f.r[0] * ly,
    cy: f.pivot[1] + f.u[1] * lx + f.r[1] * ly,
    ux: f.u[0] * ax + f.r[0] * ay,
    uy: f.u[1] * ax + f.r[1] * ay,
    hl: f.width / 2,
    ht: f.thickness / 2,
  };
}

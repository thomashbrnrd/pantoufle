/**
 * Part → three.js objects. Input in plan cm (X east, Y south, Z up), output in
 * three.js metres (x = X, y = Z, z = Y). UVs are generated in cm so that a
 * material's texture repeat is simply 1 / tile.
 */
import * as THREE from 'three';
import type {
  BeamPart, BoxPart, CurtainPart, CylinderPart, DiscPart, PolygonPart, PostsPart, PrismPart, SpherePart,
} from './schema';
import { boxMaterials, type MaterialSet } from './materials';

export const CM = 0.01;
export const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x * CM, z * CM, y * CM);

function finish<T extends THREE.Mesh | THREE.InstancedMesh>(mesh: T, shadow: boolean | undefined, name?: string): T {
  mesh.castShadow = shadow !== false;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  return mesh;
}

/** Box-mapped UVs in cm, from vertex positions and normals (geometry in metres). */
function boxUVs(g: THREE.BufferGeometry) {
  const pos = g.attributes.position!, nor = g.attributes.normal!, uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / CM, y = pos.getY(i) / CM, z = pos.getZ(i) / CM;
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    if (nx > 0.5) uv.setXY(i, z, y);
    else if (ny > 0.5) uv.setXY(i, x, z);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
}

export function boxMesh(p: Pick<BoxPart, 'min' | 'max' | 'material' | 'shadow' | 'name'>, mats: MaterialSet): THREE.Mesh {
  const [x0, y0, z0] = p.min, [x1, y1, z1] = p.max;
  const g = new THREE.BoxGeometry(Math.max(x1 - x0, 0.05) * CM, Math.max(z1 - z0, 0.05) * CM, Math.max(y1 - y0, 0.05) * CM);
  g.translate(((x0 + x1) / 2) * CM, ((z0 + z1) / 2) * CM, ((y0 + y1) / 2) * CM);
  boxUVs(g);
  return finish(new THREE.Mesh(g, boxMaterials(mats, p.material)), p.shadow, p.name);
}

function scaleUVs(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

export function cylinderMesh(p: CylinderPart, mats: MaterialSet): THREE.Mesh {
  const a = toThree(...p.from), b = toThree(...p.to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(p.radius * CM, p.radius * CM, len, p.segments ?? 24);
  scaleUVs(g, 2 * Math.PI * p.radius, len / CM);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return finish(m, p.shadow, p.name);
}

export function sphereMesh(p: SpherePart, mats: MaterialSet): THREE.Mesh {
  const seg = p.segments ?? 24;
  const g = new THREE.SphereGeometry(p.radius * CM, seg, Math.max(8, Math.round(seg / 2)));
  scaleUVs(g, 2 * Math.PI * p.radius, Math.PI * p.radius);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.position.copy(toThree(...p.center));
  if (p.scale) m.scale.set(p.scale[0], p.scale[2], p.scale[1]);
  return finish(m, p.shadow, p.name);
}

export function polygonMesh(p: PolygonPart, mats: MaterialSet): THREE.Mesh {
  const down = p.facing === 'down';
  // Shape in cm so ShapeGeometry UVs are in cm; then scaled to metres.
  const shape = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x, down ? y : -y)));
  const g = new THREE.ShapeGeometry(shape);
  g.scale(CM, CM, CM);
  g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, p.z * CM, 0);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.castShadow = false;
  m.receiveShadow = true;
  if (p.name) m.name = p.name;
  return m;
}

/** Plan polygon extruded vertically; UVs in cm (sides: run length × height). */
export function prismGeometry(points: readonly (readonly [number, number])[], z0: number, z1: number): THREE.BufferGeometry {
  // Shape (x, -y) extruded along +z, then turned so the extrusion goes up: plan Y → three z.
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, -y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(z1 - z0, 0.05), bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.scale(CM, CM, CM);
  g.translate(0, z0 * CM, 0);
  return g;
}

export function prismMesh(p: PrismPart, mats: MaterialSet): THREE.Mesh {
  return finish(new THREE.Mesh(prismGeometry(p.points, p.z[0], p.z[1]), mats.get(p.material)), p.shadow, p.name);
}

const FACING: Record<DiscPart['facing'], number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

export function discMesh(p: DiscPart, mats: MaterialSet): THREE.Mesh {
  const g = new THREE.CircleGeometry(p.radius * CM, p.segments ?? 32);
  scaleUVs(g, 2 * p.radius, 2 * p.radius);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.position.copy(toThree(...p.center));
  m.rotation.y = FACING[p.facing];
  return finish(m, false, p.name);
}

/** Rotation (three.js rotation.y) that maps local +x onto the plan direction (dx, dy). */
export const yawOf = (dx: number, dy: number) => -Math.atan2(dy, dx);

export function curtainMesh(p: CurtainPart, mats: MaterialSet): THREE.Mesh {
  const dx = p.to[0] - p.from[0], dy = p.to[1] - p.from[1];
  const wCm = Math.hypot(dx, dy), hCm = p.z[1] - p.z[0];
  const pleat = p.pleat ?? 14, depth = p.depth ?? 2.5;
  const seg = Math.max(8, Math.round(wCm / 2));
  const g = new THREE.PlaneGeometry(wCm * CM, hCm * CM, seg, 1);
  const pos = g.attributes.position!;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / CM;
    pos.setZ(i, Math.sin((x / pleat) * Math.PI * 2) * depth * CM);
  }
  g.computeVertexNormals();
  scaleUVs(g, wCm, hCm);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.position.copy(toThree((p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2, (p.z[0] + p.z[1]) / 2));
  m.rotation.y = yawOf(dx, dy);
  return finish(m, p.shadow, p.name);
}

export function postsMesh(p: PostsPart, mats: MaterialSet): THREE.InstancedMesh {
  const [sx, sy, h] = p.size;
  const g = new THREE.BoxGeometry(sx * CM, h * CM, sy * CM);
  const inst = new THREE.InstancedMesh(g, mats.get(p.material), p.points.length);
  const m4 = new THREE.Matrix4();
  p.points.forEach(([x, y], i) => {
    m4.makeTranslation(x * CM, (p.z + h / 2) * CM, y * CM);
    inst.setMatrixAt(i, m4);
  });
  return finish(inst, p.shadow, p.name);
}

export function beamMesh(p: BeamPart, mats: MaterialSet): THREE.Mesh {
  const dx = p.to[0] - p.from[0], dy = p.to[1] - p.from[1];
  const len = Math.hypot(dx, dy);
  const g = new THREE.BoxGeometry(len * CM, (p.z[1] - p.z[0]) * CM, p.width * CM);
  const m = new THREE.Mesh(g, mats.get(p.material));
  m.position.copy(toThree(p.from[0] + dx / 2, p.from[1] + dy / 2, (p.z[0] + p.z[1]) / 2));
  m.rotation.y = yawOf(dx, dy);
  return finish(m, p.shadow, p.name);
}

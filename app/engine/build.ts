/** Builds the three.js scene graph and 2D colliders from a Project. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Item, ModelPart, Opening, Part, Project, Rect, Wall } from './schema';
import { type MaterialSet } from './materials';
import {
  CM, beamMesh, boxMesh, curtainMesh, cylinderMesh, discMesh, polygonMesh, postsMesh, prismMesh, sphereMesh, toThree, yawOf,
} from './geometry';
import { trimBuriedEnds, wallFrame, wallPieces } from './walls';
import { obbFromRect, type Collider, type ObbCollider } from './collision';
import { doorFrame, doorLeafRect, type DoorFrame } from './doors';
import { bulbOutlet, deviceMesh, mergeByMaterial } from './devices';

export const OWNER_BUILDING = 'building';
export const OWNER_COMMON = 'common';
export const ownerOfVariant = (id: string) => `variant:${id}`;

export interface SceneLight { light: THREE.PointLight; intensity: number }

const DOOR_SECONDS = 0.8;

/** A hinged leaf the visitor can open and close (animated, with a moving collider). */
export class Door {
  /** 0 = closed, 1 = fully open. */
  ratio: number;
  private target: number;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly frame: DoorFrame,
    readonly pivot: THREE.Object3D,
    readonly collider: ObbCollider,
    open: boolean,
  ) {
    this.ratio = this.target = open ? 1 : 0;
    this.apply();
  }

  get isOpen() { return this.target > 0.5; }

  toggle() { this.target = this.isOpen ? 0 : 1; }

  /** Advances the animation; returns false once at rest. */
  step(dt: number): boolean {
    if (this.ratio === this.target) return false;
    const d = dt / DOOR_SECONDS;
    this.ratio = this.target > this.ratio ? Math.min(this.target, this.ratio + d) : Math.max(this.target, this.ratio - d);
    this.apply();
    return true;
  }

  private apply() {
    const r = this.ratio, eased = r * r * (3 - 2 * r);
    this.pivot.rotation.y = (this.frame.sign * this.frame.maxAngle * eased * Math.PI) / 180;
    Object.assign(this.collider, doorLeafRect(this.frame, eased));
  }
}

export interface BuiltScene {
  building: THREE.Group;
  ceiling: THREE.Group;
  furnishing: THREE.Group;
  variants: Map<string, THREE.Group>;
  colliders: Collider[];
  lights: SceneLight[];
  doors: Door[];
  /** Resolves when every glTF model is placed. */
  ready: Promise<void>;
}

interface Ctx {
  project: Project;
  mats: MaterialSet;
  assetUrl: (path: string) => string;
  colliders: Collider[];
  lights: SceneLight[];
  doors: Door[];
  pending: Promise<void>[];
  models: Map<string, Promise<THREE.Group>>;
  loader: GLTFLoader;
  /** Ceiling height of the level being built (cm), for pendant outlets. */
  ceilingZ: number;
}

export function buildScene(project: Project, mats: MaterialSet, assetUrl: (path: string) => string): BuiltScene {
  const ctx: Ctx = {
    project, mats, assetUrl, colliders: [], lights: [], doors: [], pending: [], models: new Map(), loader: new GLTFLoader(), ceilingZ: 250,
  };
  const building = new THREE.Group(); building.name = 'building';
  const ceiling = new THREE.Group(); ceiling.name = 'ceiling';
  const furnishing = new THREE.Group(); furnishing.name = 'furnishing';
  const variants = new Map<string, THREE.Group>();

  for (const level of project.building.levels) {
    const lv = new THREE.Group(); lv.name = level.id; lv.position.y = level.elevation * CM; building.add(lv);
    for (const w of trimBuriedEnds(level.walls)) lv.add(buildWall(ctx, w, level.height));
    for (const r of level.rooms) {
      lv.add(polygonMesh({ type: 'polygon', points: r.polygon, z: r.floor.z ?? 0, material: r.floor.material, name: r.id }, mats));
    }
    ctx.ceilingZ = level.height;
    for (const it of level.fixtures) lv.add(buildItem(ctx, it, OWNER_BUILDING));
    const ceilings = level.ceiling ? (Array.isArray(level.ceiling) ? level.ceiling : [level.ceiling]) : [];
    for (const cp of ceilings) {
      const c = polygonMesh({ type: 'polygon', points: cp.polygon, z: level.elevation + level.height, facing: 'down', material: cp.material }, mats);
      c.castShadow = true; // the slab above blocks the sun (hidden, hence no shadow, in overview)
      ceiling.add(c);
    }
  }
  for (const it of project.furnishing.common.items) furnishing.add(buildItem(ctx, it, OWNER_COMMON));
  for (const v of project.furnishing.variants) {
    const g = new THREE.Group(); g.name = ownerOfVariant(v.id);
    for (const it of v.items) g.add(buildItem(ctx, it, ownerOfVariant(v.id)));
    variants.set(v.id, g);
    furnishing.add(g);
  }
  return {
    building, ceiling, furnishing, variants, colliders: ctx.colliders, lights: ctx.lights, doors: ctx.doors,
    ready: Promise.all(ctx.pending).then(() => undefined),
  };
}

function buildWall(ctx: Ctx, w: Wall, levelHeight: number) {
  const { ux, uy, angle } = wallFrame(w);
  const g = new THREE.Group(); g.name = w.id;
  g.position.copy(toThree(w.a[0], w.a[1], 0));
  g.rotation.y = yawOf(Math.cos(angle), Math.sin(angle));
  const def = w.faces?.default ?? 'paint';
  const ht = w.thickness / 2;
  for (const p of wallPieces(w, levelHeight)) {
    // Local frame: axis = +x; walking along +x, left is north (-y) and right is south (+y).
    g.add(boxMesh({
      min: [p.s0, -ht, p.z0], max: [p.s1, ht, p.z1],
      material: { default: def, n: w.faces?.left ?? def, s: w.faces?.right ?? def },
    }, ctx.mats));
    if (p.collide) {
      const mid = (p.s0 + p.s1) / 2;
      ctx.colliders.push({
        kind: 'obb', cx: w.a[0] + ux * mid, cy: w.a[1] + uy * mid, ux, uy, hl: (p.s1 - p.s0) / 2, ht, owner: OWNER_BUILDING,
      });
    }
  }
  for (const o of w.openings ?? []) if (o.door) g.add(buildDoor(ctx, w, o));
  return g;
}

/** Door leaf in the wall's local frame, rotating around its hinge. */
function buildDoor(ctx: Ctx, w: Wall, o: Opening): THREE.Object3D {
  const d = o.door!;
  const f = doorFrame(w, o);
  const pivot = new THREE.Group();
  pivot.name = `door:${o.id}`;
  pivot.userData.doorId = o.id;
  pivot.position.copy(toThree(f.pivotLocal[0], f.pivotLocal[1], 0));
  // Pivot frame: leaf along x * dirU, thickness into the wall (opposite to the swing side).
  const xEnd = f.dirU * f.width, yIn = -f.sideV * f.thickness;
  const sorted = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
  const [x0, x1] = sorted(0, xEnd), [y0, y1] = sorted(0, yIn);
  // Faces follow the wall convention: `left`/`right` of a→b when the door is closed. In the pivot
  // frame local y points to the wall's right face (boxMesh: 'n' = -y side, 's' = +y side).
  const leafMat = d.faces ? { default: d.material, n: d.faces.left ?? d.material, s: d.faces.right ?? d.material } : d.material;
  pivot.add(boxMesh({ min: [x0, y0, o.z[0] + 0.5], max: [x1, y1, o.z[1] - 0.3], material: leafMat, name: 'leaf' }, ctx.mats));
  if (d.handle) {
    // Round-rose lever handle on both faces (EUXOS LOGINOX type): rose Ø 5.2, round lever Ø 1.9.
    const xs = f.dirU * (f.width - 6), xl = f.dirU * (f.width - 19), zh = 105;
    for (const [face, out] of [[y1, 1], [y0, -1]] as const) {
      const cyl = (from: [number, number, number], to: [number, number, number], radius: number) =>
        pivot.add(cylinderMesh({ type: 'cylinder', from, to, radius, segments: 16, material: d.handle!, name: 'handle' }, ctx.mats));
      cyl([xs, face, zh], [xs, face + out * 0.9, zh], 2.6); // rose
      cyl([xs, face, zh], [xs, face + out * 5.5, zh], 0.95); // stem
      cyl([xs, face + out * 5.5, zh], [xl, face + out * 5.5, zh], 0.95); // lever
    }
  }
  const collider: ObbCollider = { kind: 'obb', cx: 0, cy: 0, ux: 1, uy: 0, hl: 0, ht: 0, owner: OWNER_BUILDING };
  ctx.colliders.push(collider);
  ctx.doors.push(new Door(o.id, o.name ?? 'Porte', f, pivot, collider, d.open ?? true));
  return pivot;
}

/** Item-local plan point → plan point. Same convention as three.js rotation.y. */
function itemTransform(it: Item) {
  const [px, py] = it.position ?? [0, 0, 0];
  const t = ((it.rotation ?? 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return {
    point: (x: number, y: number): [number, number] => [px + x * c + y * s, py - x * s + y * c],
    axis: [c, -s] as [number, number],
  };
}

function rectCollider(it: Item, r: Rect, owner: string): Collider {
  if (!it.rotation && !it.position) return obbFromRect(r[0], r[1], r[2], r[3], owner);
  const tf = itemTransform(it);
  const [cx, cy] = tf.point((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
  return { kind: 'obb', cx, cy, ux: tf.axis[0], uy: tf.axis[1], hl: Math.abs(r[2] - r[0]) / 2, ht: Math.abs(r[3] - r[1]) / 2, owner };
}

function buildItem(ctx: Ctx, it: Item, owner: string): THREE.Group {
  const g = new THREE.Group();
  g.name = it.id;
  g.userData.item = it;
  if (it.position) g.position.copy(toThree(...it.position));
  if (it.rotation) g.rotation.y = (it.rotation * Math.PI) / 180;
  const parts: Part[] = [...(it.ref ? ctx.project.catalog[it.ref]?.parts ?? [] : []), ...(it.parts ?? [])];
  if (it.ref && !ctx.project.catalog[it.ref]) console.warn(`Unknown catalog entry "${it.ref}" in ${it.id}`);
  const tf = itemTransform(it);
  const devices = new THREE.Group(); // small wall devices, merged into a few meshes below
  for (const p of parts) {
    switch (p.type) {
      case 'box':
        g.add(boxMesh(p, ctx.mats));
        if (p.collide) ctx.colliders.push(rectCollider(it, [p.min[0], p.min[1], p.max[0], p.max[1]], owner));
        break;
      case 'cylinder':
        g.add(cylinderMesh(p, ctx.mats));
        if (p.collide) {
          const r = p.radius;
          ctx.colliders.push(rectCollider(it, [Math.min(p.from[0], p.to[0]) - r, Math.min(p.from[1], p.to[1]) - r, Math.max(p.from[0], p.to[0]) + r, Math.max(p.from[1], p.to[1]) + r], owner));
        }
        break;
      case 'sphere': g.add(sphereMesh(p, ctx.mats)); break;
      case 'polygon': g.add(polygonMesh(p, ctx.mats)); break;
      case 'prism': g.add(prismMesh(p, ctx.mats)); break;
      case 'device': devices.add(deviceMesh(p, ctx.mats)); break;
      case 'disc': g.add(discMesh(p, ctx.mats)); break;
      case 'curtain': g.add(curtainMesh(p, ctx.mats)); break;
      case 'posts': g.add(postsMesh(p, ctx.mats)); break;
      case 'beam': {
        g.add(beamMesh(p, ctx.mats));
        if (p.collide) {
          const [ax, ay] = tf.point(...p.from), [bx, by] = tf.point(...p.to);
          ctx.colliders.push({ kind: 'segment', ax, ay, bx, by, radius: p.width / 2 + 3, owner });
        }
        break;
      }
      case 'model': {
        const holder = new THREE.Group();
        holder.name = p.name ?? p.src;
        holder.userData.noLightmap = true; // loaded asynchronously: must not change the lightmap layout
        g.add(holder);
        ctx.pending.push(placeModel(ctx, p, holder));
        break;
      }
      case 'light': {
        const light = new THREE.PointLight(p.color, 0, p.distance * CM, 2);
        light.position.copy(toThree(...p.at));
        if (p.name) light.name = p.name;
        g.add(light);
        ctx.lights.push({ light, intensity: p.intensity });
        if (p.bulb) g.add(bulbOutlet(p.at, ctx.ceilingZ, ctx.mats));
        break;
      }
    }
  }
  for (const r of it.colliders ?? []) ctx.colliders.push(rectCollider(it, r, owner));
  if (devices.children.length) {
    const merged = mergeByMaterial(devices);
    merged.userData.noLightmap = true;
    g.add(merged);
  }
  return g;
}

function loadModel(ctx: Ctx, src: string): Promise<THREE.Group> {
  let p = ctx.models.get(src);
  if (!p) {
    p = ctx.loader.loadAsync(ctx.assetUrl(src)).then((gltf) => gltf.scene);
    ctx.models.set(src, p);
  }
  return p;
}

async function placeModel(ctx: Ctx, p: ModelPart, holder: THREE.Group) {
  let source: THREE.Group;
  try {
    source = await loadModel(ctx, p.src);
  } catch (e) {
    console.warn(`Model not loaded: ${p.src}`, e);
    return;
  }
  const obj = source.clone(true);
  obj.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = p.shadow !== false;
    o.receiveShadow = true;
    if (p.materials) {
      const names = `${(o.material as THREE.Material).name ?? ''} ${o.name}`;
      const rule = p.materials.find((r) => r.match === '*' || new RegExp(r.match, 'i').test(names));
      if (rule) o.material = ctx.mats.get(rule.material);
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const sx = p.fit.w ? (p.fit.w * CM) / size.x : undefined;
  const sz = p.fit.d ? (p.fit.d * CM) / size.z : undefined;
  const sy = p.fit.h ? (p.fit.h * CM) / size.y : undefined;
  if (p.uniform === false) obj.scale.set(sx ?? 1, sy ?? ((sx ?? 1) + (sz ?? 1)) / 2, sz ?? 1);
  else obj.scale.setScalar(sy ?? sx ?? sz ?? 1);
  if (p.anchor !== 'origin') {
    obj.updateMatrixWorld(true);
    box.setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.y -= box.min.y;
    obj.position.z -= c.z;
  }
  holder.add(obj);
}

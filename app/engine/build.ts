/** Builds the three.js scene graph and 2D colliders from a Project. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Item, ModelPart, Part, Project, Rect } from './schema';
import { type MaterialSet } from './materials';
import {
  CM, beamMesh, boxMesh, curtainMesh, cylinderMesh, discMesh, polygonMesh, postsMesh, sphereMesh, toThree, yawOf,
} from './geometry';
import { wallFrame, wallPieces } from './walls';
import { obbFromRect, type Collider } from './collision';

export const OWNER_BUILDING = 'building';
export const OWNER_COMMON = 'common';
export const ownerOfVariant = (id: string) => `variant:${id}`;

export interface SceneLight { light: THREE.PointLight; intensity: number }

export interface BuiltScene {
  building: THREE.Group;
  ceiling: THREE.Group;
  furnishing: THREE.Group;
  variants: Map<string, THREE.Group>;
  colliders: Collider[];
  lights: SceneLight[];
  /** Resolves when every glTF model is placed. */
  ready: Promise<void>;
}

interface Ctx {
  project: Project;
  mats: MaterialSet;
  assetUrl: (path: string) => string;
  colliders: Collider[];
  lights: SceneLight[];
  pending: Promise<void>[];
  models: Map<string, Promise<THREE.Group>>;
  loader: GLTFLoader;
}

export function buildScene(project: Project, mats: MaterialSet, assetUrl: (path: string) => string): BuiltScene {
  const ctx: Ctx = {
    project, mats, assetUrl, colliders: [], lights: [], pending: [], models: new Map(), loader: new GLTFLoader(),
  };
  const building = new THREE.Group(); building.name = 'building';
  const ceiling = new THREE.Group(); ceiling.name = 'ceiling';
  const furnishing = new THREE.Group(); furnishing.name = 'furnishing';
  const variants = new Map<string, THREE.Group>();

  for (const level of project.building.levels) {
    const lv = new THREE.Group(); lv.name = level.id; lv.position.y = level.elevation * CM; building.add(lv);
    for (const w of level.walls) lv.add(buildWall(ctx, w, level.height));
    for (const r of level.rooms) {
      lv.add(polygonMesh({ type: 'polygon', points: r.polygon, z: r.floor.z ?? 0, material: r.floor.material, name: r.id }, mats));
    }
    for (const it of level.fixtures) lv.add(buildItem(ctx, it, OWNER_BUILDING));
    if (level.ceiling) {
      const c = polygonMesh({ type: 'polygon', points: level.ceiling.polygon, z: level.elevation + level.height, facing: 'down', material: level.ceiling.material }, mats);
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
    building, ceiling, furnishing, variants, colliders: ctx.colliders, lights: ctx.lights,
    ready: Promise.all(ctx.pending).then(() => undefined),
  };
}

function buildWall(ctx: Ctx, w: Project['building']['levels'][number]['walls'][number], levelHeight: number) {
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
  return g;
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
        if (p.bulb) g.add(sphereMesh({ type: 'sphere', center: [p.at[0], p.at[1], p.at[2] + 4], radius: 3, segments: 12, material: 'bulb', shadow: false }, ctx.mats));
        break;
      }
    }
  }
  for (const r of it.colliders ?? []) ctx.colliders.push(rectCollider(it, r, owner));
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
  obj.updateMatrixWorld(true);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.y -= box.min.y;
  obj.position.z -= c.z;
  holder.add(obj);
}

/**
 * Detailed wall devices (sockets, switches, RJ45, intercom…) and ceiling light outlets, generated
 * from a few parameters. Dimensions follow the delivered products: Hager Essensya plates
 * (8 × 8 cm, 7.1 cm between modules), French 2P+T sockets, Urmet VOG5W video intercom, DCL
 * outlet with an A60 bulb. Built in centimetres in a local frame (x right, y up, z = out of the
 * wall), then scaled to metres.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DevicePart } from './schema';
import type { MaterialSet } from './materials';
import { CM, toThree } from './geometry';

const PLATE = 8, PITCH = 7.1, THICK = 1.1;
const FACING: Record<DevicePart['facing'], number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

type Mod = DevicePart['modules'][number];

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const box = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = false;
  o.receiveShadow = true;
  return o;
}

/** Darker variant of the plate material for the inside of socket wells (they shade themselves). */
const shades = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>();
function shadeOf(plate: THREE.Material): THREE.MeshStandardMaterial {
  let m = shades.get(plate);
  if (!m) {
    m = (plate as THREE.MeshStandardMaterial).clone();
    m.side = THREE.DoubleSide;
    m.color.multiplyScalar(0.82);
    shades.set(plate, m);
  }
  return m;
}

/** French 2P+T socket well, centred at (x, y), opening on the plate front. */
function socketWell(g: THREE.Group, x: number, y: number, plate: THREE.Material, dark: THREE.Material, metal: THREE.Material) {
  const r = 1.95, depth = 0.95;
  const wall = new THREE.CylinderGeometry(r, r, depth, 40, 1, true);
  wall.rotateX(Math.PI / 2);
  const shade = shadeOf(plate);
  g.add(mesh(wall, shade, x, y, THICK - depth / 2));
  g.add(mesh(new THREE.CircleGeometry(r, 40), shade, x, y, THICK - depth + 0.01));
  for (const dx of [-0.95, 0.95]) g.add(mesh(new THREE.CircleGeometry(0.24, 16), dark, x + dx, y, THICK - depth + 0.02));
  const pin = new THREE.CylinderGeometry(0.24, 0.24, 0.8, 16);
  pin.rotateX(Math.PI / 2);
  g.add(mesh(pin, metal, x, y + 1.15, THICK - depth + 0.4));
}

function module(g: THREE.Group, kind: Mod, x: number, y: number, mats: { plate: THREE.Material; dark: THREE.Material; metal: THREE.Material; glass: THREE.Material }) {
  const front = THICK;
  switch (kind) {
    case 'socket':
    case 'socket-outdoor':
      socketWell(g, x, y, mats.plate, mats.dark, mats.metal);
      if (kind === 'socket-outdoor') g.add(mesh(box(6.6, 6.6, 0.9, 0.5), mats.plate, x, y + 0.4, front + 0.6)); // hinged lid, closed
      break;
    case 'switch':
      g.add(mesh(box(5.4, 5.8, 0.7, 0.3), mats.plate, x, y, front + 0.25));
      break;
    case 'switch-double':
      for (const dx of [-1.38, 1.38]) g.add(mesh(box(2.6, 5.8, 0.7, 0.3), mats.plate, x + dx, y, front + 0.25));
      break;
    case 'shutter': // up / down push buttons with arrows
      for (const dy of [-1.45, 1.45]) {
        g.add(mesh(box(5.4, 2.8, 0.7, 0.3), mats.plate, x, y + dy, front + 0.25));
        const tri = new THREE.Shape([new THREE.Vector2(-0.35, -0.2 * Math.sign(dy)), new THREE.Vector2(0.35, -0.2 * Math.sign(dy)), new THREE.Vector2(0, 0.25 * Math.sign(dy))]);
        g.add(mesh(new THREE.ShapeGeometry(tri), mats.dark, x, y + dy, front + 0.61));
      }
      break;
    case 'rj45':
      g.add(mesh(box(2.6, 2.6, 0.5, 0.2), mats.plate, x, y, front + 0.1));
      g.add(mesh(new THREE.PlaneGeometry(1.25, 0.95), mats.dark, x, y - 0.2, front + 0.36));
      g.add(mesh(box(1.5, 0.35, 0.15, 0.05), mats.plate, x, y + 0.65, front + 0.38)); // dust flap
      break;
    case 'tv': {
      const ring = new THREE.CylinderGeometry(0.55, 0.55, 0.8, 24);
      ring.rotateX(Math.PI / 2);
      g.add(mesh(ring, mats.metal, x, y, front + 0.3));
      g.add(mesh(new THREE.CircleGeometry(0.3, 16), mats.dark, x, y, front + 0.71));
      break;
    }
    default:
      break; // blank
  }
}

/** Plate shape for n modules, with circular openings where sockets sit. */
function plateGeometry(mods: Mod[], vertical: boolean): THREE.BufferGeometry {
  const n = mods.length, long = PLATE + PITCH * (n - 1);
  const [w, h] = vertical ? [PLATE, long] : [long, PLATE];
  const shape = roundedRect(w, h, 0.9);
  mods.forEach((m, i) => {
    if (m !== 'socket' && m !== 'socket-outdoor') return;
    const off = (i - (n - 1) / 2) * PITCH;
    const hole = new THREE.Path();
    hole.absarc(vertical ? 0 : off, vertical ? -off : 0, 1.95, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  });
  const g = new THREE.ExtrudeGeometry(shape, { depth: THICK - 0.15, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.15, bevelSegments: 2, curveSegments: 24 });
  return g;
}

/** Wall DCL outlet with an E27 socket and a bare A60 bulb pointing out of the wall. */
function wallOutlet(g: THREE.Group, plate: THREE.Material, bulbMat: THREE.Material) {
  const base = new THREE.CylinderGeometry(2.9, 3.1, 1.3, 32);
  base.rotateX(Math.PI / 2);
  g.add(mesh(base, plate, 0, 0, 0.65));
  const sock = new THREE.CylinderGeometry(1.75, 1.6, 4.6, 24);
  sock.rotateX(Math.PI / 2);
  g.add(mesh(sock, plate, 0, 0, 1.3 + 2.3));
  const glass = new THREE.LatheGeometry(bulbProfile(), 32);
  glass.rotateX(-Math.PI / 2); // cap towards the wall, bulb pointing out
  g.add(mesh(glass, bulbMat, 0, 0, 1.3 + 4.6));
}

function intercom(g: THREE.Group, m: { plate: THREE.Material; dark: THREE.Material; glass: THREE.Material }) {
  g.add(mesh(box(10.2, 17, 2, 0.6), m.plate, 0, 0, 1));
  g.add(mesh(new THREE.PlaneGeometry(8.6, 5.6), m.glass, 0, 4.4, 2.01)); // 4.3" screen
  for (const dx of [-3, -1, 1, 3]) g.add(mesh(new THREE.CircleGeometry(0.35, 16), m.dark, dx, -1.4, 2.01)); // touch keys
  for (const dy of [-4.6, -5.3, -6]) g.add(mesh(new THREE.PlaneGeometry(4, 0.18), m.dark, 0, dy, 2.01)); // speaker
}

function thermostat(g: THREE.Group, m: { plate: THREE.Material; dark: THREE.Material; glass: THREE.Material }) {
  g.add(mesh(box(8.6, 8.6, 2.2, 0.9), m.plate, 0, 0, 1.1));
  g.add(mesh(new THREE.PlaneGeometry(3.8, 2.3), m.glass, 0, 1.1, 2.21));
  for (const dx of [-1.6, 1.6]) g.add(mesh(new THREE.CircleGeometry(0.45, 16), m.dark, dx, -2.2, 2.21));
}

export function deviceMesh(p: DevicePart, mats: MaterialSet): THREE.Group {
  const m = { plate: mats.get(p.material ?? 'white'), dark: mats.get('black'), metal: mats.get('chrome'), glass: mats.get('black-glass') };
  const g = new THREE.Group();
  const first = p.modules[0]!;
  if (first === 'dcl') wallOutlet(g, m.plate, mats.get('bulb'));
  else if (first === 'intercom') intercom(g, m);
  else if (first === 'thermostat') thermostat(g, m);
  else {
    const vertical = p.layout === 'v', n = p.modules.length;
    g.add(mesh(plateGeometry(p.modules, vertical), m.plate));
    p.modules.forEach((mod, i) => {
      const off = (i - (n - 1) / 2) * PITCH;
      module(g, mod, vertical ? 0 : off, vertical ? -off : 0, m);
    });
  }
  // Local cm → metres, front (+z) turned towards `facing`, placed on the wall.
  const root = new THREE.Group();
  g.scale.setScalar(CM);
  root.add(g);
  root.rotation.y = FACING[p.facing];
  root.position.copy(toThree(...p.at));
  if (p.name) root.name = p.name;
  return root;
}

/** A60 bulb profile (cm, y up from the cap), for LatheGeometry. */
function bulbProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(1.3, 0), new THREE.Vector2(1.35, 1.2), new THREE.Vector2(1.6, 2.4)];
  for (let i = 0; i <= 16; i++) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI * 1.08; // sphere of radius 3 centred 6.6 cm below the cap
    pts.push(new THREE.Vector2(Math.max(0.001, 3 * Math.cos(a)), 6.6 + 3 * Math.sin(-a)));
  }
  return pts.map((v) => new THREE.Vector2(v.x, -v.y));
}

/** Ceiling DCL outlet with a short cord, an E27 socket and an A60 bulb whose centre is at `at`. */
export function bulbOutlet(at: [number, number, number], ceiling: number, mats: MaterialSet): THREE.Group {
  const g = new THREE.Group();
  const white = mats.get('white');
  const top = ceiling - at[2]; // cm above the bulb centre
  const rose = new THREE.CylinderGeometry(3.2, 3.6, 1.4, 32);
  g.add(mesh(rose, white, 0, top - 0.7, 0));
  const cordLen = Math.max(1, top - 1.4 - 10);
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, cordLen, 8), white, 0, top - 1.4 - cordLen / 2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.75, 1.6, 4.6, 24), white, 0, 9.6 - 2.3 + 0.0 - 0.0, 0)); // E27 socket
  const glass = new THREE.LatheGeometry(bulbProfile(), 32);
  const bulb = mesh(glass, mats.get('bulb'), 0, 7.3, 0);
  bulb.castShadow = false;
  g.add(bulb);
  g.scale.setScalar(CM);
  const root = new THREE.Group();
  root.add(g);
  root.position.copy(toThree(...at));
  return root;
}

/**
 * Merges every mesh under `root` into one mesh per material (few draw calls for many small
 * parts). Transforms are baked relative to `root`, which keeps its own transform.
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()) as THREE.BufferGeometry;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const list = buckets.get(o.material as THREE.Material) ?? [];
    list.push(geo);
    buckets.set(o.material as THREE.Material, list);
  });
  const out = new THREE.Group();
  out.name = root.name;
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = false;
    m.receiveShadow = true;
    out.add(m);
  }
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  return out;
}

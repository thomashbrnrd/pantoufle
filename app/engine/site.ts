/**
 * Neighbourhood around the apartment, built from `meta.environment.surroundings`:
 * ground, streets and lawns, building volumes (with a storey/window pattern), trees and a
 * ring of generic blocks on the horizon. Plan cm in, three.js metres out.
 */
import * as THREE from 'three';
import type { Surroundings } from './schema';
import { CM, prismGeometry, toThree } from './geometry';

/** Storey height and window bay used by the façade pattern (cm). */
const STOREY = 290, BAY = 300;

export interface Site {
  /** Everything, added to the scene. */
  group: THREE.Group;
  /** Volumes hidden in the overview (floors above the apartment). */
  upper: THREE.Group;
  dispose(): void;
}

/** Canvas façade: one storey × one bay, floor level at the top row (see UV note below). */
function facadeTexture(): THREE.CanvasTexture {
  const W = 128, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  // Rows go downwards with height: canvas y = Z / STOREY × H (ExtrudeGeometry side v = 1 - depth).
  const y = (z: number) => (z / STOREY) * H, x = (cm: number) => (cm / BAY) * W;
  g.fillStyle = '#d9d4ca'; // slab edge
  g.fillRect(0, y(0), W, y(18));
  const grad = g.createLinearGradient(0, y(40), 0, y(240));
  grad.addColorStop(0, '#59646f');
  grad.addColorStop(1, '#3a434c');
  g.fillStyle = grad; // French window
  g.fillRect(x(70), y(30), x(160), y(210));
  g.fillStyle = '#c9c3b8'; // frame
  g.fillRect(x(148), y(30), x(4), y(210));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / BAY, 1 / STOREY);
  t.anisotropy = 4;
  return t;
}

/** Railing bars: one 12 cm bay (3 cm bar) with the handrail at the top, alpha-tested. */
function barsTexture(): THREE.CanvasTexture {
  const W = 32, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W * 0.25, H); // bar
  g.fillRect(0, 0, W, H * 0.06); // handrail (canvas top = top of the railing)
  g.fillRect(0, H * 0.9, W, H * 0.04); // bottom rail
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildSite(s: Surroundings, target: THREE.Vector3): Site {
  const group = new THREE.Group(); group.name = 'site';
  const upper = new THREE.Group(); upper.name = 'site-upper';
  group.add(upper);
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const gy = s.groundZ * CM;

  // Ground
  const groundMat = keep(new THREE.MeshStandardMaterial({ color: s.groundColor ?? '#9aa28f', roughness: 1 }));
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(1200, 1200)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(target.x, gy, target.z);
  ground.receiveShadow = true;
  group.add(ground);

  // Surfaces, stacked a few millimetres apart to avoid z-fighting.
  (s.surfaces ?? []).forEach((surf, i) => {
    const shape = new THREE.Shape(surf.polygon.map(([x, y]) => new THREE.Vector2(x * CM, -y * CM)));
    const geo = keep(new THREE.ShapeGeometry(shape));
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ color: surf.color, roughness: 0.95 })));
    m.position.y = gy + 0.005 * (i + 1);
    m.receiveShadow = true;
    if (surf.name) m.name = surf.name;
    group.add(m);
  });

  // Blocks
  const facade = keep(facadeTexture());
  const roof = keep(new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95 }));
  const mats = new Map<string, THREE.Material>();
  // Side UV v = -(Z - z0) (cm): shift the pattern so storeys line up with the apartment floor
  // (Z = 0, a multiple of STOREY above ground) whatever the block's base height.
  const material = (color: string, withFacade: boolean, z0: number) => {
    const shift = withFacade ? (((z0 % STOREY) + STOREY) % STOREY) / STOREY : 0;
    const key = `${color}|${withFacade}|${shift.toFixed(3)}`;
    if (!mats.has(key)) {
      let map: THREE.Texture | null = null;
      if (withFacade) {
        map = keep(facade.clone());
        map.offset.set(0, -shift);
        map.needsUpdate = true;
      }
      mats.set(key, keep(new THREE.MeshStandardMaterial({ color, roughness: 0.9, map })));
    }
    return mats.get(key)!;
  };
  const addBlock = (polygon: readonly (readonly [number, number])[], z: readonly [number, number], color: string, withFacade: boolean, hideInOverview: boolean, name?: string) => {
    const geo = keep(prismGeometry(polygon, z[0], z[1]));
    // ExtrudeGeometry groups: 0 = caps (roof), 1 = sides (façades).
    const m = new THREE.Mesh(geo, [roof, material(color, withFacade, z[0])]);
    m.castShadow = m.receiveShadow = true;
    if (name) m.name = name;
    (hideInOverview ? upper : group).add(m);
  };
  for (const b of s.blocks ?? []) {
    addBlock(b.polygon, b.z, b.color ?? '#e4ded2', b.facade ?? true, b.overview === false, b.name);
  }

  // Horizon: seeded generic blocks in a ring.
  if (s.distant) {
    const d = s.distant;
    let seed = d.seed;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < d.count; i++) {
      const ang = rnd() * Math.PI * 2, dist = d.minDistance + rnd() * (d.maxDistance - d.minDistance);
      const w = 1200 + rnd() * 2400, dp = 1000 + rnd() * 1800, h = 900 + rnd() * 2200;
      const cx = d.center[0] + Math.sin(ang) * dist, cy = d.center[1] + Math.cos(ang) * dist;
      const rot = rnd() * Math.PI;
      const corners: [number, number][] = [[-w / 2, -dp / 2], [w / 2, -dp / 2], [w / 2, dp / 2], [-w / 2, dp / 2]];
      const pts = corners.map(([x, y]) => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as [number, number]);
      addBlock(pts, [s.groundZ, s.groundZ + h], ['#e6e1d6', '#ddd6c8', '#e9e6e0', '#d6d0c4'][i % 4]!, true, false);
    }
  }

  // Railings: curb strips + one quad per segment (u in 12 cm bays, v over the height).
  if (s.railings?.length) {
    const bars = keep(barsTexture());
    const curbMat = keep(new THREE.MeshStandardMaterial({ color: '#efede7', roughness: 0.9 }));
    const railMats = new Map<string, THREE.Material>();
    for (const r of s.railings) {
      const curb = r.curb ?? 30, top = r.height ?? 106, color = r.color ?? '#b8873a';
      if (!railMats.has(color)) {
        railMats.set(color, keep(new THREE.MeshStandardMaterial({
          color, map: bars, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.45,
        })));
      }
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i + 1 < r.path.length; i++) {
        const [ax, ay] = r.path[i]!, [bx, by] = r.path[i + 1]!;
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 0.1) continue;
        // Curb: 12 cm wide strip centred on the path.
        const nx = (-(by - ay) / len) * 6, ny = ((bx - ax) / len) * 6;
        const strip = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]] as [number, number][];
        if (curb > 0) {
          const m = new THREE.Mesh(keep(prismGeometry(strip, r.z, r.z + curb)), curbMat);
          m.castShadow = m.receiveShadow = true;
          group.add(m);
        }
        const k = pos.length / 3;
        for (const [x, y, zz] of [[ax, ay, r.z + curb], [bx, by, r.z + curb], [bx, by, r.z + top], [ax, ay, r.z + top]] as const) {
          pos.push(...toThree(x, y, zz).toArray());
        }
        uv.push(0, 0, len / 12, 0, len / 12, 1, 0, 1);
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, railMats.get(color)!);
      m.castShadow = true;
      if (r.name) m.name = r.name;
      group.add(m);
    }
  }

  // Trees: trunk + two crowns, instanced.
  const spots: Array<{ x: number; y: number; h: number }> = [];
  for (const t of s.trees ?? []) spots.push({ x: t.at[0], y: t.at[1], h: t.height ?? 900 });
  for (const r of s.treeRows ?? []) {
    const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
    const n = Math.max(1, Math.floor(len / r.spacing));
    for (let i = 0; i <= n; i++) {
      const k = n ? i / n : 0;
      spots.push({ x: r.from[0] + (r.to[0] - r.from[0]) * k, y: r.from[1] + (r.to[1] - r.from[1]) * k, h: r.height ?? 900 });
    }
  }
  if (spots.length) {
    let seed = 7;
    const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const trunkGeo = keep(new THREE.CylinderGeometry(0.12, 0.18, 1, 7));
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = keep(new THREE.IcosahedronGeometry(1, 1));
    const trunks = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshStandardMaterial({ color: '#6b5a48', roughness: 1 })), spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true })), spots.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const greens = ['#6f8a57', '#7d9763', '#5f7b4b', '#86a06b'];
    spots.forEach((sp, i) => {
      const h = sp.h * CM * (0.85 + rnd() * 0.3);
      const base = toThree(sp.x, sp.y, s.groundZ);
      m4.compose(base, q, new THREE.Vector3(1, h * 0.45, 1));
      trunks.setMatrixAt(i, m4);
      for (let k = 0; k < 2; k++) {
        const r = h * (0.3 - k * 0.07);
        const p = base.clone().add(new THREE.Vector3((rnd() - 0.5) * r * 0.6, h * (0.58 + k * 0.2), (rnd() - 0.5) * r * 0.6));
        q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0));
        m4.compose(p, q, new THREE.Vector3(r, r * 0.85, r));
        crowns.setMatrixAt(i * 2 + k, m4);
        crowns.setColorAt(i * 2 + k, col.set(greens[(i + k) % greens.length]!));
      }
      q.identity();
    });
    trunks.castShadow = crowns.castShadow = true;
    group.add(trunks, crowns);
  }

  return {
    group, upper,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

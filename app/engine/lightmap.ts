/**
 * Lightmap UVs for the static building (walls, floors, ceilings, fixtures), generated
 * deterministically from the scene: the same project data always yields the same atlas, so a
 * lightmap baked offline (Blender / Cycles, scripts/bake) maps back without exchanging UVs.
 *
 * Every planar face group of a mesh becomes a rectangular chart (its bounding box in the face
 * plane, in world metres); charts are shelf-packed into one square atlas at a fixed density.
 * Curved or tiny meshes are left out (they keep real-time lighting only).
 */
import * as THREE from 'three';

export interface LightmapLayout {
  meshes: THREE.Mesh[];
  size: number; // atlas size in texels
  texelsPerMetre: number;
}

const PAD = 3; // texels around each chart (bake margin bleeds into it)

interface Chart { mesh: THREE.Mesh; verts: number[]; u: number[]; v: number[]; w: number; h: number; x?: number; y?: number }

/** Meshes that get a lightmap: static, opaque, built from planar faces. */
export function lightmapCandidates(roots: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh) return;
      let p: THREE.Object3D | null = o;
      for (; p; p = p.parent) if (p.userData.doorId !== undefined || p.userData.noLightmap) return; // doors, models, devices
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.transparent || (m as THREE.MeshStandardMaterial).opacity < 1)) return;
      const g = o.geometry as THREE.BufferGeometry;
      if (!g.attributes.normal || g.type === 'CylinderGeometry' || g.type === 'SphereGeometry' || g.type === 'LatheGeometry') return;
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new THREE.Vector3()).multiply(o.getWorldScale(new THREE.Vector3()));
      if (Math.max(s.x, s.y, s.z) < 0.05) return; // < 5 cm: devices, handles…
      out.push(o);
    });
  }
  return out;
}

/** Groups the triangles of a mesh by plane (normal + offset) and makes one chart per group. */
function chartsOf(mesh: THREE.Mesh, density: number): Chart[] {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.attributes.position!, nor = g.attributes.normal!;
  const index = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
  const m = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
  const wp = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m);
  const groups = new Map<string, Set<number>>();
  for (let t = 0; t < index.length; t += 3) {
    const tri = [index[t]!, index[t + 1]!, index[t + 2]!];
    const n = new THREE.Vector3().fromBufferAttribute(nor, tri[0]!).applyMatrix3(nm).normalize();
    const d = n.dot(wp(tri[0]!));
    const key = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)},${d.toFixed(2)}`;
    const set = groups.get(key) ?? new Set<number>();
    tri.forEach((i) => set.add(i));
    groups.set(key, set);
  }
  const charts: Chart[] = [];
  for (const [key, set] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [nx, ny, nz] = key.split(',').map(Number) as [number, number, number];
    const n = new THREE.Vector3(nx, ny, nz).normalize();
    const t1 = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const t2 = new THREE.Vector3().crossVectors(n, t1);
    const verts = [...set].sort((a, b) => a - b);
    const u = verts.map((i) => wp(i).dot(t1)), v = verts.map((i) => wp(i).dot(t2));
    const u0 = Math.min(...u), v0 = Math.min(...v);
    charts.push({
      mesh, verts,
      u: u.map((x) => (x - u0) * density), v: v.map((y) => (y - v0) * density),
      w: Math.ceil((Math.max(...u) - u0) * density) + 1, h: Math.ceil((Math.max(...v) - v0) * density) + 1,
    });
  }
  return charts;
}

/** Shelf packing (tallest first); returns false when the atlas is too small. */
function pack(charts: Chart[], size: number): boolean {
  let x = PAD, y = PAD, shelf = 0;
  for (const c of [...charts].sort((a, b) => b.h - a.h || b.w - a.w)) {
    if (c.w + 2 * PAD > size || c.h + 2 * PAD > size) return false;
    if (x + c.w + PAD > size) { x = PAD; y += shelf + PAD; shelf = 0; }
    if (y + c.h + PAD > size) return false;
    c.x = x; c.y = y;
    x += c.w + PAD; shelf = Math.max(shelf, c.h);
  }
  return true;
}

/**
 * Writes a `uv1` attribute (lightmap UVs) on every candidate mesh. Density is lowered until the
 * charts fit in a `size` × `size` atlas.
 */
export function layoutLightmap(meshes: THREE.Mesh[], size = 2048, texelsPerMetre = 100): LightmapLayout {
  let density = texelsPerMetre, charts: Chart[] = [];
  for (;;) {
    charts = meshes.flatMap((m) => chartsOf(m, density));
    if (pack(charts, size)) break;
    density *= 0.9;
    if (density < 5) throw new Error('lightmap: atlas trop petit');
  }
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  }
  for (const c of charts) {
    const uv1 = (c.mesh.geometry as THREE.BufferGeometry).attributes.uv1 as THREE.BufferAttribute;
    c.verts.forEach((i, k) => uv1.setXY(i, (c.x! + c.u[k]!) / size, (c.y! + c.v[k]!) / size));
  }
  return { meshes, size, texelsPerMetre: density };
}

import * as THREE from 'three';
import type { FaceMaterials, MaterialLibrary } from './schema';
import { proceduralTexture } from './textures';

export interface MaterialSet {
  get(id: string): THREE.MeshStandardMaterial;
  /** Materials with an evening glow, with their night settings. */
  glowing: Array<{ material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }>;
  dispose(): void;
}

export function createMaterials(lib: MaterialLibrary, anisotropy: number, assetUrl: (path: string) => string): MaterialSet {
  const built = new Map<string, THREE.MeshStandardMaterial>();
  const glowing: MaterialSet['glowing'] = [];
  const loader = new THREE.ImageLoader();

  /** Image texture repeating every `tile` cm; the image arrives asynchronously. */
  const image = (path: string, srgb: boolean, tile: [number, number], rotationDeg = 0) => {
    const t = new THREE.Texture();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.repeat.set(1 / tile[0], 1 / tile[1]);
    t.rotation = (rotationDeg * Math.PI) / 180;
    loader.load(assetUrl(path), (img) => { t.image = img; t.needsUpdate = true; }, undefined,
      () => console.warn(`Texture not loaded: ${path}`));
    return t;
  };

  for (const [id, def] of Object.entries(lib)) {
    const maps = def.maps;
    const m = new THREE.MeshStandardMaterial({
      name: id,
      color: def.color ?? '#FFFFFF',
      roughness: def.roughness ?? (maps?.arm ? 1 : 0.8),
      metalness: def.metalness ?? 0,
    });
    if (def.colorScale) m.color.multiplyScalar(def.colorScale);
    if (def.texture) m.map = proceduralTexture(def.texture.procedural, def.texture.tile, anisotropy);
    if (maps) {
      if (maps.color) m.map = image(maps.color, true, maps.tile, maps.rotation);
      if (maps.normal) {
        m.normalMap = image(maps.normal, false, maps.tile, maps.rotation);
        const k = maps.normalScale ?? 1;
        m.normalScale.set(k, k);
      }
      if (maps.arm) {
        const arm = image(maps.arm, false, maps.tile, maps.rotation);
        m.roughnessMap = arm; // green channel
        m.aoMap = arm; // red channel
        m.aoMapIntensity = maps.aoIntensity ?? 1;
      }
    }
    if (def.opacity !== undefined && def.opacity < 1) {
      m.transparent = true;
      m.opacity = def.opacity;
      if (def.opacity < 0.5) m.depthWrite = false;
    }
    if (def.doubleSided) m.side = THREE.DoubleSide;
    if (def.night) glowing.push({ material: m, emissive: new THREE.Color(def.night.emissive), intensity: def.night.intensity });
    built.set(id, m);
  }
  return {
    get(id) {
      const m = built.get(id);
      if (!m) throw new Error(`Unknown material "${id}"`);
      return m;
    },
    glowing,
    dispose() {
      for (const m of built.values()) {
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.aoMap]) t?.dispose();
        m.dispose();
      }
    },
  };
}

/** BoxGeometry group order: +x (east), -x (west), +y (top), -y (bottom), +z (south), -z (north). */
export function boxMaterials(set: MaterialSet, ref: string | FaceMaterials): THREE.Material | THREE.Material[] {
  if (typeof ref === 'string') return set.get(ref);
  const pick = (k: keyof FaceMaterials) => set.get(ref[k] ?? ref.default);
  return [pick('e'), pick('w'), pick('top'), pick('bottom'), pick('s'), pick('n')];
}

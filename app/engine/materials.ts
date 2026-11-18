import * as THREE from 'three';
import type { FaceMaterials, MaterialLibrary } from './schema';
import { proceduralTexture } from './textures';

export interface MaterialSet {
  get(id: string): THREE.MeshStandardMaterial;
  /** Materials with an evening glow, with their night settings. */
  glowing: Array<{ material: THREE.MeshStandardMaterial; emissive: THREE.Color; intensity: number }>;
  dispose(): void;
}

export function createMaterials(lib: MaterialLibrary, anisotropy: number): MaterialSet {
  const built = new Map<string, THREE.MeshStandardMaterial>();
  const glowing: MaterialSet['glowing'] = [];
  for (const [id, def] of Object.entries(lib)) {
    const m = new THREE.MeshStandardMaterial({
      name: id,
      color: def.color ?? '#FFFFFF',
      roughness: def.roughness ?? 0.8,
      metalness: def.metalness ?? 0,
    });
    if (def.texture) m.map = proceduralTexture(def.texture.procedural, def.texture.tile, anisotropy);
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
      for (const m of built.values()) { m.map?.dispose(); m.dispose(); }
    },
  };
}

/** BoxGeometry group order: +x (east), -x (west), +y (top), -y (bottom), +z (south), -z (north). */
export function boxMaterials(set: MaterialSet, ref: string | FaceMaterials): THREE.Material | THREE.Material[] {
  if (typeof ref === 'string') return set.get(ref);
  const pick = (k: keyof FaceMaterials) => set.get(ref[k] ?? ref.default);
  return [pick('e'), pick('w'), pick('top'), pick('bottom'), pick('s'), pick('n')];
}

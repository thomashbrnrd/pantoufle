/** Validates every project listed in public/projects/index.json. Usage: npm run validate */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadProject } from '../app/engine/load';
import { ProjectIndex } from '../app/engine/schema';
import { collectFaces, findZFights } from '../app/engine/zfight';

const root = join(import.meta.dirname, '..', 'public', 'projects');
const index = ProjectIndex.parse(JSON.parse(await readFile(join(root, 'index.json'), 'utf8')));
let failed = false;
for (const entry of index) {
  const dir = join(root, entry.id);
  try {
    const p = await loadProject(async (f) => JSON.parse(await readFile(join(dir, f), 'utf8')));
    if (p.meta.id !== entry.id) throw new Error(`project.json id "${p.meta.id}" ≠ dossier "${entry.id}"`);
    const env = p.meta.environment;
    const assets = [env.hdri, env.background.day.src, env.background.night.src];
    if (env.background.overcast) assets.push(env.background.overcast.src);
    for (const m of Object.values(env.lightmap?.moods ?? {})) if (m) assets.push(m.src);
    for (const m of Object.values(p.materials)) for (const f of [m.maps?.color, m.maps?.normal, m.maps?.arm]) if (f) assets.push(f);
    const allItems = [
      ...p.building.levels.flatMap((l) => l.fixtures),
      ...p.furnishing.common.items,
      ...p.furnishing.variants.flatMap((v) => v.items),
    ];
    for (const it of allItems) for (const part of it.parts ?? []) if (part.type === 'model') assets.push(part.src);
    for (const a of new Set(assets)) {
      await access(join(dir, a)).catch(() => { throw new Error(`asset manquant : ${a}`); });
    }
    const walls = p.building.levels.reduce((s, l) => s + l.walls.length, 0);
    // Coplanar overlapping faces flicker (z-fighting). Wall/wall overlaps (same paint on top) are harmless.
    const fights = findZFights(collectFaces(p)).filter((z) => !(z.a.startsWith('mur ') && z.b.startsWith('mur ')));
    for (const z of fights) console.warn(`  ⚠ faces superposées (${z.area} cm², ${z.plane}, ${z.mats}) : ${z.a} × ${z.b}`);
    if (fights.length) throw new Error(`${fights.length} superposition(s) de faces (z-fighting) : décaler l’une des faces de quelques mm`);
    console.log(`✓ ${entry.id} — ${allItems.length} items, ${walls} murs${fights.length ? `, ${fights.length} superpositions de faces` : ''}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${entry.id}\n${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);

/** Validates every project listed in public/projects/index.json. Usage: npm run validate */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadProject } from '../app/engine/load';
import { ProjectIndex } from '../app/engine/schema';

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
    console.log(`✓ ${entry.id} — ${allItems.length} items, ${walls} murs`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${entry.id}\n${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);

/**
 * Imports a Poly Haven asset (CC0) into a project, once, at development time.
 * Files are committed with the project; nothing is fetched from Poly Haven at runtime.
 *
 *   npm run polyhaven -- <project> texture <id> [res=1k] [maps=diff,nor_gl,arm]
 *   npm run polyhaven -- <project> model   <id> [res=1k]
 *   npm run polyhaven -- <project> hdri    <id> [res=1k]       (lighting, .hdr)
 *   npm run polyhaven -- <project> sky     <id> [width=4096]   (background, tonemapped JPG; resized with macOS `sips`)
 *
 * Output goes to public/projects/<project>/{textures,models,env}/ and the asset is recorded in
 * public/projects/<project>/sources.json (id, author, licence, files).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const API = 'https://api.polyhaven.com';
const UA = 'pantoufle-asset-import/0.1';
const MAP_KEYS: Record<string, string> = { diff: 'Diffuse', nor_gl: 'nor_gl', arm: 'arm', rough: 'Rough', ao: 'AO' };

type FileRef = { url: string; size: number; md5: string; include?: Record<string, FileRef> };

const [project, kind, id, arg1, arg2] = process.argv.slice(2);
if (!project || !kind || !id) {
  console.error('Usage: npm run polyhaven -- <project> texture|model|hdri|sky <id> [options]');
  process.exit(1);
}
const root = join(import.meta.dirname, '..', 'public', 'projects', project);

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function download(f: FileRef, dest: string): Promise<string> {
  const r = await fetch(f.url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${f.url}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const md5 = createHash('md5').update(buf).digest('hex');
  if (f.md5 && md5 !== f.md5) throw new Error(`${f.url}: md5 mismatch`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`  ${relative(root, dest)}  ${(buf.length / 1024).toFixed(0)} kB`);
  return relative(root, dest);
}

const info = await json<{ name: string; authors: Record<string, string> }>(`${API}/info/${id}`);
const files = await json<Record<string, Record<string, Record<string, FileRef>>>>(`${API}/files/${id}`);
const written: string[] = [];
console.log(`${info.name} (${id})`);

if (kind === 'texture') {
  const res = arg1 ?? '1k';
  const maps = (arg2 ?? 'diff,nor_gl,arm').split(',');
  for (const m of maps) {
    const f = files[MAP_KEYS[m] ?? m]?.[res]?.jpg;
    if (!f) throw new Error(`No ${m} map at ${res}`);
    written.push(await download(f, join(root, 'textures', id, `${id}_${m}_${res}.jpg`)));
  }
} else if (kind === 'model') {
  const res = arg1 ?? '1k';
  const g = files.gltf?.[res]?.gltf;
  if (!g) throw new Error(`No glTF at ${res}`);
  const dir = join(root, 'models', id);
  written.push(await download(g, join(dir, `${id}_${res}.gltf`)));
  for (const [path, f] of Object.entries(g.include ?? {})) written.push(await download(f, join(dir, path)));
} else if (kind === 'hdri') {
  const res = arg1 ?? '1k';
  const f = files.hdri?.[res]?.hdr;
  if (!f) throw new Error(`No HDR at ${res}`);
  written.push(await download(f, join(root, 'env', `${id}_${res}.hdr`)));
} else if (kind === 'sky') {
  const width = arg1 ?? '4096';
  const f = (files as unknown as { tonemapped?: FileRef }).tonemapped;
  if (!f) throw new Error('No tonemapped JPG');
  const dest = join(root, 'env', `${id}.jpg`);
  await download(f, dest);
  execFileSync('sips', ['-Z', width, '-s', 'formatOptions', '82', dest], { stdio: 'ignore' });
  console.log(`  resized to ${width} px wide`);
  written.push(relative(root, dest));
} else {
  throw new Error(`Unknown kind "${kind}"`);
}

// Record provenance (CC0, but we keep author credit and the source link).
const sourcesPath = join(root, 'sources.json');
type Source = { id: string; name: string; kind: string; url: string; license: string; authors: string[]; files: string[] };
let sources: Source[] = [];
try { sources = JSON.parse(await readFile(sourcesPath, 'utf8')); } catch { /* first import */ }
sources = sources.filter((s) => !(s.id === id && s.kind === kind));
sources.push({
  id, name: info.name, kind, url: `https://polyhaven.com/a/${id}`, license: 'CC0', authors: Object.keys(info.authors ?? {}), files: written,
});
sources.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`);

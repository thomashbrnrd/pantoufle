/**
 * Exports the static building for the offline light bake (Blender / Cycles).
 * Usage: npm run bake:export -- [baseUrl] [project]   (needs `npm run dev`)
 * Writes bake/<project>/scene.glb (lightmapped meshes LM_<i> with uv1, occluders OCC_<i>) and
 * bake/<project>/bake.json (atlas layout, mesh count, orientation). Then run scripts/bake.py in
 * Blender, and copy the resulting lightmaps into public/projects/<project>/lightmaps/.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const project = process.argv[3] ?? 'arboreal-143';
const out = join(import.meta.dirname, '..', 'bake', project);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(`${baseUrl}/visit/${project}?ao=0`, { waitUntil: 'networkidle' });
await page.waitForFunction('!!window.__viewer', null, { timeout: 60_000 });
await page.waitForTimeout(3000);
const res = await page.evaluate(`(async () => {
  const v = window.__viewer;
  const buf = new Uint8Array(await v.exportBakeScene());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const layout = v.lightmap;
  const env = v.project.meta.environment;
  return { glb: btoa(bin), size: layout.size, density: layout.texelsPerMetre, meshes: layout.meshes.length, north: env.north, sun: env.sun };
})()`) as { glb: string; size: number; density: number; meshes: number; north: number; sun: unknown };
await browser.close();
await writeFile(join(out, 'scene.glb'), Buffer.from(res.glb, 'base64'));
const { glb: _, ...manifest } = res;
await writeFile(join(out, 'bake.json'), JSON.stringify(manifest, null, 2));
console.log(`✓ ${join(out, 'scene.glb')} — ${res.meshes} surfaces, atlas ${res.size}² à ${res.density.toFixed(1)} texels/m`);

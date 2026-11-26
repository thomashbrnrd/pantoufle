/**
 * Side-by-side comparison of reference photos / video frames with the 3D model.
 * Usage: npm run compare -- [viewpoints.json] [outDir] [baseUrl]
 *   viewpoints.json defaults to images/compare.json (private folder, not versioned):
 *   [{ "name": "sejour", "ref": "IMG.jpg" | { "video": "VID.mp4", "t": 76 },
 *      "at": [x, y, yawDeg, pitchDeg], "fov": 70, "state": { "furnished": false },
 *      "doors": { "porte-paliere": true } }]
 *   Paths in `ref` are relative to the JSON file. `fov` = vertical field of view in degrees
 *   (phone ultra-wide, 13 mm eq., 16:9 portrait ≈ 111°), `eye` = camera height in cm.
 * Output: outDir/<name>.jpg (reference left, model right, same height). Needs ffmpeg + `npm run dev`.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

interface Viewpoint {
  name: string;
  ref: string | { video: string; t: number };
  at: [number, number, number, number?];
  fov?: number;
  /** Camera height in cm (phones are held lower than the eyes). */
  eye?: number;
  state?: Record<string, unknown>;
  doors?: Record<string, boolean>;
}

const file = resolve(process.argv[2] ?? 'images/compare.json');
const outDir = resolve(process.argv[3] ?? 'shots/compare');
const baseUrl = process.argv[4] ?? 'http://localhost:3000';
const only = process.env.ONLY?.split(',');
const H = 960;

const views = (JSON.parse(await readFile(file, 'utf8')) as Viewpoint[]).filter((v) => !only || only.includes(v.name));
await mkdir(outDir, { recursive: true });

const ff = (...args: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const probeSize = (img: string) => {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', img]).toString();
  const [w, h] = out.trim().split(',').map(Number);
  return { w: w!, h: h! };
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const v of views) {
  // Reference → PNG of height H (ffmpeg applies the EXIF / rotation metadata).
  const refPng = join(outDir, `${v.name}.ref.png`);
  if (typeof v.ref === 'string') ff('-i', join(dirname(file), v.ref), '-vf', `scale=-2:${H}`, refPng);
  else ff('-ss', String(v.ref.t), '-i', join(dirname(file), v.ref.video), '-frames:v', '1', '-vf', `scale=-2:${H}`, refPng);
  const { w } = probeSize(refPng);

  const page = await browser.newPage({ viewport: { width: w, height: H } });
  await page.goto(`${baseUrl}/visit/arboreal-143`, { waitUntil: 'networkidle' });
  await page.waitForFunction('!!window.__viewer', null, { timeout: 60_000 });
  await page.waitForTimeout(3000); // models, HDRI, skies
  await page.addStyleTag({ content: '.hud,.toast,.cross,.door-hint,.pad,.paused,.intro,.sticks{display:none!important}' });
  await page.evaluate(`(() => {
    const viewer = window.__viewer, v = ${JSON.stringify(v)};
    viewer.start('visit');
    viewer.setState({ furnished: false, mood: 'overcast', ...(v.state ?? {}) });
    for (const d of viewer.doors) {
      const want = (v.doors ?? {})[d.id];
      if (want !== undefined && d.isOpen !== want) viewer.toggleDoor(d.id);
    }
    if (v.eye) viewer.project.meta.eyeHeight = v.eye;
    viewer.teleport(...v.at);
    viewer.camera.fov = v.fov ?? 70;
    viewer.camera.updateProjectionMatrix();
  })()`);
  // Door animations run at the (slow) software-GL frame rate: wait until they rest.
  await page.waitForFunction('window.__viewer.doors.every((d) => d.ratio === (d.isOpen ? 1 : 0))', null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  const simPng = join(outDir, `${v.name}.sim.png`);
  await page.screenshot({ path: simPng });
  await page.close();

  ff('-i', refPng, '-i', simPng, '-filter_complex', `[1]scale=-2:${H}[s];[0][s]hstack=inputs=2`, '-q:v', '3', join(outDir, `${v.name}.jpg`));
  console.log(`✓ ${join(outDir, `${v.name}.jpg`)}`);
}
await browser.close();

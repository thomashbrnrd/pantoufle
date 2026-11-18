/**
 * Renders reference views of a project with headless Chromium (software WebGL).
 * Usage: npm run shots -- [baseUrl] [outDir]
 *   baseUrl defaults to http://localhost:3000 (run `npm run dev` first)
 *   outDir defaults to shots/ (git-ignored)
 * Requires a Chromium for playwright-core: `npx playwright-core install chromium`.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const outDir = process.argv[3] ?? 'shots';
const project = process.env.PROJECT ?? 'arboreal-143';

type View = { name: string; state: Record<string, unknown> } & (
  | { at: [number, number, number, number?] }
  | { orbit: [number, number, number] }
);
const views: View[] = [
  { name: 'overview-day', state: { mode: 'overview', mood: 'day' }, orbit: [-34.4, 54.4, 1250] },
  { name: 'overview-top', state: { mode: 'overview', mood: 'day' }, orbit: [0, 9, 1300] },
  { name: 'overview-night', state: { mode: 'overview', mood: 'night' }, orbit: [-34.4, 54.4, 1250] },
  { name: 'entrance', state: { mode: 'visit', mood: 'day' }, at: [278, 60, 180, -5] },
  { name: 'kitchen-bar', state: { mode: 'visit', mood: 'day', variant: 'bar' }, at: [380, 420, -35, -8] },
  { name: 'kitchen-table', state: { mode: 'visit', mood: 'day', variant: 'table-ronde' }, at: [380, 420, -35, -8] },
  { name: 'living-south', state: { mode: 'visit', mood: 'day' }, at: [600, 250, 155, -5] },
  { name: 'living-night', state: { mode: 'visit', mood: 'night' }, at: [600, 250, 155, -5] },
  { name: 'bedroom', state: { mode: 'visit', mood: 'day' }, at: [260, 620, 30, -5] },
  { name: 'bathroom', state: { mode: 'visit', mood: 'day' }, at: [150, 250, 0, -10] },
  { name: 'terrace', state: { mode: 'visit', mood: 'day' }, at: [600, 760, 120, -2] },
  { name: 'empty', state: { mode: 'visit', mood: 'day', furnished: false }, at: [600, 250, 155, -5] },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${baseUrl}/visit/${project}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!(window as any).__viewer, null, { timeout: 60_000 });
await page.waitForTimeout(4000); // models, HDRI, skies
await page.evaluate(() => {
  document.querySelector<HTMLElement>('.intro')?.remove();
  (window as any).__viewer.start('overview');
});
await mkdir(outDir, { recursive: true });
for (const v of views) {
  await page.evaluate((v) => {
    const viewer = (window as any).__viewer;
    viewer.setState({ furnished: true, mood: 'day', variant: 'bar', ...v.state });
    if ('at' in v) viewer.teleport(...v.at);
    else viewer.setOrbit(...v.orbit);
  }, v);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  console.log(`✓ ${outDir}/${v.name}.png`);
}
await browser.close();

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

type View = {
  name: string;
  state: Record<string, unknown>;
  /** Force every door open (true) or closed (false) before the shot. Default: all open. */
  doorsOpen?: boolean;
  /** Keys pressed after positioning (e.g. 'KeyE' to operate the door under the crosshair). */
  keys?: string[];
} & (
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
  { name: 'sky-sun', state: { mode: 'visit', mood: 'day' }, at: [500, 760, 168.7, 40] },
  // Same viewpoints as the delivery photos (empty apartment), for side-by-side checks.
  { name: 'photo-sejour', state: { mode: 'visit', furnished: false }, at: [480, 215, 180, -12] },
  { name: 'photo-cuisine', state: { mode: 'visit', furnished: false }, at: [535, 330, 0, -10] },
  { name: 'photo-chambre', state: { mode: 'visit', furnished: false }, at: [235, 335, 185, -12] },
  { name: 'photo-sde-vasque', state: { mode: 'visit', furnished: false }, at: [190, 205, 175, -15] },
  { name: 'photo-sde-douche', state: { mode: 'visit', furnished: false }, at: [125, 250, 0, -10] },
  { name: 'photo-terrasse', state: { mode: 'visit', furnished: false }, at: [640, 750, 95, -15] },
  { name: 'door-landing-open', state: { mode: 'visit' }, at: [270, 170, 0, -5] },
  { name: 'door-landing-closed', state: { mode: 'visit' }, at: [270, 170, 0, -5], doorsOpen: false },
  { name: 'door-bath-closed', state: { mode: 'visit' }, at: [300, 175, 90, -5], doorsOpen: false },
  { name: 'door-bedroom-key-e', state: { mode: 'visit' }, at: [270, 200, 180, -8], keys: ['KeyE'] },
  { name: 'doors-closed-top', state: { mode: 'overview' }, orbit: [0, 9, 1300], doorsOpen: false },
  { name: 'landing-door-inside', state: { mode: 'visit' }, at: [270, 150, 0, -5], doorsOpen: false },
  { name: 'landing-corridor', state: { mode: 'visit' }, at: [-200, -100, -90, -5] },
  { name: 'landing-from-door', state: { mode: 'visit' }, at: [270, 40, 0, -5] },
  { name: 'terrace-corner', state: { mode: 'overview' }, orbit: [-150, 60, 700] },
  { name: 'terrace-view-south', state: { mode: 'visit' }, at: [450, 780, 180, -8] },
  { name: 'overview-site', state: { mode: 'overview' }, orbit: [-34.4, 54.4, 2800] },
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
    const open = v.doorsOpen ?? true;
    for (const d of viewer.doors) if (d.isOpen !== open) viewer.toggleDoor(d.id);
  }, v);
  await page.waitForTimeout(1200); // door animation is 0.8 s
  for (const k of v.keys ?? []) {
    await page.keyboard.press(k);
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${outDir}/${v.name}.png` });
  const doors = await page.evaluate(() => (window as any).__viewer.doors.map((d: any) => `${d.id}:${d.isOpen ? 'ouverte' : 'fermée'}`).join(' '));
  console.log(`✓ ${outDir}/${v.name}.png  [${doors}]`);
}
await browser.close();

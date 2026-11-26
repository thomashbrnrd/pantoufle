/**
 * Procedural canvas textures, ported from the prototype.
 * Each texture covers the tile size given in materials.json (UVs are in cm).
 */
import * as THREE from 'three';
import type { Material } from './schema';

type ProceduralName = NonNullable<Material['texture']>['procedural'];
type Draw = (g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const rgb = (r: number, g: number, b: number, a?: number) =>
  a === undefined ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;

function speckle(
  g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number,
  n: number, col: (a: number) => string, amin: number, amax: number, smax: number,
) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = col(amin + rnd() * (amax - amin));
    const s = 1 + rnd() * smax;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
}

function wavyLines(g: CanvasRenderingContext2D, w: number, h: number, step: number, period: number, amp: number,
  light: [string, number], dark: [string, number, number]) {
  for (let y = 0; y < h; y += step) {
    for (const [style, width, dy] of [[light[0], light[1], 0], [dark[0], dark[1], dark[2]]] as const) {
      g.strokeStyle = style; g.lineWidth = width; g.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const yy = y + dy + Math.sin((x / w) * Math.PI * period) * amp;
        if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
      }
      g.stroke();
    }
  }
}

function tiles(px: number, nx: number, ny: number, base: [number, number, number], joint: string, varr: number, spk: number): [number, number, Draw] {
  return [px * nx, px * ny, (g, w, h, rnd) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const t = rnd() * varr * 2 - varr;
      g.fillStyle = rgb(base[0] + t, base[1] + t, base[2] + t); g.fillRect(i * px, j * px, px, px);
      for (let k = 0; k < 5; k++) {
        const r = px * (0.2 + rnd() * 0.4);
        const gr = g.createRadialGradient(i * px + rnd() * px, j * px + rnd() * px, 0, i * px + rnd() * px, j * px + rnd() * px, r);
        gr.addColorStop(0, rgb(base[0] - varr, base[1] - varr, base[2] - varr, 0.18)); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(i * px, j * px, px, px);
      }
    }
    speckle(g, w, h, rnd, spk, (a) => rgb(0, 0, 0, a), 0.03, 0.09, 1.5);
    g.fillStyle = joint;
    for (let i = 0; i <= nx; i++) g.fillRect(i * px - 1, 0, 2.5, h);
    for (let j = 0; j <= ny; j++) g.fillRect(0, j * (h / ny) - 1, w, 2.5);
  }];
}

const joints2x2 = (g: CanvasRenderingContext2D, w: number, h: number) => {
  g.fillStyle = 'rgb(232,227,219)';
  for (let i = 0; i <= 2; i++) g.fillRect((i * w) / 2 - 1, 0, 2.5, h);
  for (let j = 0; j <= 2; j++) g.fillRect(0, (j * h) / 2 - 1, w, 2.5);
};

const DEFS: Record<ProceduralName, [number, number, Draw]> = {
  // 4 oak planks of 13.8 cm, 220 cm long
  'oak-planks': [512, 2048, (g, w, h, rnd) => {
    const pw = w / 4;
    for (let p = 0; p < 4; p++) {
      const tone = rnd() * 18 - 9;
      g.fillStyle = rgb(196 + tone, 172 + tone, 138 + tone); g.fillRect(p * pw, 0, pw, h);
      for (let k = 0; k < 70; k++) {
        const x0 = p * pw + rnd() * pw, amp = 2 + rnd() * 6, f = 0.002 + rnd() * 0.004, ph = rnd() * 6;
        g.strokeStyle = rgb(150 + tone, 122 + tone, 90 + tone, 0.08 + rnd() * 0.18); g.lineWidth = 0.6 + rnd() * 1.6;
        g.beginPath();
        for (let y = 0; y <= h; y += 16) { const x = x0 + Math.sin(y * f + ph) * amp; if (y === 0) g.moveTo(x, y); else g.lineTo(x, y); }
        g.stroke();
      }
      for (let k = 0; k < 40; k++) { g.fillStyle = rgb(225, 208, 180, 0.25); g.fillRect(p * pw + rnd() * pw, rnd() * h, 1 + rnd() * 2, 8 + rnd() * 22); }
      const jy = ((p * 0.37 + 0.15) % 1) * h;
      g.fillStyle = 'rgba(80,60,40,.35)'; g.fillRect(p * pw, jy, pw, 2);
      g.fillStyle = 'rgba(80,60,40,.30)'; g.fillRect(p * pw, 0, 1.5, h);
    }
  }],
  'tile-terrace': tiles(256, 2, 2, [200, 196, 188], 'rgb(74,70,66)', 5, 2500), // warm light grey (delivery photos)
  'tile-kitchen': tiles(256, 2, 2, [64, 64, 66], 'rgb(150,148,145)', 4, 3000),
  'tile-bath-floor': tiles(256, 2, 2, [212, 201, 186], 'rgb(188,178,165)', 4, 2500),
  // 2 × 2 tiles of 60 × 30
  'tile-bath-wall': [512, 256, (g, w, h, rnd) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const t = rnd() * 6 - 3; g.fillStyle = rgb(200 + t, 186 + t, 170 + t); g.fillRect((i * w) / 2, (j * h) / 2, w / 2, h / 2);
    }
    speckle(g, w, h, rnd, 1800, (a) => rgb(0, 0, 0, a), 0.02, 0.06, 1.2);
    joints2x2(g, w, h);
  }],
  'tile-bath-wave': [512, 256, (g, w, h) => {
    g.fillStyle = 'rgb(208,195,180)'; g.fillRect(0, 0, w, h);
    wavyLines(g, w, h, 7, 3, 3, ['rgba(255,255,255,.22)', 2.4], ['rgba(60,45,30,.12)', 1.6, 3.4]);
    joints2x2(g, w, h);
  }],
  // 120 × 60 cm, bricks 40 × 6.5
  brick: [600, 300, (g, w, h, rnd) => {
    g.fillStyle = 'rgb(238,231,214)'; g.fillRect(0, 0, w, h);
    const rows = 9, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 100 + (r % 3) * 35;
      for (let b = -1; b < 4; b++) {
        const x = (b * 200 + off) % w, t = rnd() * 14 - 7;
        g.fillStyle = rgb(228 + t, 218 + t, 195 + t); g.fillRect(x + 3, r * rh + 3, 194, rh - 5);
        if (x + 197 > w) g.fillRect(x + 3 - w, r * rh + 3, 194, rh - 5);
        g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(x + 3, r * rh + rh - 4, 194, 2);
      }
    }
    speckle(g, w, h, rnd, 3000, (a) => rgb(120, 100, 70, a), 0.03, 0.08, 1.3);
  }],
  concrete: [512, 512, (g, w, h, rnd) => {
    g.fillStyle = 'rgb(76,74,71)'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 160; k++) {
      const r = 20 + rnd() * 90, x = rnd() * w, y = rnd() * h;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = rnd() < 0.5 ? '0,0,0' : '255,255,255';
      gr.addColorStop(0, `rgba(${c},${0.04 + rnd() * 0.06})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    speckle(g, w, h, rnd, 4000, (a) => rgb(20, 20, 20, a), 0.05, 0.2, 1.2);
  }],
  veneer: [256, 512, (g, w, h, rnd) => {
    g.fillStyle = 'rgb(205,184,150)'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 90; k++) {
      const x0 = rnd() * w, amp = 1 + rnd() * 5, f = 0.004 + rnd() * 0.01, ph = rnd() * 6;
      g.strokeStyle = rgb(158, 130, 96, 0.08 + rnd() * 0.16); g.lineWidth = 0.5 + rnd() * 1.4; g.beginPath();
      for (let y = 0; y <= h; y += 8) { const x = x0 + Math.sin(y * f + ph) * amp; if (y === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
  }],
  linen: [256, 256, (g, w, h, rnd) => {
    g.fillStyle = 'rgb(222,213,198)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) { g.fillStyle = rgb(0, 0, 0, 0.02 + rnd() * 0.04); g.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 2) { g.fillStyle = rgb(255, 255, 255, 0.02 + rnd() * 0.05); g.fillRect(x, 0, 1, h); }
  }],
  wool: [256, 256, (g, w, h, rnd) => {
    g.fillStyle = 'rgb(220,210,192)'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 5000; k++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.18)' : 'rgba(120,100,70,.12)';
      g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 1.8, 0, 7); g.fill();
    }
  }],
};

const cache = new Map<ProceduralName, HTMLCanvasElement>();

function canvasFor(name: ProceduralName): HTMLCanvasElement {
  let c = cache.get(name);
  if (!c) {
    const [w, h, draw] = DEFS[name];
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const seed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 2147483647, 1234567);
    draw(c.getContext('2d')!, w, h, seeded(seed));
    cache.set(name, c);
  }
  return c;
}

/** A texture repeating every `tile` cm, for geometry whose UVs are in cm. */
export function proceduralTexture(name: ProceduralName, tile: [number, number], anisotropy: number): THREE.Texture {
  const t = new THREE.CanvasTexture(canvasFor(name));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.repeat.set(1 / tile[0], 1 / tile[1]);
  return t;
}

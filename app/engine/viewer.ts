/**
 * Framework-agnostic 3D visit viewer. The UI layer owns the state and calls
 * `setState`; the viewer reports user intents (shortcuts, gamepad buttons)
 * through `onAction`.
 */
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Project } from './schema';
import { createMaterials, type MaterialSet } from './materials';
import { CM, toThree } from './geometry';
import { buildScene, OWNER_BUILDING, OWNER_COMMON, ownerOfVariant, type BuiltScene, type Door } from './build';
import { pointInPolygon, slide, type World } from './collision';

export type Mode = 'visit' | 'overview';
export type Mood = 'day' | 'night';
export interface ViewState { mode: Mode; furnished: boolean; variant: string; mood: Mood }
export type ViewerAction = 'start' | 'toggle-mode' | 'toggle-furnished' | 'toggle-mood' | 'next-variant' | 'toggle-list' | 'close-list';

/** Door currently under the crosshair (visit mode), for the UI hint. */
export interface DoorTarget { id: string; name: string; open: boolean }

export interface ViewerCallbacks {
  onAction?: (a: ViewerAction) => void;
  onDoorTarget?: (target: DoorTarget | null) => void;
  onRoom?: (roomName: string) => void;
  onGamepad?: (connected: boolean) => void;
  onPointerLock?: (locked: boolean) => void;
  onReady?: () => void;
}

const PLAYER_RADIUS = 18;
/** Doors can be operated from this distance (cm) in visit mode. */
const DOOR_REACH = 220;
/** A pointer moving less than this (px) between down and up is a tap/click. */
const TAP_SLOP = 8;
const WALK = 140, RUN = 260; // cm/s
const MOODS = {
  // Intensities are physically based (three r155+): legacy values × π.
  day: { sun: 1.7 * Math.PI, sunColor: 0xfff1dc, hemi: 0.55 * Math.PI, amb: 0.12 * Math.PI, env: 0.45, exposure: 1, fog: 0xc9d6e3, bg: 0xbfd3e6 },
  night: { sun: 0.04 * Math.PI, sunColor: 0x8fa6c8, hemi: 0.06 * Math.PI, amb: 0.03 * Math.PI, env: 0.05, exposure: 1.25, fog: 0x16202e, bg: 0x16202e },
} as const;

const deadzone = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.05, 200);
  private mats: MaterialSet;
  private built: BuiltScene;
  private world: World;
  private state: ViewState;
  private started = false;
  private listOpen = false;
  private player: { x: number; y: number; yaw: number; pitch: number };
  private orbit: { theta: number; phi: number; dist: number };
  private keys: Record<string, boolean> = {};
  /** On-screen thumbsticks (touch): gamepad-like axes in [-1, 1], y < 0 = up. */
  private sticks = { mx: 0, my: 0, lx: 0, ly: 0 };
  private drag: { x: number; y: number; x0: number; y0: number; id: number; touch: boolean } | null = null;
  private raycaster = new THREE.Raycaster();
  private aimed: Door | null = null;
  private frame = 0;
  private prevButtons: Record<number, boolean> = {};
  private padConnected = false;
  private lastRoom = '';
  private raf = 0;
  private timer = new THREE.Timer();
  private sun: THREE.DirectionalLight;
  private hemi = new THREE.HemisphereLight(0xe3ecf5, 0xb8a48a, 0);
  private amb = new THREE.AmbientLight(0xffffff, 0);
  private backgrounds: Partial<Record<Mood, THREE.Texture>> = {};
  private disposers: Array<() => void> = [];
  private readonly isTouch: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    private project: Project,
    initial: ViewState,
    private assetUrl: (path: string) => string,
    private cb: ViewerCallbacks = {},
  ) {
    this.state = { ...initial };
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.mats = createMaterials(project.materials, r.capabilities.getMaxAnisotropy(), assetUrl);
    this.built = buildScene(project, this.mats, assetUrl);
    const s = this.scene;
    s.fog = new THREE.Fog(0xc9d6e3, 30, 120);
    s.add(this.built.building, this.built.ceiling, this.built.furnishing);

    const meta = project.meta;
    this.world = {
      colliders: this.built.colliders,
      bounds: meta.bounds,
      active: (owner) =>
        owner === OWNER_BUILDING ||
        (this.state.furnished && (owner === OWNER_COMMON || owner === ownerOfVariant(this.state.variant))),
    };
    this.player = { x: meta.start.x, y: meta.start.y, yaw: (meta.start.yaw * Math.PI) / 180, pitch: 0 };
    this.orbit = {
      theta: (meta.overview.azimuth * Math.PI) / 180,
      phi: (meta.overview.polar * Math.PI) / 180,
      dist: meta.overview.distance * CM,
    };

    // Lights
    const env = meta.environment;
    this.sun = new THREE.DirectionalLight(0xfff1dc, 0);
    this.sun.position.copy(toThree(...env.sun.from));
    this.sun.target.position.copy(toThree(...env.sun.to));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    s.add(this.sun, this.sun.target, this.hemi, this.amb);
    this.buildSurroundings();
    this.loadEnvironment();

    this.bindInput();
    this.resize();
    this.apply();
    this.built.ready.then(() => cb.onReady?.());
    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------ public API

  setState(next: Partial<ViewState>) {
    this.state = { ...this.state, ...next };
    this.apply();
  }

  /** Leave the intro screen. */
  start(mode: Mode) {
    this.started = true;
    this.setState({ mode });
    if (mode === 'visit') this.lockPointer();
  }

  /** Moves the visitor (plan cm, degrees). Used by the screenshot script; later by "go to room". */
  teleport(x: number, y: number, yawDeg: number, pitchDeg = 0) {
    Object.assign(this.player, { x, y, yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 });
  }

  /** Sets the overview orbit (degrees, cm). */
  setOrbit(azimuthDeg: number, polarDeg: number, distanceCm: number) {
    this.orbit = { theta: (azimuthDeg * Math.PI) / 180, phi: (polarDeg * Math.PI) / 180, dist: distanceCm * CM };
  }

  /** Doors of the project, for tests and scripts. */
  get doors(): readonly Door[] { return this.built.doors; }

  /** Opens or closes a door by opening id. */
  toggleDoor(id: string) {
    this.built.doors.find((d) => d.id === id)?.toggle();
    this.aimed = null; // refresh the hint on next aim
  }

  /** Virtual joysticks (touch UI): `move` walks, `look` turns the head, both like gamepad sticks. */
  setVirtualSticks(move: { x: number; y: number }, look: { x: number; y: number }) {
    this.sticks = { mx: move.x, my: move.y, lx: look.x, ly: look.y };
  }

  setListOpen(open: boolean) {
    this.listOpen = open;
    if (open && document.pointerLockElement) document.exitPointerLock();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.mats.dispose();
    Object.values(this.backgrounds).forEach((t) => t?.dispose());
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }

  // ------------------------------------------------------------ state → scene

  private apply() {
    const { mode, furnished, variant, mood } = this.state;
    this.built.furnishing.visible = furnished;
    for (const [id, g] of this.built.variants) g.visible = id === variant;
    this.built.ceiling.visible = mode === 'visit';
    if (mode === 'overview' && document.pointerLockElement) document.exitPointerLock();

    const m = MOODS[mood];
    const night = mood === 'night';
    const bg = this.project.meta.environment.background[mood];
    this.scene.background = this.backgrounds[mood] ?? new THREE.Color(m.bg);
    this.scene.backgroundIntensity = bg.intensity ?? 1;
    this.scene.backgroundRotation.set(0, ((bg.rotation ?? 0) * Math.PI) / 180, 0);
    (this.scene.fog as THREE.Fog).color.set(m.fog);
    this.scene.environmentIntensity = m.env;
    this.sun.intensity = m.sun;
    this.sun.color.set(m.sunColor);
    this.hemi.intensity = m.hemi;
    this.amb.intensity = m.amb;
    this.renderer.toneMappingExposure = m.exposure;
    for (const l of this.built.lights) l.light.intensity = night ? l.intensity : 0;
    for (const g of this.mats.glowing) {
      g.material.emissive.copy(night ? g.emissive : new THREE.Color(0));
      g.material.emissiveIntensity = night ? g.intensity : 0;
    }
  }

  private loadEnvironment() {
    const env = this.project.meta.environment;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    new HDRLoader().load(this.assetUrl(env.hdri), (tex) => {
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
      pmrem.dispose();
    });
    const tl = new THREE.TextureLoader();
    (['day', 'night'] as const).forEach((mood) => {
      tl.load(this.assetUrl(env.background[mood].src), (t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        this.backgrounds[mood] = t;
        this.apply();
      });
    });
  }

  private buildSurroundings() {
    const { seed, center, groundZ } = this.project.meta.environment.surroundings;
    const [cx, , cz] = toThree(center[0], center[1], 0).toArray();
    const gy = groundZ * CM;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x9aa28f, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = gy;
    this.scene.add(ground);
    let s = seed;
    const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
    const facade = new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.95 });
    for (let i = 0; i < 26; i++) {
      const w = 8 + rnd() * 14, d = 8 + rnd() * 12, h = 6 + rnd() * 22;
      const ang = rnd() * Math.PI - Math.PI / 2, dist = 35 + rnd() * 45;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facade);
      b.position.set(cx + Math.sin(ang) * dist, gy + h / 2, cz + Math.cos(ang) * dist);
      this.scene.add(b);
    }
    const foliage = new THREE.MeshStandardMaterial({ color: 0x6e8a5a, roughness: 1 });
    for (let i = 0; i < 40; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(2 + rnd() * 2.5, 10, 8), foliage);
      const ang = rnd() * Math.PI * 2, dist = 18 + rnd() * 40;
      t.position.set(cx + Math.sin(ang) * dist, gy + 3, cz + Math.cos(ang) * dist);
      this.scene.add(t);
    }
  }

  // ------------------------------------------------------------ input

  private listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private listen<K extends keyof DocumentEventMap>(target: Document, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private listen<K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  private listen(target: EventTarget, type: string, fn: (e: never) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts);
    this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
  }

  private lockPointer() {
    if (!this.isTouch && this.canvas.requestPointerLock) {
      // Returns a promise in recent browsers; it rejects e.g. when re-locking right after Escape.
      try {
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => { /* the next click retries */ });
      } catch { /* older browsers throw without a user gesture */ }
    }
  }

  private bindInput() {
    const c = this.canvas, emit = (a: ViewerAction) => this.cb.onAction?.(a);
    this.listen(window, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (e.code === 'KeyM') emit('toggle-furnished');
      if (e.code === 'KeyJ') emit('toggle-mood');
      if (e.code === 'KeyV') emit('next-variant');
      if (e.code === 'KeyL') emit('toggle-list');
      if (e.code === 'KeyE' && this.state.mode === 'visit') this.toggleAimed();
      if (e.code === 'Escape' && this.listOpen) emit('close-list');
    });
    this.listen(window, 'keyup', (e) => { this.keys[e.code] = false; });
    this.listen(window, 'blur', () => { this.keys = {}; });
    this.listen(window, 'resize', () => this.resize());
    this.listen(c, 'click', (e) => {
      if (!this.started || this.listOpen) return;
      if (this.state.mode === 'overview') this.toggleDoorAt(e.clientX, e.clientY);
      else if (document.pointerLockElement === c) this.toggleAimed();
      else if (!this.isTouch) this.lockPointer();
    });
    this.listen(document, 'pointerlockchange', () => this.cb.onPointerLock?.(document.pointerLockElement === c));
    this.listen(document, 'mousemove', (e) => {
      if (document.pointerLockElement !== c) return;
      this.player.yaw -= e.movementX * 0.0022;
      this.player.pitch = clamp(this.player.pitch - e.movementY * 0.0022, -1.3, 1.3);
    });
    this.listen(c, 'pointerdown', (e) => {
      this.drag = {
        x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, touch: e.pointerType === 'touch',
      };
      c.setPointerCapture(e.pointerId);
    });
    this.listen(c, 'pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (this.state.mode === 'overview') {
        this.orbit.theta -= dx * 0.006;
        this.orbit.phi = clamp(this.orbit.phi - dy * 0.005, 0.15, 1.45);
        d.x = e.clientX; d.y = e.clientY;
      } else if (e.pointerType === 'touch') {
        // Swiping the scene looks around (movement is on the virtual joysticks).
        this.player.yaw -= dx * 0.005;
        this.player.pitch = clamp(this.player.pitch - dy * 0.004, -1.3, 1.3);
        d.x = e.clientX; d.y = e.clientY;
      }
    });
    const endDrag = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    this.listen(c, 'pointerup', (e) => {
      const d = this.drag;
      // Touch tap in visit mode: operate the door under the finger (click events are unreliable on touch).
      if (d?.touch && d.id === e.pointerId && this.state.mode === 'visit' && this.started &&
        Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < TAP_SLOP) this.toggleDoorAt(e.clientX, e.clientY);
      endDrag(e);
    });
    this.listen(c, 'pointercancel', endDrag);
    this.listen(c, 'wheel', (e) => {
      if (this.state.mode !== 'overview') return;
      this.orbit.dist = clamp(this.orbit.dist * (1 + e.deltaY * 0.001), 4, 28);
      e.preventDefault();
    }, { passive: false });
    this.listen(window, 'gamepadconnected', () => this.setPad(true));
    this.listen(window, 'gamepaddisconnected', () => this.setPad(navigator.getGamepads?.().some((p) => p?.connected) ?? false));
  }

  private setPad(on: boolean) {
    if (on !== this.padConnected) { this.padConnected = on; this.cb.onGamepad?.(on); }
  }

  /** DualSense on the standard mapping: ✕ 0, ○ 1, □ 2, △ 3, L1 4, R1 5, L2 6, R2 7, Options 9. */
  private readGamepad(dt: number) {
    // Prefer a pad on the standard mapping (DualSense in Chrome/Edge/Safari); some systems expose extra devices.
    const pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p?.connected);
    const gp = pads.find((p) => p.mapping === 'standard') ?? pads[0] ?? null;
    if (!gp) return { mx: 0, my: 0, sprint: false };
    const edge: Record<number, boolean> = {};
    for (const i of [0, 1, 2, 3, 4, 5, 9]) {
      const p = !!gp.buttons[i]?.pressed;
      edge[i] = p && !this.prevButtons[i];
      this.prevButtons[i] = p;
    }
    const emit = (a: ViewerAction) => this.cb.onAction?.(a);
    if (!this.started && (edge[0] || edge[9])) emit('start');
    else {
      if (edge[9]) emit('toggle-mode');
      if (edge[0] && this.state.mode === 'visit') this.toggleAimed();
    }
    if (edge[2]) emit('toggle-furnished');
    if (edge[3]) emit('toggle-mood');
    if (edge[4] || edge[5]) emit('next-variant');
    if (edge[1]) emit('toggle-list');
    const lx = deadzone(gp.axes[0] ?? 0), ly = deadzone(gp.axes[1] ?? 0);
    const rx = deadzone(gp.axes[2] ?? 0), ry = deadzone(gp.axes[3] ?? 0);
    const l2 = gp.buttons[6]?.value ?? 0, r2 = gp.buttons[7]?.value ?? 0;
    if (this.state.mode === 'visit') {
      this.player.yaw -= rx * 2.4 * dt;
      this.player.pitch = clamp(this.player.pitch - ry * 1.8 * dt, -1.3, 1.3);
    } else {
      this.orbit.theta -= rx * 1.6 * dt;
      this.orbit.phi = clamp(this.orbit.phi - ry * 1.2 * dt, 0.15, 1.45);
      this.orbit.dist = clamp(this.orbit.dist + (r2 - l2) * 8 * dt, 4, 28);
    }
    return { mx: lx, my: ly, sprint: r2 > 0.3 };
  }

  // ------------------------------------------------------------ doors

  /** First visible door hit by a ray from normalised device coordinates. */
  private doorAt(ndc: THREE.Vector2, maxCm: number): Door | null {
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.far = maxCm * CM;
    const hits = this.raycaster.intersectObjects([this.built.building, this.built.ceiling, this.built.furnishing], true);
    for (const h of hits) {
      if (!isVisible(h.object)) continue; // three.js raycasts hidden objects too
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.doorId === undefined) o = o.parent;
      if (!o) return null; // something else is in front
      return this.built.doors.find((d) => d.id === o!.userData.doorId) ?? null;
    }
    return null;
  }

  private toggleDoorAt(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const far = this.state.mode === 'visit' ? DOOR_REACH : 10_000;
    this.doorAt(ndc, far)?.toggle();
    this.aimed = null;
  }

  private toggleAimed() {
    const d = this.doorAt(new THREE.Vector2(0, 0), DOOR_REACH);
    d?.toggle();
    this.aimed = null;
  }

  /** Updates the crosshair hint a few times per second. */
  private updateAim() {
    if (++this.frame % 6) return;
    const d = this.state.mode === 'visit' && this.started ? this.doorAt(new THREE.Vector2(0, 0), DOOR_REACH) : null;
    const key = d ? `${d.id}:${d.isOpen}` : '';
    const prev = this.aimed ? `${this.aimed.id}:${this.aimed.isOpen}` : '';
    if (key === prev && (d !== null) === (this.aimed !== null)) return;
    this.aimed = d;
    this.cb.onDoorTarget?.(d ? { id: d.id, name: d.name, open: d.isOpen } : null);
  }

  // ------------------------------------------------------------ loop

  private resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private updateRoom() {
    let name = this.lastRoom;
    if (this.state.mode === 'overview') name = 'Vue d’ensemble';
    else {
      for (const level of this.project.building.levels) {
        const room = level.rooms.find((r) => pointInPolygon(this.player.x, this.player.y, r.polygon));
        if (room) { name = room.name; break; }
      }
    }
    if (name !== this.lastRoom) { this.lastRoom = name; this.cb.onRoom?.(name); }
  }

  private tick = (now?: number) => {
    this.raf = requestAnimationFrame(this.tick);
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const pad = this.readGamepad(dt);
    if (this.state.mode === 'visit') {
      const k = this.keys;
      let fx = 0, fy = 0;
      if (k.KeyW || k.KeyZ || k.ArrowUp) fy -= 1;
      if (k.KeyS || k.ArrowDown) fy += 1;
      if (k.KeyA || k.KeyQ || k.ArrowLeft) fx -= 1;
      if (k.KeyD || k.ArrowRight) fx += 1;
      const st = this.sticks;
      fx += pad.mx + st.mx;
      fy += pad.my + st.my;
      this.player.yaw -= st.lx * 2.2 * dt;
      this.player.pitch = clamp(this.player.pitch - st.ly * 1.6 * dt, -1.3, 1.3);
      const len = Math.hypot(fx, fy);
      if (len > 1) { fx /= len; fy /= len; }
      const speed = (k.ShiftLeft || k.ShiftRight || pad.sprint ? RUN : WALK) * dt;
      const sin = Math.sin(this.player.yaw), cos = Math.cos(this.player.yaw);
      // forward = (-sin, -cos) on the plan, right = (cos, -sin)
      const dx = (fx * cos + fy * sin) * speed, dy = (fy * cos - fx * sin) * speed;
      if (dx || dy) slide(this.world, this.player, dx, dy, PLAYER_RADIUS);
      this.camera.position.copy(toThree(this.player.x, this.player.y, this.project.meta.eyeHeight));
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(this.player.pitch, this.player.yaw, 0);
    } else {
      const t = toThree(...this.project.meta.overview.target);
      const { theta, phi, dist } = this.orbit;
      this.camera.position.set(
        t.x + dist * Math.sin(phi) * Math.sin(theta),
        t.y + dist * Math.cos(phi),
        t.z + dist * Math.sin(phi) * Math.cos(theta),
      );
      this.camera.lookAt(t);
    }
    for (const d of this.built.doors) d.step(dt);
    this.updateAim();
    this.updateRoom();
    this.renderer.render(this.scene, this.camera);
  };
}

function isVisible(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

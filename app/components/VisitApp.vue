<script setup lang="ts">
import { loadProject } from '~/engine/load';
import type { Project } from '~/engine/schema';
import { Viewer, type DoorTarget, type ViewState, type ViewerAction, type Mode } from '~/engine/viewer';

const props = defineProps<{ projectId: string }>();

const base = useRuntimeConfig().app.baseURL;
const projectBase = computed(() => `${base}projects/${props.projectId}/`);
const canvas = ref<HTMLCanvasElement | null>(null);
const project = shallowRef<Project | null>(null);
const loadError = ref<string | null>(null);

const state = reactive<ViewState>({ mode: 'visit', furnished: true, variant: '', mood: 'day' });
const started = ref(false);
const listOpen = ref(false);
const room = ref('');
const padConnected = ref(false);
const locked = ref(false);
const doorTarget = ref<DoorTarget | null>(null);
const isTouch = ref(false);
const toastText = ref('');
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let viewer: Viewer | null = null;

const variant = computed(() => state.variant);
const { groups, summary, update } = useShoppingList(project, variant);

const variants = computed(() => project.value?.furnishing.variants ?? []);
const showCross = computed(() => started.value && state.mode === 'visit');
const doorHint = computed(() => {
  const d = doorTarget.value;
  if (!d || !showCross.value) return '';
  const how = isTouch.value ? 'Touchez' : padConnected.value ? '✕' : 'E ou clic';
  return `${how} · ${d.open ? 'fermer' : 'ouvrir'} : ${d.name.toLowerCase()}`;
});
const showSticks = computed(() => isTouch.value && started.value && state.mode === 'visit' && !listOpen.value);
const showPaused = computed(() =>
  started.value && state.mode === 'visit' && !locked.value && !listOpen.value && !padConnected.value && !isTouch.value);

function toast(text: string) {
  toastText.value = text;
  toastVisible.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastVisible.value = false), 1600);
}

function set<K extends keyof ViewState>(k: K, v: ViewState[K], silent = false) {
  state[k] = v;
  viewer?.setState({ [k]: v });
  if (silent) return;
  const labels: Record<string, string> = {
    'mode:visit': 'Visite', 'mode:overview': 'Vue d’ensemble',
    'furnished:true': 'Meublé', 'furnished:false': 'Appartement vide',
    'mood:day': 'Ambiance de jour', 'mood:night': 'Ambiance du soir',
  };
  if (k === 'variant') toast(`Variante ${variants.value.find((x) => x.id === v)?.name.toLowerCase() ?? v}`);
  else toast(labels[`${k}:${v}`] ?? '');
}

function start(mode: Mode) {
  started.value = true;
  state.mode = mode;
  viewer?.start(mode);
}

function setList(open: boolean) {
  listOpen.value = open;
  viewer?.setListOpen(open);
}

function nextVariant() {
  const list = variants.value;
  const i = list.findIndex((v) => v.id === state.variant);
  const next = list[(i + 1) % list.length];
  if (next) set('variant', next.id);
}

function onAction(a: ViewerAction) {
  switch (a) {
    case 'start': if (!started.value) start('visit'); break;
    case 'toggle-mode': set('mode', state.mode === 'visit' ? 'overview' : 'visit'); break;
    case 'toggle-furnished': set('furnished', !state.furnished); break;
    case 'toggle-mood': set('mood', state.mood === 'day' ? 'night' : 'day'); break;
    case 'next-variant': nextVariant(); break;
    case 'toggle-list': setList(!listOpen.value); break;
    case 'close-list': setList(false); break;
  }
}

function onSticks(move: { x: number; y: number }, look: { x: number; y: number }) {
  viewer?.setVirtualSticks(move, look);
}

function onModeButton(mode: Mode) {
  if (mode === 'visit' && !started.value) start('visit');
  else set('mode', mode);
}

onMounted(async () => {
  isTouch.value = matchMedia('(pointer: coarse)').matches;
  try {
    const p = await loadProject((f) => $fetch(`${projectBase.value}${f}`));
    project.value = p;
    state.variant = p.furnishing.defaultVariant;
    useHead({ title: `${p.meta.name} — visite` });
    await nextTick();
    if (!canvas.value) return;
    viewer = new Viewer(canvas.value, p, { ...state }, (path) => `${projectBase.value}${path}`, {
      onAction,
      onRoom: (r) => (room.value = r),
      onGamepad: (on) => { padConnected.value = on; if (on) toast('Manette connectée'); },
      onPointerLock: (l) => (locked.value = l),
      onDoorTarget: (t) => (doorTarget.value = t),
    });
    // Debug/test hook (used by scripts/screenshot.ts).
    (window as unknown as { __viewer?: Viewer }).__viewer = viewer;
  } catch (e) {
    const status = (e as { statusCode?: number; status?: number }).statusCode ?? (e as { status?: number }).status;
    loadError.value = status === 404
      ? 'Ce projet n’existe pas ou n’est plus en ligne. Vérifiez le lien, ou revenez à la liste des projets.'
      : 'La visite n’a pas pu se charger. Vérifiez votre connexion puis rechargez la page.';
    console.error(e);
  }
});

onBeforeUnmount(() => {
  viewer?.dispose();
  viewer = null;
  clearTimeout(toastTimer);
});
</script>

<template>
  <div class="visit">
    <canvas ref="canvas" class="scene" tabindex="0" aria-label="Vue 3D de l’appartement" />
    <div v-show="showCross" class="cross" :class="{ aim: !!doorTarget }" />
    <div v-if="doorHint" class="door-hint">{{ doorHint }}</div>
    <div v-show="showPaused" class="paused"><span>Cliquez dans la vue pour reprendre la visite</span></div>
    <div class="toast" :class="{ show: toastVisible, low: isTouch }" role="status" aria-live="polite">{{ toastText }}</div>
    <div v-show="padConnected" class="pad">Manette connectée</div>
    <VirtualJoysticks v-if="showSticks" @change="onSticks" />

    <section v-if="loadError" class="intro">
      <div class="card">
        <h1 class="wordmark">Projet indisponible</h1>
        <p class="err">{{ loadError }}</p>
        <NuxtLink to="/" class="btn ghost">Retour</NuxtLink>
      </div>
    </section>

    <VisitIntro
      v-else-if="!started && project"
      :name="project.meta.name"
      :subtitle="project.meta.subtitle"
      :credits="project.meta.credits"
      :touch="isTouch"
      @start="start"
    />

    <div v-if="project" class="hud" :class="{ top: isTouch }">
      <div class="where">{{ room }}</div>
      <div class="bar" role="toolbar" aria-label="Réglages de la visite">
        <div class="seg" role="group" aria-label="Mode">
          <button :aria-pressed="state.mode === 'visit'" @click="onModeButton('visit')">Visite</button>
          <button :aria-pressed="state.mode === 'overview'" @click="onModeButton('overview')">Ensemble</button>
        </div>
        <div class="seg" role="group" aria-label="Aménagement">
          <button :aria-pressed="state.furnished" @click="set('furnished', true)">Meublé</button>
          <button :aria-pressed="!state.furnished" @click="set('furnished', false)">Vide</button>
        </div>
        <div class="seg" role="group" aria-label="Variante">
          <button v-for="v in variants" :key="v.id" :aria-pressed="state.variant === v.id" @click="set('variant', v.id)">
            {{ v.name }}
          </button>
        </div>
        <div class="seg" role="group" aria-label="Ambiance">
          <button :aria-pressed="state.mood === 'day'" @click="set('mood', 'day')">Jour</button>
          <button :aria-pressed="state.mood === 'night'" @click="set('mood', 'night')">Soir</button>
        </div>
        <button class="listbtn" @click="setList(true)">
          Liste de courses <b v-if="summary.total">{{ formatEuros(summary.total) }}</b>
        </button>
      </div>
    </div>

    <ShoppingList :open="listOpen" :groups="groups" :summary="summary" @close="setList(false)" @update="update" />
  </div>
</template>

<style scoped>
.visit { position: fixed; inset: 0; overflow: hidden; }
.scene { position: fixed; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; outline: none; }
.intro {
  position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; z-index: 20;
  background: radial-gradient(120% 90% at 50% 20%, rgba(20, 28, 38, 0.35), rgba(20, 28, 38, 0.78));
}
.err { font-size: 15px; line-height: 1.5; color: var(--ink-soft); margin: 4px 0 18px; }
.hud {
  position: fixed; left: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); z-index: 10;
  display: flex; flex-direction: column; gap: 8px; max-width: calc(100vw - 32px);
}
.hud.top { bottom: auto; top: calc(12px + env(safe-area-inset-top, 0px)); flex-direction: column-reverse; }
.hud.top .where { font-size: 16px; min-height: 0; }
.bar {
  display: flex; flex-wrap: wrap; gap: 6px; background: var(--panel);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--line); border-radius: 14px; padding: 6px;
}
.seg { display: flex; background: var(--chip); border-radius: 10px; padding: 2px; }
.seg button { border: 0; background: transparent; padding: 7px 11px; border-radius: 8px; font-size: 13.5px; color: var(--ink-soft); }
.seg button[aria-pressed='true'] { background: var(--panel-solid); color: var(--ink); box-shadow: 0 0 0 1px var(--line); font-weight: 500; }
.listbtn { border: 1px solid var(--line); background: transparent; border-radius: 10px; padding: 7px 12px; font-size: 13.5px; }
.listbtn b { font-weight: 700; color: var(--oak); }
.where { font-family: var(--serif); font-size: 20px; font-weight: 700; color: #f3efe7; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.45); padding-left: 4px; min-height: 30px; }
.pad {
  position: fixed; top: calc(14px + env(safe-area-inset-top, 0px)); right: 16px; z-index: 10; font-size: 12.5px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px;
}
.cross {
  position: fixed; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%;
  background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35); z-index: 5; pointer-events: none;
}
.cross.aim { width: 12px; height: 12px; margin: -6px 0 0 -6px; background: transparent; border: 2px solid rgba(255, 255, 255, 0.95); }
.door-hint {
  position: fixed; left: 50%; top: calc(50% + 22px); transform: translateX(-50%); z-index: 6; pointer-events: none;
  background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; font-size: 13px; white-space: nowrap;
}
.toast {
  position: fixed; left: 50%; top: calc(22px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 15;
  background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 8px 16px; font-size: 14px;
  opacity: 0; transition: opacity 0.25s; pointer-events: none;
}
.toast.show { opacity: 1; }
.toast.low { top: auto; bottom: calc(170px + env(safe-area-inset-bottom, 0px)); }
.paused { position: fixed; inset: 0; display: grid; place-items: center; z-index: 12; pointer-events: none; }
.paused span { background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 10px 18px; font-size: 14px; }
</style>

<script setup lang="ts">
/**
 * Two on-screen thumbsticks for touch devices: left moves, right looks.
 * Each stick reports a vector in [-1, 1]² (y < 0 = pushed up), like a gamepad axis.
 */
export interface Stick { x: number; y: number }

const emit = defineEmits<{ change: [move: Stick, look: Stick] }>();

const RADIUS = 46; // px, travel of the knob from the centre

const sticks = reactive({
  move: { x: 0, y: 0, id: -1, cx: 0, cy: 0 },
  look: { x: 0, y: 0, id: -1, cx: 0, cy: 0 },
});
type Name = keyof typeof sticks;

function publish() {
  emit('change', { x: sticks.move.x, y: sticks.move.y }, { x: sticks.look.x, y: sticks.look.y });
}

function update(s: (typeof sticks)[Name], e: PointerEvent) {
  let dx = (e.clientX - s.cx) / RADIUS, dy = (e.clientY - s.cy) / RADIUS;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  s.x = dx; s.y = dy;
  publish();
}

function down(name: Name, e: PointerEvent) {
  const s = sticks[name];
  if (s.id !== -1) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  s.id = e.pointerId;
  s.cx = r.left + r.width / 2;
  s.cy = r.top + r.height / 2;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  update(s, e);
}

function move(name: Name, e: PointerEvent) {
  const s = sticks[name];
  if (s.id === e.pointerId) update(s, e);
}

function up(name: Name, e: PointerEvent) {
  const s = sticks[name];
  if (s.id !== e.pointerId) return;
  s.id = -1; s.x = 0; s.y = 0;
  publish();
}

onBeforeUnmount(() => emit('change', { x: 0, y: 0 }, { x: 0, y: 0 }));
</script>

<template>
  <div class="sticks">
    <div
      v-for="name in (['move', 'look'] as const)"
      :key="name"
      class="stick"
      :class="[name, { active: sticks[name].id !== -1 }]"
      :aria-label="name === 'move' ? 'Joystick de déplacement' : 'Joystick de regard'"
      role="application"
      @pointerdown.prevent="down(name, $event)"
      @pointermove="move(name, $event)"
      @pointerup="up(name, $event)"
      @pointercancel="up(name, $event)"
      @lostpointercapture="up(name, $event)"
      @contextmenu.prevent
    >
      <div class="knob" :style="{ transform: `translate(${sticks[name].x * RADIUS}px, ${sticks[name].y * RADIUS}px)` }" />
    </div>
  </div>
</template>

<style scoped>
.stick {
  position: fixed; z-index: 9; bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  width: 124px; height: 124px; border-radius: 50%; display: grid; place-items: center;
  background: rgba(20, 24, 30, 0.18); border: 1.5px solid rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
  transition: background 0.15s;
}
.stick.move { left: calc(24px + env(safe-area-inset-left, 0px)); }
.stick.look { right: calc(24px + env(safe-area-inset-right, 0px)); }
.stick.active { background: rgba(20, 24, 30, 0.3); }
.knob {
  width: 54px; height: 54px; border-radius: 50%; pointer-events: none;
  background: rgba(255, 255, 255, 0.82); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}
.stick:not(.active) .knob { transition: transform 0.12s ease-out; }
</style>

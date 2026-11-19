<script setup lang="ts">
import type { Mode } from '~/engine/viewer';

defineProps<{ name: string; subtitle: string; credits: string }>();
const emit = defineEmits<{ start: [mode: Mode] }>();
</script>

<template>
  <section class="intro" aria-labelledby="intro-title">
    <div class="card">
      <h1 id="intro-title" class="wordmark">{{ name }}<small>{{ subtitle }}</small></h1>
      <div class="actions">
        <button class="btn" @click="emit('start', 'visit')">Commencer la visite</button>
        <button class="btn ghost" @click="emit('start', 'overview')">Voir l’ensemble</button>
      </div>
      <div class="howto">
        <div>
          <h2>Clavier et souris</h2>
          <dl>
            <dt>ZQSD / flèches</dt><dd>se déplacer</dd>
            <dt>Souris</dt><dd>regarder</dd>
            <dt>Maj</dt><dd>marcher plus vite</dd>
            <dt>E / clic</dt><dd>ouvrir, fermer une porte</dd>
            <dt>M, J, V, L</dt><dd>meublé, jour/soir, variante, liste</dd>
          </dl>
        </div>
        <div>
          <h2>Manette PS5</h2>
          <dl>
            <dt>Stick gauche</dt><dd>se déplacer</dd>
            <dt>Stick droit</dt><dd>regarder</dd>
            <dt>R2</dt><dd>marcher plus vite</dd>
            <dt>✕</dt><dd>ouvrir, fermer une porte</dd>
            <dt>□ △ L1/R1 ○</dt><dd>meublé, jour/soir, variante, liste</dd>
            <dt>Options</dt><dd>vue d’ensemble</dd>
          </dl>
        </div>
      </div>
      <p class="credits">{{ credits }}</p>
    </div>
  </section>
</template>

<style scoped>
.intro {
  position: fixed; inset: 0; display: grid; place-items: center; z-index: 20;
  padding: calc(24px + env(safe-area-inset-top, 0px)) 16px calc(24px + env(safe-area-inset-bottom, 0px));
  background: radial-gradient(120% 90% at 50% 20%, rgba(20, 28, 38, 0.35), rgba(20, 28, 38, 0.78));
  overflow: auto;
}
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 26px 0 22px; }
.howto {
  display: grid; grid-template-columns: 1fr 1fr; gap: 18px; border-top: 1px solid var(--line);
  padding-top: 18px; font-size: 14px; color: var(--ink-soft);
}
.howto h2 { font-family: var(--serif); font-size: 17px; color: var(--ink); margin: 0 0 6px; font-weight: 700; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
dt { color: var(--ink); font-weight: 500; white-space: nowrap; }
dd { margin: 0; }
.credits { font-size: 12px; color: var(--ink-soft); margin: 16px 0 0; line-height: 1.45; }
@media (max-width: 560px) { .howto { grid-template-columns: 1fr; } }
</style>

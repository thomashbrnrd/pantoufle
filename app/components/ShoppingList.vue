<script setup lang="ts">
import type { ShoppingGroup, ProductState } from '~/composables/useShoppingList';

defineProps<{
  open: boolean;
  groups: ShoppingGroup[];
  summary: { total: number; done: number; todo: number; count: number };
}>();
const emit = defineEmits<{ close: []; update: [id: string, patch: ProductState] }>();
</script>

<template>
  <aside class="list" :class="{ open }" aria-labelledby="lt" :aria-hidden="!open" :inert="!open">
    <button class="close" aria-label="Fermer la liste" @click="emit('close')">×</button>
    <header>
      <h2 id="lt">Liste de courses</h2>
      <div class="sum">
        <div><strong>{{ formatEuros(summary.total) }}</strong>budget saisi</div>
        <div><strong>{{ summary.done }} / {{ summary.count }}</strong>achetés</div>
        <div><strong>{{ summary.todo }}</strong>prix à chiffrer</div>
      </div>
    </header>
    <div class="items">
      <template v-for="g in groups" :key="g.roomId">
        <h3>{{ g.roomName }}</h3>
        <div v-for="{ product: p, state: s } in g.rows" :key="p.id" class="row" :class="{ done: s.done }">
          <input
            type="checkbox"
            :checked="!!s.done"
            :aria-label="`Acheté : ${p.label}`"
            @change="emit('update', p.id, { done: ($event.target as HTMLInputElement).checked })"
          >
          <div>
            <div class="n">{{ p.label }}<template v-if="p.qty > 1"> × {{ p.qty }}</template></div>
            <div v-if="p.details" class="d">{{ p.details }}</div>
          </div>
          <label class="price">
            <input
              inputmode="decimal"
              :value="s.price ?? ''"
              :placeholder="p.price != null ? String(p.price) : '—'"
              :aria-label="`Prix unitaire : ${p.label}`"
              @input="emit('update', p.id, { price: ($event.target as HTMLInputElement).value.trim() || null })"
            >€
          </label>
        </div>
      </template>
      <p class="note">
        Saisissez les prix au fur et à mesure : ils restent enregistrés dans ce navigateur.
        La liste suit la variante affichée.
      </p>
    </div>
  </aside>
</template>

<style scoped>
.list {
  position: fixed; top: 0; right: 0; height: 100%; width: min(430px, 100vw); z-index: 16;
  background: var(--panel); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border-left: 1px solid var(--line); transform: translateX(102%); transition: transform 0.3s ease;
  display: flex; flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px);
}
.list.open { transform: none; }
header { padding: 22px 22px 14px; border-bottom: 1px solid var(--line); }
h2 { font-family: var(--serif); font-size: 26px; margin: 0; font-weight: 700; }
.sum { display: flex; gap: 18px; margin-top: 10px; font-size: 13.5px; color: var(--ink-soft); }
.sum strong { display: block; font-size: 20px; color: var(--ink); font-weight: 700; }
.close {
  position: absolute; top: calc(16px + env(safe-area-inset-top, 0px)); right: 16px;
  border: 1px solid var(--line); background: transparent; border-radius: 999px; width: 34px; height: 34px; font-size: 18px; line-height: 1;
}
.items { overflow: auto; padding: 4px 22px 28px; flex: 1; }
h3 { font-family: var(--serif); font-size: 17px; margin: 20px 0 6px; font-weight: 700; }
.row { display: grid; grid-template-columns: 22px 1fr 86px; gap: 10px; align-items: start; padding: 9px 0; border-bottom: 1px solid var(--line); }
.row input[type='checkbox'] { width: 18px; height: 18px; margin-top: 2px; accent-color: var(--oak); }
.n { font-weight: 500; }
.d { font-size: 12.5px; color: var(--ink-soft); }
.row.done .n { text-decoration: line-through; color: var(--ink-soft); }
.price { display: flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: 8px; padding: 3px 7px; }
.price input { width: 100%; border: 0; background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; text-align: right; padding: 2px 0; }
.price input:focus { outline: none; }
.price:focus-within { outline: 2px solid var(--focus); outline-offset: 1px; }
.note { font-size: 12.5px; color: var(--ink-soft); margin-top: 18px; }
</style>

import type { Product, Project } from '~/engine/schema';

export interface ProductState { done?: boolean; price?: string | null }
export interface ShoppingRow { product: Product; state: ProductState }
export interface ShoppingGroup { roomId: string; roomName: string; rows: ShoppingRow[] }

/** Parses a user-entered price ("1 299,90") in euros. */
export function parsePrice(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Products of a variant (variant products first within each room), grouped by room order. */
export function groupProducts(project: Project, variantId: string): Array<{ roomId: string; roomName: string; products: Product[] }> {
  const variant = project.furnishing.variants.find((v) => v.id === variantId);
  const all = [...(variant?.products ?? []), ...project.furnishing.common.products];
  const rooms = project.building.levels.flatMap((l) => l.rooms);
  return rooms
    .map((r) => ({ roomId: r.id, roomName: r.name, products: all.filter((p) => p.room === r.id) }))
    .filter((g) => g.products.length);
}

/** Shopping list state (bought, user prices), persisted in this browser. */
export function useShoppingList(project: Ref<Project | null>, variant: Ref<string>) {
  const saved = ref<Record<string, ProductState>>({});
  const key = computed(() => (project.value ? `pantoufle:${project.value.meta.id}:shopping:v1` : null));

  watch(key, (k) => {
    if (!k) return;
    try { saved.value = JSON.parse(localStorage.getItem(k) ?? '{}') ?? {}; } catch { saved.value = {}; }
  }, { immediate: true });

  function persist() {
    if (!key.value) return;
    try { localStorage.setItem(key.value, JSON.stringify(saved.value)); } catch { /* private mode */ }
  }
  function update(id: string, patch: ProductState) {
    saved.value = { ...saved.value, [id]: { ...saved.value[id], ...patch } };
    persist();
  }

  const groups = computed<ShoppingGroup[]>(() => {
    if (!project.value) return [];
    return groupProducts(project.value, variant.value).map((g) => ({
      roomId: g.roomId,
      roomName: g.roomName,
      rows: g.products.map((p) => ({ product: p, state: saved.value[p.id] ?? {} })),
    }));
  });

  const summary = computed(() => {
    let total = 0, done = 0, todo = 0, count = 0;
    for (const g of groups.value) for (const { product, state } of g.rows) {
      count++;
      const price = parsePrice(state.price) ?? product.price ?? null;
      if (price == null) todo++; else total += price * product.qty;
      if (state.done) done++;
    }
    return { total, done, todo, count };
  });

  return { groups, summary, update };
}

export const formatEuros = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;

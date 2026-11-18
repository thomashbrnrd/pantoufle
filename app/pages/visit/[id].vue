<script setup lang="ts">
const route = useRoute();
const id = computed(() => String(route.params.id));
useHead({ title: 'Visite 3D' });
</script>

<template>
  <ClientOnly>
    <VisitApp :project-id="id" />
    <template #fallback>
      <div class="loading">Chargement de la visite…</div>
    </template>
  </ClientOnly>
</template>

<style scoped>
.loading {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  color: #f3efe7;
  font-family: var(--serif);
  font-size: 20px;
}
</style>

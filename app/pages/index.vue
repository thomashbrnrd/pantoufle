<script setup lang="ts">
import { ProjectIndex } from '~/engine/schema';
import rawIndex from '~~/public/projects/index.json';

// Bundled at build time (static hosting): the list ships with the page.
const projects = ProjectIndex.parse(rawIndex);
useHead({ title: 'Pantoufle — visites 3D' });
</script>

<template>
  <main class="home">
    <section class="card">
      <h1 class="wordmark">Pantoufle<small>Visites 3D d’appartements</small></h1>
      <ul class="projects">
        <li v-for="p in projects" :key="p.id">
          <NuxtLink :to="`/visit/${p.id}`" class="project">
            <strong>{{ p.name }}</strong>
            <span>{{ p.subtitle }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.home {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px 16px;
  background: radial-gradient(120% 90% at 50% 20%, #3a4656, #1d2530);
}
.projects { list-style: none; margin: 26px 0 0; padding: 0; display: grid; gap: 10px; }
.project {
  display: grid;
  gap: 2px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  text-decoration: none;
}
.project:hover { background: var(--chip); }
.project strong { font-family: var(--serif); font-size: 20px; }
.project span { color: var(--ink-soft); font-size: 14px; }
</style>

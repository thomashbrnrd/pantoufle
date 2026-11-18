// https://nuxt.com/docs/api/configuration/nuxt-config
import { readFileSync } from 'node:fs';

const projects: Array<{ id: string }> = JSON.parse(readFileSync('public/projects/index.json', 'utf8'));

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    // baseURL comes from NUXT_APP_BASE_URL (set to /<repo>/ by the GitHub Pages workflow).
    head: {
      htmlAttrs: { lang: 'fr' },
      title: 'Pantoufle — visites 3D',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        // Private plans: keep the site out of search engines.
        { name: 'robots', content: 'noindex, nofollow' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap',
        },
      ],
    },
  },
  nitro: {
    prerender: { routes: ['/', ...projects.map((p) => `/visit/${p.id}`)] },
  },
  typescript: { strict: true },
});

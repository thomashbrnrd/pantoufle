# Pantoufle

Visites 3D d’appartements dans le navigateur (Nuxt 4 + three.js) : visite à la première personne
(clavier/souris, manette PS5, tactile), vue d’ensemble, existant/aménagé, variantes, ambiance jour/soir,
liste de courses.

```
npm install
npm run dev        # http://localhost:3000
npm run validate   # vérifie les projets (schéma, références, assets)
npm test
```

Un projet = des fichiers JSON dans `public/projects/<id>/` — voir [docs/data-model.md](docs/data-model.md).
Contexte complet, conventions et décisions : [CLAUDE.md](CLAUDE.md).

Crédits des modèles 3D : canapé et pouf © Wayfair, plante © Darmstadt Graphics Group (CC BY 4.0),
vase fleuri (CC0) — KhronosGroup/glTF-Sample-Assets. HDRI et ciels : Poly Haven (CC0).

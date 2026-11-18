# Modèle de données d’un projet

Un projet = un dossier `public/projects/<id>/` listé dans `public/projects/index.json`.
Le schéma fait foi : [`app/engine/schema.ts`](../app/engine/schema.ts) (zod). `npm run validate`
vérifie le schéma **et** les références croisées (matériaux, catalogue, pièces, items, variantes, assets).

| Fichier | Contenu |
|---|---|
| `project.json` | nom, crédits, point de départ, bornes, vue d’ensemble, environnement (HDRI, ciels, soleil, alentours) |
| `building.json` | l’**existant** : niveaux → murs, pièces, plafond, équipements (`fixtures`) |
| `furnishing.json` | l’**aménagement** : items communs + variantes, et la liste de courses (`products`) |
| `materials.json` | bibliothèque de matériaux PBR (couleur, rugosité, texture procédurale, lueur du soir) |
| `catalog.json` | objets réutilisables (chaise, tabouret) référencés par `ref` |
| `models/`, `env/` | glTF/GLB, HDRI et ciels |

## Conventions

- Unités **cm**, repère plan : **X est, Y sud, Z haut**. three.js : `x = X/100, y = Z/100, z = Y/100`.
- **Rotation** (items) et **yaw** (départ) : degrés autour de la verticale, sens anti-horaire sur le plan
  vu de dessus nord en haut (même signe que `rotation.y` de three.js). Yaw 0 = nord, 90 = ouest, 180 = sud.
- **Murs** : axe `a → b`, faces à ± `thickness/2`. `faces.left/right` = face à gauche/droite quand on marche
  de `a` vers `b` sur le plan nord en haut (en marchant vers l’est, la gauche est le nord).
  Ouvertures : `from/to` = distances depuis `a` le long de l’axe (pas des coordonnées absolues),
  `z = [allège, linteau]`. `extend` prolonge le mur au-delà de `a`/`b` (fermeture des angles).
- **Équipements de l’existant** (`fixtures`) : parts en **coordonnées absolues** (pas de `position`),
  directement comparables aux cotes du plan.
- **Items d’aménagement** : `position` = origine locale (centre de l’emprise, z = point le plus bas),
  parts en **coordonnées locales** → déplacer un meuble = changer `position`/`rotation`.
- **Matériaux** : les UV sont générées en cm ; une texture se répète tous les `texture.tile` cm.
  Les couleurs sont des sRGB réels (gestion des couleurs three.js active).
- **Lumières** (`type: light`) : intensité en **candela**, portée en cm ; allumées uniquement en ambiance « soir ».
- **Collisions** : `collide: true` sur une part (box, cylinder, beam) ou `colliders` explicites sur l’item.
  Une collision n’est active que si son item est affiché (meublé / variante courante).

## Parts disponibles

`box` (min/max, matériau unique ou par face n/s/e/w/top/bottom) · `cylinder` (from/to, axe quelconque) ·
`sphere` (scale) · `polygon` (sol horizontal, `facing: down` pour un plafond) · `disc` (miroir, hublot) ·
`curtain` (voilage plissé) · `posts` (barreaux instanciés) · `beam` (lisse entre deux points) ·
`model` (glTF ajusté à `fit` w/d/h, surcharges de matériaux) · `light`.

## Liste de courses

`products` (communs ou par variante) : `id` stable (sert de clé aux prix saisis et cases « acheté »
stockés dans le navigateur), `room` (id de pièce, ordre d’affichage = ordre des pièces), `qty`, `items`
(lien vers les items 3D), `price` de référence optionnel.

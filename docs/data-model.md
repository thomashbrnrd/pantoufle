# Modèle de données d’un projet

Un projet = un dossier `public/projects/<id>/` listé dans `public/projects/index.json`.
Le schéma fait foi : [`app/engine/schema.ts`](../app/engine/schema.ts) (zod). `npm run validate`
vérifie le schéma **et** les références croisées (matériaux, catalogue, pièces, items, variantes, assets).

| Fichier | Contenu |
|---|---|
| `project.json` | nom, crédits, point de départ, bornes, vue d’ensemble, environnement (HDRI, ciels, nord, soleil, site) |
| `building.json` | l’**existant** : niveaux → murs, pièces, plafond, équipements (`fixtures`) |
| `furnishing.json` | l’**aménagement** : items communs + variantes, et la liste de courses (`products`) |
| `materials.json` | bibliothèque de matériaux PBR (couleur, rugosité, texture procédurale, lueur du soir) |
| `catalog.json` | objets réutilisables (chaise, tabouret) référencés par `ref` |
| `spec.json` | **fiche technique** (facultative) : sources, site, tableau des finitions, menuiseries, équipements |
| `models/`, `env/` | glTF/GLB, HDRI et ciels |

## Conventions

- Unités **cm**, repère plan : **X est, Y sud, Z haut**. three.js : `x = X/100, y = Z/100, z = Y/100`.
- **Rotation** (items) et **yaw** (départ) : degrés autour de la verticale, sens anti-horaire sur le plan
  vu de dessus nord en haut (même signe que `rotation.y` de three.js). Yaw 0 = nord, 90 = ouest, 180 = sud.
- **Murs** : axe `a → b`, faces à ± `thickness/2`. `faces.left/right` = face à gauche/droite quand on marche
  de `a` vers `b` sur le plan nord en haut (en marchant vers l’est, la gauche est le nord).
  Ouvertures : `from/to` = distances depuis `a` le long de l’axe (pas des coordonnées absolues),
  `z = [allège, linteau]`. `extend` prolonge le mur au-delà de `a`/`b` (fermeture des angles) ; quand le bout
  d’un mur est noyé dans un autre (angle à recouvrement), le moteur le recule de 3 mm pour éviter le
  scintillement des faces superposées (`trimBuriedEnds`, `app/engine/walls.ts`).
- **Portes** : une ouverture peut porter un vantail `door` que le visiteur ouvre/ferme
  (`hinge: start|end` = jambage des paumelles, `start` étant le plus proche de `a` ; `side: left|right` = côté
  du mur vers lequel la porte s’ouvre, même convention que les faces ; `material`, `handle` (béquilles),
  `faces.left/right` si les deux faces diffèrent, `thickness` 4, `angle` 90, `open` true). Fermée, la porte affleure la face côté ouverture ; sa collision suit
  l’animation. Géométrie pure : `app/engine/doors.ts`.
- **Équipements de l’existant** (`fixtures`) : parts en **coordonnées absolues** (pas de `position`),
  directement comparables aux cotes du plan.
- **Items d’aménagement** : `position` = origine locale (centre de l’emprise, z = point le plus bas),
  parts en **coordonnées locales** → déplacer un meuble = changer `position`/`rotation`.
- **Matériaux** : les UV sont générées en cm ; une texture se répète tous les `texture.tile` cm.
  Les couleurs sont des sRGB réels (gestion des couleurs three.js active).
  Textures photo (`maps`) : `color`, `normal` (OpenGL), `arm` (occlusion R, rugosité G, métal B), répétées tous
  les `maps.tile` cm, `rotation` en degrés, `aoIntensity`. `color` × `colorScale` teinte la photo (recalage
  sur une photo de l'appartement). Chemins relatifs au dossier du projet ; provenance dans `sources.json`.
- **Ciels** (`environment.background.day|night`) : `{ src, intensity, rotation }` (rotation en degrés).
- **Orientation et soleil** : `environment.north` = azimut géographique de l’axe −Y du plan (« nord du plan ») ;
  `sun = { azimuth, elevation }` en degrés vrais (azimut depuis le nord, sens horaire).
- **Plafonds** : `level.ceiling` = un plan ou une liste de plans (appartement, palier) ; masqués en vue d’ensemble.
- **Site** (`environment.surroundings`) : `groundZ` (niveau de la rue sous le plancher), `surfaces` (rues,
  trottoirs, pelouses), `blocks` (prismes `polygon` × `z`, motif d’étages `facade`, `overview: false` = masqué
  en vue d’ensemble, ex. étages supérieurs), `railings` (muret + garde-corps le long d’un tracé), `trees`,
  `treeRows`, `distant` (immeubles génériques à l’horizon). Le motif d’étages (2,90 m) est calé sur le plancher
  de l’appartement. Volumes simplifiés : ne pas y mettre de noms de rue ni de bâtiment (dépôt public).
- **Lumières** (`type: light`) : intensité en **candela**, portée en cm ; allumées uniquement en ambiance « soir ».
- **Collisions** : `collide: true` sur une part (box, cylinder, beam) ou `colliders` explicites sur l’item.
  Une collision n’est active que si son item est affiché (meublé / variante courante).

## Parts disponibles

`box` (min/max, matériau unique ou par face n/s/e/w/top/bottom) · `cylinder` (from/to, axe quelconque) ·
`sphere` (scale) · `polygon` (sol horizontal, `facing: down` pour un plafond) ·
`prism` (polygone du plan extrudé entre deux hauteurs : muret courbe…) ·
`device` (appareillage mural détaillé généré par le moteur : `modules` socket, switch, switch-double, shutter,
rj45, tv, blank, socket-outdoor, dcl, intercom, thermostat ; `at` = centre de la plaque sur le mur, `facing`
n/s/e/w ; plaques Essensya 8 × 8 cm, entraxe 7,1 cm ; fusionné par matière, quelques draw calls) · `disc` (miroir, hublot) ·
`curtain` (voilage plissé) · `posts` (barreaux instanciés) · `beam` (lisse entre deux points) ·
`model` (glTF ajusté à `fit` w/d/h, surcharges de matériaux) · `light`.

## Liste de courses

`products` (communs ou par variante) : `id` stable (sert de clé aux prix saisis et cases « acheté »
stockés dans le navigateur), `room` (id de pièce, ordre d’affichage = ordre des pièces), `qty`, `items`
(lien vers les items 3D), `price` de référence optionnel.

## Fiche technique (`spec.json`)

Organisée comme les documents d’une agence d’architecture, pour qu’on puisse s’y retrouver comme dans un
dossier de consultation des entreprises :

- `sources` : documents d’origine (`notice`, `plan`, `photos`…), `private: true` = conservés **hors du
  dépôt** (données personnelles) ; seul leur contenu technique est recopié.
- `site` : orientation, niveau, bâtiment, vis-à-vis.
- `spaces` : une entrée par pièce du bâti (`room`) = **tableau des finitions** (`floor`, `skirting`, `walls`,
  `ceiling`) + **équipements** par lot (`lot` : `electricite`, `plomberie-sanitaires`, `chauffage-ventilation`…).
- `openings` : **nomenclature des menuiseries**, une entrée par ouverture du bâti (`opening`).
- `systems` : installations communes au logement (chauffage, ECS, ventilation, électricité).

Chaque entrée : `description`, `product`, `size`, `finish`, `material` (matériau 3D), `items` (objets 3D),
`status` (`contrat` = notice/plan, `releve` = mesuré, `photo`, `hypothese` = à vérifier), `sources`
(`{ doc, page }`) et `todo` (question ouverte). Le chargement vérifie que pièces, ouvertures, items,
matériaux et sources existent. Correspondance IFC (export BIM futur) : pièce ↔ `IfcSpace`, finitions ↔
`IfcCovering`, menuiseries ↔ `IfcDoor`/`IfcWindow`, équipements ↔ `IfcElement` (classés par lot).

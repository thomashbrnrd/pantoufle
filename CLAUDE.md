# CLAUDE.md — Visites 3D d’appartements (projet pilote : Arboreal 143, Rueil-Malmaison)

Ce fichier transmet à Claude Code tout le contexte établi dans une longue conversation claude.ai
(modélisation Sweet Home 3D + prototype three.js). Lis-le en entier avant toute modification.
Langue de travail avec l’utilisateur : **français**. Code, noms de fichiers et commits : anglais.

---

## 1. Vision produit

Application web de **visite 3D d’appartements** :

- **Démo immédiate** : l’appartement de l’utilisateur (lot 143, résidence Arboreal, Rueil-Malmaison).
- **Visite à la première personne** dans le navigateur : clavier/souris, **manette PS5** (Gamepad API), tactile.
- **Vue d’ensemble** orbitale (maquette sans plafond).
- **Bascule existant / aménagé** (appartement livré vs projet d’aménagement).
- **Variantes d’aménagement** comparables (ex. « Bar » vs « Table ronde »).
- **Ambiance jour / soir** (éclairage réel des luminaires le soir).
- **Liste de courses** par variante : articles, quantités, prix saisis, statut acheté, budget total.
- **À terme** : plusieurs appartements / projets, plusieurs utilisateurs, partage par lien,
  édition des aménagements (déplacer un meuble), import de plans.

Style de l’appartement : **japandi / wabi-sabi** (chêne clair, lin, blanc cassé, céramique, noir mat en touches).

---

## 2. Point de départ technique

- **Prototype** : `legacy/arboreal143.html` (fichier unique, ~4,3 Mo), publié en artifact privé :
  https://claude.ai/artifact/RBGnRXh3eAH9bzrby9z6iY
  - three.js **r128** (UMD), géométrie codée en dur, assets en base64.
  - **Porté en P0** (nov. 2026) : géométrie → `public/projects/arboreal-143/*.json`, assets extraits en
    fichiers. Ne plus le modifier ; il sert de **référence de parité** (on peut le rendre avec Playwright
    depuis les mêmes points de vue, cf. §10).
- **Maquette de référence Sweet Home 3D** : `~/Documents/Arboreal_143.sh3d` (≈ 6 Mo).
  - Un MCP Sweet Home 3D est installé sur le Mac de l’utilisateur ; il peut être ajouté à Claude Code.
  - Rendus enregistrés : `~/Documents/Arboreal_rendus/` (01 à 05).
  - Copie ancienne (obsolète, ne pas utiliser) : `/Users/Shared/Arboreal_143.sh3d`.

### Leçons tirées du MCP Sweet Home 3D (à respecter si tu l’utilises)
1. **Toujours vérifier la scène (`get_state`) avant `save_home`** : Sweet Home 3D redémarre parfois ;
   une sauvegarde aveugle a déjà écrasé le projet par une scène vide (il a fallu tout reconstruire).
2. Les murs sont définis par leur **axe** : face intérieure = axe ± épaisseur/2. Une erreur d’axe a fait
   traverser la cuisine à travers un mur.
3. Les objets **groupés** ne sont pas modifiables : dégrouper → modifier → regrouper.
4. Le MCP ne texture que murs et sols (pas les meubles ni les formes générées).
5. Éviter les faces coplanaires (z-fighting) : raccorder les murs en angle (`connect_walls`) plutôt que
   les superposer ; décaler les habillages de quelques mm du bon côté.
6. Rendu `high` (Sunflow) : rester ≤ 780×520 via MCP (au-delà, timeout de 4 min).

---

## 3. Conventions de coordonnées

- Unités **cm**. Repère plan : **X vers l’est**, **Y vers le sud**, **Z vers le haut**.
- Origine (0,0) : face intérieure du mur ouest × face intérieure du mur nord de la salle d’eau.
- Façade vitrée et terrasse au **sud** (Y ≈ 660–840). Palier/couloir au nord.
- Hauteur sous plafond : **250 cm**. Hauteur des portes intérieures : 214 cm.
- Passage three.js (prototype) : `x = X/100`, `z = Y/100`, `y = Z/100` (mètres).
- Mur décrit par : axe (x0,y0)→(x1,y1), épaisseur `t`, hauteur, ouvertures `[a0, a1, zBas, zHaut]`
  le long de l’axe.

---

## 4. Plan coté validé (cotes Cogedim vérifiées une à une)

Surfaces plan Cogedim : entrée 2,85 m², séjour/cuisine 19,36 m², chambre 10,74 m², salle d’eau 5,51 m²,
total 38,46 m² ; terrasse 10,42 m². Cotes : SdE 209 × 296, entrée 130 × 275, placard PL 67,
cuisine linéaire 251, chambre 312 × 320, séjour 343, terrasse 670 × 160.

### 4.1 Murs extérieurs (t = 20)
| Mur | Axe | Ouvertures |
|---|---|---|
| Ouest | x=-10, y -10→670 | — (face ext. brique) |
| Façade sud | y=670, x -10→673 | chambre porte-fenêtre X 158,06–249,5 (1 vantail, h≈221) ; séjour baie X 356–576 (2 vantaux, h 222) |
| Est | x=673, y 79→670 | — (face ext. brique) |
| Nord cuisine | y=79, x 353,5→673 | face int. y=89 |
| Retour palier | x=353,5, y 3,5→79 | face int. x=343,5 |
| Nord entrée | y=3,5, x 210,5→353,5 | porte palière X 223,5–316,5 (h 214), face int. y=13,5 |
| Nord SdE | y=-10, x -10→210,5 | face int. y=0 |

### 4.2 Murs intérieurs
| Mur | Axe | t | Notes |
|---|---|---|---|
| SdE / entrée | x=210,5, y -10→286 | 6 | porte SdE Y 130,5–213,5 (ouvre vers l’entrée) ; côté SdE **peint** |
| Petit mur angle SdE | y=290, x 173,4→210,5 | 8 | raccordé au retour |
| Mur porte chambre | y=290, x 210,5→316 | 8 | porte chambre X 229–312 (ouvre dans la chambre) |
| Retour | x=173,4, y 290→327,8 | 6,8 | côté SdE peint |
| SdE / chambre | y=327,8, x 0→173,4 | 5,6 | côté SdE faïence |
| Cloison chambre/séjour | x=316, y 286→563 | 7 | |
| **Mur porteur** | x=311,5, y 563→670 | 16 | affleure côté séjour (319,5), **saillie côté chambre** (303,5) |
| Cloison placard/cuisine | x=409, y 89→198 | 5 | |

### 4.3 Pièces (polygones, cm)
- Salle d’eau : (0,0)(207,5,0)(207,5,286)(176,8,286)(176,8,325)(0,325) — sol grès 60×60 beige.
- Entrée : (213,5,13,5)(343,5,13,5)(343,5,286)(213,5,286) — parquet.
- Cuisine (niche) : (343,5,89)(663,89)(663,198)(343,5,198) — carrelage anthracite 60×60.
- Séjour : (343,5,198)(663,198)(663,660)(319,5,660)(319,5,286)(343,5,286) — parquet.
- Chambre : (0,330,6)(176,8,330,6)(176,8,294)(312,5,294)(312,5,563)(303,5,563)(303,5,660)(0,660) — parquet.
- Terrasse : (-20,680)(683,680)(683,740)(677,771)(660,797)(634,814)(603,820)(-20,820) — dalles 60×60 sur plots.

### 4.4 Salle d’eau (existant, d’après photos)
- Gaine technique X 0–56 Y 0–81 (faïence jusqu’à 214, peint au-dessus, trappe blanche ~X 28, Z 118–148).
- Bâti-support WC X 0–56 Y 81–110 h 110 (tablette carrelée), plaque de commande blanche Z 92–107.
- WC suspendu centre (35, 139), orienté vers le sud.
- Cloison WC/douche x=61,5 t 11, Y 19–110, h 214 (+ peint au-dessus).
- Linteau douche X 56–207,5 Y 0–30 ; sa face sud = fond de douche **faïence décor ondulé**.
- Receveur 118 × 76 (X 67–185, Y 30–106), paroi vitrée ; caisson carrelé X 185–207,5 Y 30–110.
- Meuble vasque 80 cm chêne foncé 2 tiroirs X 83–163 Y 279–325, plan céramique à 85 cm.
- Miroir rond LED Ø 75, centre (123, Z 152) sur le mur sud (y≈324).
- Sèche-serviettes blanc 147 cm sur le mur est (X 197–203, Y 228–283, Z 30–177), à droite de la porte.
- Coffrage bas carrelé h 14 : X 0–12 Y 110–325 et X 12–83 Y 313–325 ; attentes lave-linge (robinet, évacuation, prise).
- Faïence 30×60 posée horizontale **jusqu’à 214 cm** (hauteur d’huisserie), peinture blanche au-dessus.
- VMC en haut au-dessus du WC ; plafonnier.

### 4.5 Autres éléments de l’existant
- Placard d’entrée PL : X 343,5–406,5, Y 89–158, portes coulissantes face à l’entrée (ouest).
- Gaine ETEL (tableau électrique) : X 343,5–406,5, Y 168–198, deux portes blanches superposées face sud.
- Radiateurs acier blancs (h 15–100) : séjour X 320–326 Y 538–628 ; chambre X 297–303 Y 566–632.
- Coffres de volets roulants intérieurs blancs Z 222–250 avec grille d’entrée d’air (séjour X 351–581, chambre X 152,75–254,75).
- Plinthes blanches 10 cm (pièces parquet).
- Points lumineux plafond : entrée (278,150), séjour (491,430), chambre (156,495), SdE (115,200).
- Prises/interrupteurs relevés sur photos : chambre (près porte x=312,5 y≈345 ; sud x≈65 ; volet x≈140 Z110 ;
  ouest y≈391 et y≈620), séjour (est y≈540 ; volet x≈599 Z110 ; près baie x≈340 Z30/Z110 ; bloc TV+RJ45
  sur cloison y≈520), cuisine (crédence doubles x≈519 Z104/Z117 ; hautes Z170 ; basses Z17 ; VMC x≈468 Z225).
- Niche cuisine : évacuation et arrivées d’eau à gauche (x≈433–446).
- Terrasse : muret blanc h 30 + garde-corps à barreaux **cuivrés** (main courante h ~105, barreaux tous les 12 cm)
  suivant la façade sud, l’arrondi sud-est et le retour est ; pare-vue verre dépoli cadre crème à l’ouest
  (x≈-22, Y 680–826, h 190) ; grands **cadres en tôle cuivrée** en saillie (15 cm) autour des deux baies ;
  applique rectangulaire noire (Z 180–212) + prise étanche (Z 32) centrées sur le trumeau x=302,75 ;
  caniveaux à grille devant les baies ; façade **brique crème** fine (≈40 × 6,5 cm).
- Robinet de puisage terrasse prévu par la notice (position inconnue). Entrée (vidéophone, thermostat) : non relevée.

### 4.7 Palier et site (ajoutés le 26 nov. 2026, en partie hypothétiques)
- **Porte palière** fermée au départ, **paumelles côté ouest** (vidéo de livraison), face intérieure **blanche**,
  face palier **noire** (confirmé par l'utilisateur). Sonnette côté palier. **Vidéophone + interrupteur** sur le
  retour de mur à gauche en entrant (x = 343,5, y ≈ 38–50). **Placard d'entrée : portes miroir** à profils alu.
- **Palier** modélisé d'après la notice (moquette, murs peints, plinthes bois) et le plan de situation :
  couloir central ≈ 1,70 m (Y −188 → −20), ascenseur supposé en face de la porte, poche devant le mur nord
  de la cuisine. Non relevé : à vérifier sur place.
- **Orientation** (validée par l'utilisateur : « prendre celle du plan ») : façade terrasse vers ≈ 190°
  (sud-sud-ouest), roses du plan du lot. `environment.north = 10`. (Le plan de masse, ≈ 206°, est écarté.)
- **Site** (`environment.surroundings`) : lot au **rez-de-jardin + 4** (sol de la rue estimé à −11,60 m),
  bâtiment R+7 ; voisins de palier et étages supérieurs en volumes ; terrasses et garde-corps prolongés chez
  le voisin ouest et aux 3 étages inférieurs (plan d'étage courant) ; bâtiment voisin R+7 à ≈ 6,8 m au nord,
  autres bâtiments de la résidence autour du jardin, rues arborées au sud et à l'ouest. Immeubles hors
  résidence = génériques (hauteurs inconnues, volontairement sous notre niveau au sud).
  **Ne pas écrire de noms de rue ni de bâtiment dans le dépôt.**
- **Pas de terrasse au-dessus** de la nôtre (confirmé) : terrasse à ciel ouvert, étages supérieurs en façade.
- Chambre : **pas de placard**, seulement l'emplacement préconisé du plan (confirmé).
- Robinet de puisage terrasse : position inconnue, même pour l'utilisateur.

### 4.6 Notice descriptive (contrat de réservation) — points utiles
Sources : `Contrat de réservation arboreal.pdf` (83 p. : contrat, diagnostics, notice V7 p. 42–78, plan de vente
p. 23, plans de masse / vis-à-vis p. 81–82) et `Notice+descriptive.pdf` (même notice V7, 37 p.), posés par
l'utilisateur **à la racine du dépôt mais ignorés** (`*.pdf` dans `.gitignore`). Données personnelles et dépôt
**public** : ne jamais les commiter ni recopier leurs données d'identité ; n'en reprendre que le technique.
Le détail structuré (avec n° de page) est dans **`public/projects/arboreal-143/spec.json`** (fiche technique,
cf. `docs/data-model.md`) : c'est là qu'il faut ajouter toute nouvelle information (source + statut).
- Parquet **BOEN 138 monolame contrecollé** ép. 13 mm, pose droite ; plinthes 10 cm pin/médium peint blanc.
- SdE : faïence **30×60** ARTE/DECOCERAM jusqu'à hauteur d'huisserie ; sol grès **60×60** ; plinthes carrelage.
- Cuisine ouverte : grès 60×60 (ou 15×60 effet bois), **plinthes carrelage assorties**.
- Terrasse : dalles grès cérame **ARTE 60×60** sur plots ; garde-corps **alu thermolaqué** à barreaudage
  (teinte or/champagne sur photos — matériau `copper` dans le projet) ; pare-vue verre cadre laqué ;
  prise étanche + applique + robinet de puisage (terrasse > 10 m²).
- Murs/plafonds : peinture acrylique blanche **soyeuse** (satinée dans les pièces humides).
- Portes intérieures **Malerba MBS024** rainurées h 2,14 ; béquilles **EUXOS LOGINOX LG 105** inox brossé sur
  rosace ronde ; porte palière Malerba Isoblinde 41 dB.
- Placard entrée : portes coulissantes **SOGAL Initial Alu** (miroir ou décor) ; ETEL Cofrelec.
- SdE : meuble-vasque **Culina Horizon 80** 2 tiroirs + miroir éclairant rond Ø 75 ; receveur **Kinedo Kinerock
  Evo 80×120** ; pare-douche **Kinedo Smart Design Duo 70+40** ; colonne **Grohe Bau Classique** (tête 210) ;
  mitigeur **Grohe Eurosmart** ; WC **Ideal Standard Okyris** sur bâti **Nicoll Solemur** ;
  sèche-serviettes **Acova Cala** blanc 147 cm, tubes ronds, asymétrique.
- Radiateurs **Finimetal T6 Plan** horizontaux ; entrées d'air dans les coffres de volets roulants.
Parquet chêne contrecollé BOEN 138 mm pose droite ; portes Malerba acoustiques 41 dB, rainurées, à peindre ;
volets roulants électriques ; chauffage urbain + ECS collective ; NF Habitat HQE ; chape flottante (ne pas percer le sol) ;
cuisine : attentes LV, four (20 A) séparé de la plaque (32 A), hotte ; « aucun élément de cuisine fourni hors pack ».

---

## 5. Aménagement validé (variante A « Bar »)

### Cuisine (conception Ikea de l’utilisateur, façades **chêne lisses, push-pull**)
- Bas X 411–600, Y 89–149 (socle 10, façades Z 10,5–85,5) : 20 / évier 60 / LV 45 / four sous plaque 60 (+ tiroir).
- Plan de travail **effet béton** anthracite Z 86–90 ; évier inox ; plaque induction ; crédence zellige blanc cassé Z 90–140.
- Hauts X 411–600, Y 89–127,5, Z 140–230 (2×40 sur la VMC + 45 + 60 au-dessus de la hotte intégrée Z 151–165).
- Colonne frigo intégré X 600–660 (Z 10–230), fileur colonne/mur 660–663.
- **Fileur haut jusqu’au plafond** Z 230–250 sur toute la ligne (hauts alignés avec la colonne).
- VMC derrière le meuble haut gauche : l’utilisateur prévoit un « trucage » pour laisser passer l’air.

### Séjour
- **Bar** jusqu’au mur est : caisson X 420–663 Y 257–307 h 87, plateau chêne X 415–663 Y 251,5–336,5 à 91 cm ;
  3 tabourets bois assise 65 (x 460/510/560, y 350). Passage ~1 m avec la cuisine.
- Variante B : table ronde chêne Ø 100 centre (505, 290) + 4 chaises noires (pas de bar).
- Canapé 2 places lin écru 200 × 88 contre le mur est (X 576–664, Y 390–590).
- Table basse chêne 110 × 58 × 35 (X 455–513, Y 415–525) ; tapis laine bouclée écru 170 × 240 (X 400–570, Y 350–590).
- TV 55" **murale** sur la cloison (X 320–326, Y 383–507, Z 70–140) + meuble TV **suspendu** chêne 180 (Z 22–54).
- Suspension papier type Akari au-dessus du bar (505, 294, Z ~180) ; lampadaire (645, 372).
- Voilages lin naturel sur **tringle bois chêne Ø 28** fixée au plafond (pas de rail) : séjour X 328–658,
  chambre X 140–292, plis repliés sur les côtés.
- Plantes : grande près du canapé (≈605, 598), moyenne près de la baie (≈368, 606) ; pouf ; vases.

### Chambre (réorganisée pour la circulation)
- Lit 140 × 200 tête au **nord** (contre la SdE) : X 20–170, Y 331–541 ; chevet X 172,5–207,5.
- Penderies 2 × 90, prof. 60, h 240 **contre la cloison du séjour** : X 252,5–312,5, Y 380–560.
- Bureau chêne 100 cm dans l’angle sud-ouest (X 0–100, Y 592–660) ; passage 82 cm lit/penderies ;
  porte-fenêtre libre.
- Remarque : lave-linge juste derrière la tête de lit (côté SdE).

### Palette
peinture #F3F1EC · chêne façades #CDB896 · caissons #8C765A · plan béton #4A4846 · lin #E6DED0 ·
faïence SdE #C8B8A5 · sol SdE #D4C9BA · sol cuisine #404042 (joints #969491) · dalles terrasse #CCC0B2 ·
brique #E5DBC4 · cuivre #B8873A · vasque chêne foncé #5A4232.

---

## 6. Assets et licences

| Asset | Source | Licence |
|---|---|---|
| Canapé (GlamVelvetSofa) | KhronosGroup/glTF-Sample-Assets (Wayfair) | **CC BY 4.0** — créditer |
| Pouf (SpecularSilkPouf) | idem (Wayfair) | **CC BY 4.0** — créditer |
| Plante (DiffuseTransmissionPlant) | idem (Darmstadt Graphics Group) | **CC BY 4.0** — créditer |
| Vase fleuri (GlassVaseFlowers) | idem | CC0 |
| HDRI apartment / sky / night | Poly Haven via npm `@pmndrs/assets` | CC0 |
| Textures (parquet, carrelages, faïence, brique, béton, placage, lin) | générées (procédural) | maison |

Pipeline d’optimisation utilisé : `@gltf-transform` (prune, dedup, textures 512 px JPEG via sharp,
weld + simplify meshoptimizer, quantize **hors POSITION** pour compatibilité r128).
À viser ensuite : Poly Haven (modèles, textures, HDRI 2k–4k), ambientCG (matières PBR), Sketchfab (CC, licence à
vérifier une par une). Ikea et Sklum ne fournissent pas de modèles 3D → reconstructions sur mesure.

---

## 7. Architecture (en place depuis P0)

### Principes
- **La scène est une donnée, pas du code** : un projet = fichiers JSON (bâti + variantes) + assets.
- Bâti (« existant ») séparé de l’aménagement (« variantes ») ; une variante = items ajoutés aux items communs.
- Un item = parts (primitives, glTF, lumières) ou `ref` vers le catalogue + `position`/`rotation`.
- Modèle de données détaillé et conventions : **[docs/data-model.md](docs/data-model.md)** ;
  schéma faisant foi : `app/engine/schema.ts` (zod).

### Stack (décidée avec l’utilisateur)
- **Nuxt 4** (Vue 3, TypeScript), **npm**. (L’utilisateur a explicitement écarté Next.js.)
- **three.js r187** en modules ES, WebGLRenderer, gestion des couleurs active, éclairage physique
  (intensités ×π par rapport au prototype r128 ; lampes en candela). `HDRLoader` (RGBELoader est déprécié),
  `THREE.Timer` (Clock déprécié), `PCFShadowMap` (PCFSoft déprécié).
- **zod 4** : validation des JSON au chargement (navigateur) et en CI (`npm run validate`).
- **Hébergement : GitHub Pages** (export statique `nuxt generate`, preset `github_pages`,
  `NUXT_APP_BASE_URL=/<repo>/`). Workflow : `.github/workflows/deploy.yml`.
- Plus tard (P3) : back Postgres + auth + stockage d’assets (ex. Supabase), partage par lien.
- **Publié** (26 nov. 2026, décision de l’utilisateur) : https://thomashbrnrd.github.io/pantoufle/ —
  le dépôt `thomashbrnrd/pantoufle` a été rendu **public** (plan GitHub gratuit : Pages impossible sur
  dépôt privé). Chaque push sur `main` redéploie. Tout ce qui est commité est donc public :
  **ne jamais commiter** photos de l’appartement, PDF de réservation, adresse exacte ni données perso.
  `noindex` + `robots.txt Disallow` en place.

### Organisation du code
```
app/engine/        moteur indépendant du framework (aucun import Vue)
  schema.ts        modèle de données (zod) — source de vérité des types
  load.ts          chargement + validation + références croisées
  walls.ts         découpe des murs autour des ouvertures (pur, testé)
  doors.ts         géométrie des vantaux de porte (pivot, emprise selon l’angle) (pur, testé)
  collision.ts     collisions 2D (OBB, segments), point-in-polygon (pur, testé)
  geometry.ts      part → mesh three.js (UV en cm)
  materials.ts     matériaux PBR depuis materials.json
  textures.ts      textures procédurales (canvas) portées du prototype
  build.ts         scène complète + colliders + lumières depuis un Project
  viewer.ts        classe Viewer : rendu, ambiances, contrôles clavier/souris/tactile/manette
app/components/    VisitApp (état UI ↔ Viewer), VisitIntro, ShoppingList
app/composables/   useShoppingList (prix et statuts dans localStorage)
app/pages/         / (liste des projets), /visit/[id]
public/projects/   index.json + un dossier par projet (JSON + models/ + env/)
scripts/           validate-projects.ts, screenshot.ts
tests/             vitest (moteur + données arboreal-143)
legacy/            prototype r128 (référence de parité, ne pas modifier)
```
Le Viewer ne possède pas l’état : l’UI appelle `viewer.setState()` et reçoit les intentions
(raccourcis, boutons manette) via `onAction`. `window.__viewer` est exposé pour les scripts de rendu.

### Portes (ajout après P0)
- Contrôles : clavier FPS (ZQSD/WASD/flèches + souris verrouillée, Maj = courir) ; manette PS5
  (mapping standard : Chrome/Edge/Safari) ; tactile : **joysticks virtuels** (`VirtualJoysticks.vue`,
  gauche = marcher, droite = regarder, `viewer.setVirtualSticks`), glisser sur la scène = regarder,
  barre de réglages remontée en haut sur écran tactile.
- Vantaux définis sur les ouvertures (`opening.door`), ouverts au départ sauf la porte palière (`open: false`) ;
  faces différentes possibles (`door.faces`). Porte de salle d'eau : paumelles au sud, confirmé par la vidéo.
- Interaction : viser + **E** ou clic (pointeur verrouillé), **✕** manette, toucher en tactile, clic en vue
  d’ensemble. Portée 220 cm en visite. Le rayon ignore les objets masqués (three.js ne le fait pas seul).
- Indice sous le réticule (`onDoorTarget`). Une porte qui se ferme sur le visiteur ne le bloque pas :
  `slide()` ignore les obstacles déjà chevauchés.
- Paumelles côté sud (SdE), est (palière, chambre) : repris du prototype, **non vérifié sur photos** ;
  béquilles inox supposées (finition réelle inconnue).

### Feuille de route
1. **P0 — Port du prototype** ✅ (nov. 2026) : géométrie extraite vers `public/projects/arboreal-143/*.json`,
   moteur générique, parité fonctionnelle (visite, manette, ensemble, jour/soir, vide/meublé, variantes,
   liste de courses persistée). Parité visuelle vérifiée par rendus comparés au prototype.
2. **P1 — Réalisme** : matières PBR (ambientCG/Poly Haven), HDRI haute définition, vrais modèles (lit, chaises,
   tabourets, suspension papier), meubles sur mesure modélisés (cuisine, bar, penderies) ; Blender en script
   pour lightmaps / AO précalculés. Intérieurs un peu sombres dans les zones à l’ombre (rebond de lumière
   absent) : à traiter ici plutôt qu’en trichant sur l’ambiante.
3. **P2 — Édition** : mode édition (déplacer/pivoter/remplacer un meuble), création de variantes,
   import de liens produit (dimensions) → liste de courses.
4. **P3 — Multi-projets & utilisateurs** : comptes, projets multiples, partage, rôles (propriétaire/lecteur/éditeur),
   import de plans (à définir : depuis SH3D/OBJ, ou saisie de murs).

---

## 8. Préférences et décisions de l’utilisateur (ne pas remettre en cause sans lui)
- Japandi / wabi-sabi ; préférence mobilier **Sklum** ; cuisine **Ikea** façades chêne lisses, push-pull.
- Bar parallèle à la cuisine jusqu’au mur ; lit 140 × 200 ; TV murale ; voilages lin sur tringle chêne.
- Veut **la plus grande fidélité possible aux photos et au plan** (il vérifie les détails : prises, VMC,
  carrelages, sens des portes, porteur…). Mesurer, vérifier par rendu, puis annoncer.
- Fichiers : sauvegarder dans `~/Documents/` (nom d’utilisateur macOS : `thomasbernard`).
- Stack : **npm**, **Nuxt** (pas Next), hébergement **GitHub Pages** pour le moment.

### Matières (P1 engagé, nov. 2026) — choisies d'après les photos de livraison
Assets importés **une fois** depuis Poly Haven (CC0) par `npm run polyhaven -- <projet> texture|model|hdri|sky <id>`,
versionnés dans le projet, provenance dans `public/projects/<id>/sources.json`. Pas d'appel réseau à l'exécution.
- Parquet : `laminate_floor_02` (2k), lames tournées (`rotation: 90`), teinte recalée sur la photo
  (chêne gris-beige clair, moyenne ≈ #C2AE98) via `color` + `colorScale` (calcul en espace linéaire).
- Façades chêne / chêne massif : `silver_oak_veneer_01` teinté vers la palette (#CDB896, #C9A67A).
- Meuble vasque : `black_oak_veneer` teinté chêne foncé chaud (photo).
- Lin (canapé, voilages, couette) : relief `rough_linen` ; tapis : `wool_boucle` ; plan béton : `smooth_concrete_floor`.
- Murs/plafonds : **lisses** (peinture soyeuse sur photos) — pas de texture de plâtre.
- Éclairage d'ambiance `small_empty_room_1` ; ciel jour `kloofendal_48d_partly_cloudy_puresky`
  (tourné de 67,5° pour mettre le soleil de la photo côté sud-ouest) ; ciel soir `kloppenheim_02_puresky` (×0,12).
- Modèles : bonsaï `potted_plant_01` (meuble TV), plante `potted_plant_02` (baie), vases `ceramic_vase_01/04`.
- Reste procédural : faïence/sols SdE et cuisine, brique, dalles terrasse (fidèles aux photos, calepinage exact).
- Pour comparer à une photo : vues `photo-*` de `scripts/screenshot.ts` (appartement vide), et surtout
  **`npm run compare`** : photo ou image de vidéo à gauche, maquette au même cadrage à droite. Points de vue dans
  `images/compare.json` (dossier `images/` = photos et vidéo de livraison de l'utilisateur, **privé, ignoré par
  git**). Photos et vidéo prises à l'**ultra grand-angle** (13 mm éq.) : champ vertical ≈ 111° (photos),
  ≈ 105° (vidéo) ; hauteur de prise de vue ≈ 140–150 cm. Comparer en ambiance **« Couvert »** (photos par temps gris).
- **Couleurs murs / plafonds : suivre la notice** (peinture acrylique blanche), pas la luminosité des photos
  (demande de l'utilisateur). Les photos servent aux positions, formes, teintes relatives des matières.
- Éclairage (nov. 2026) : rendu tonal **Khronos PBR Neutral** (ACES jaunissait les blancs), occlusion ambiante
  **GTAO** (désactivée par défaut sur écran tactile, `?ao=0|1`), HDRI d'ambiance désaturé (`hdriSaturation`),
  ambiances **Jour / Couvert / Soir** (ciel couvert `kloofendal_overcast_puresky`).

### Écarts connus avec le prototype (à valider avec l’utilisateur)
- Couleurs unies un peu plus sombres/saturées : r128 traitait les hex comme linéaires (rendu délavé) ;
  r187 les traite en sRGB → c’est la palette du §5 qui s’affiche réellement.
- Pouf « shot silk » : r187 rend son reflet spéculaire rouge (aspect prune) ; r128 l’ignorait (marine).
  Candidat au remplacement en P1 (peu japandi).
- Plafond : projette désormais l’ombre du soleil (sinon le soleil traversait jusqu’à la salle d’eau aveugle).

## 9. Prochaine étape immédiate
Faire valider par l'utilisateur les points `todo` restants de `spec.json` (seuils h 19 cm, teintes de la porte
palière, géométrie du palier, sens des portes) et les positions vidéophone / thermostat.
Ensuite :
Montrer P0 à l’utilisateur (visite locale `npm run dev`, captures `npm run shots`) et recueillir ses retours ;
site publié sur GitHub Pages ; puis attaquer P1.

---

## 10. Travailler dans ce dépôt

```
npm run dev        # http://localhost:3000 (l’utilisateur le lance souvent lui-même : vérifier avant)
npm run validate   # schéma + références + assets de tous les projets
npm test           # vitest
npm run typecheck  # nuxt typecheck (vue-tsc)
npm run generate   # export statique dans .output/public
npm run shots -- http://localhost:3000 <dossier>   # rendus de référence (Playwright, WebGL logiciel)
```
- `npm run shots` utilise `playwright-core` ; Chromium : variable `CHROMIUM_PATH` (cache local
  `~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/…`) ou `npx playwright-core install chromium`.
  Points de vue dans `scripts/screenshot.ts` (options `doorsOpen`, `keys` pour simuler une touche) ;
  toujours **regarder** les images avant d’annoncer un résultat. En WebGL logiciel le rendu tourne à ~1 i/s :
  les animations (portes) y sont lentes, ce n’est pas un bug.
- Le serveur de dev affiche un overlay `nuxt-error-overlay` sur toute promesse rejetée non interceptée :
  si `document.activeElement` vaut `NUXT-ERROR-OVERLAY` dans un test, chercher l’erreur.
- Lancer un serveur en arrière-plan est refusé par le mode auto : utiliser le `nuxt dev` de l’utilisateur.
- Après toute modification des JSON : `npm run validate && npm test`, puis rendu de la zone touchée.
- **Anti z-fighting** (`app/engine/zfight.ts`) : `validate` **échoue** (et le test vitest aussi, donc le
  déploiement) si deux faces sont dans le même plan, du même côté, se recouvrent (> 25 cm²) avec des matières
  différentes et sont visibles. Correction type : faire dépasser la plus petite pièce de 3–5 mm. Limites :
  pièces tournées, murs obliques, prismes, cylindres et modèles glTF ne sont pas contrôlés ; les bouts de murs
  qui se chevauchent sont reculés automatiquement (`trimBuriedEnds`).
- `npm run compare` : comparaison photo / maquette au même cadrage (cf. §8, matières).
- Les fichiers JSON sont formatés « une part par ligne » (lisibles et diffables) : garder ce style.
- `npm install` signale des scripts d’installation non approuvés (esbuild, fsevents) : sans conséquence,
  esbuild fonctionne via son binaire de plateforme.

# Éclairer une carte Source

## Le modèle général

**Tout l'éclairage statique est de la radiosité cuite par VRAD, une fois, dans le `.bsp`.** Rien
n'est recalculé au runtime. Trois pipelines distincts se cumulent :

- les **faces de brush et displacements** reçoivent un vrai lightmap (une grille de luxels) ;
- les **`prop_static`** reçoivent par défaut un échantillon unique par sommet du modèle, pas un
  lightmap — d'où les props qui semblent flotter, éclairés différemment du sol qu'ils touchent
  (déjà dans `source-map/references/eclairage.md`, qui donne la vérification par `.vhv`) ;
- tout le reste (joueurs, `prop_physics`, `prop_dynamic`, particules) est éclairé en jeu par
  l'**ambient cube** : six échantillons de lumière moyenne, un par face d'un cube, interpolés
  depuis la lightmap la plus proche. Un `prop_dynamic` n'est donc jamais aussi bien éclairé qu'un
  brush voisin — ce n'est pas un bug, c'est l'absence de troisième pipeline.

VRAD ne calcule pas de pénombre géométrique : un bord d'ombre net vient de la densité de luxels,
pas d'un rayon de source lumineuse. [moteur] (VDC, article Lightmap)

## Lightmaps et luxels

L'échelle par défaut est **16 unités par luxel**, et le coût mémoire croît **au carré** quand on
la baisse (÷2 l'échelle = ×4 les luxels sur la même face) — détail et vérification déjà dans
`source-map/references/eclairage.md`. Ce qui manque là-bas : **comment choisir**, face par face.

| Surface | Échelle | Pourquoi |
|---|---|---|
| Mur plat, plafond, grande dalle sans ombre portée | 32 ou 64 | Rien à gagner visuellement ; le coût est payé pour rien [consensus] |
| Défaut, la majorité de la carte | 16 | Compromis d'origine du moteur [moteur] |
| Bord d'ombre recherché (grille, rambarde, texte projeté) | 8 ou 4, **sur cette face seulement** | Baisser globalement plutôt que localement est la première cause de dépassement de `MAX_MAP_LIGHTING` [consensus] |
| Détail proche caméra, ombre dure exigée | 2 | Valeur la plus basse d'usage courant ; en dessous, gain nul, coût ×64 par rapport à 16 [consensus] |
| Displacement | Ne pas descendre sans mesurer | Un displacement n'est **pas subdivisé** comme une face de brush — piège déjà signalé dans `eclairage.md`, c'est la cause n°1 d'un vrad qui passe de minutes à heures |

⚠️ Chaque face porte au plus **31×31 luxels** (124×124 sur un displacement) : VBSP subdivise sinon,
et un excès de faces à échelle basse échoue avec « Too many unique verts ». [moteur] (VDC, article
Lightmap)

**Vérification** : `read_bsp_info` donne la taille du lump `LIGHTING` — à comparer au plafond dur
`MAX_MAP_LIGHTING` = 16 Mio (`bspfile.h:90`, [moteur]). Le lightmap scale effectif d'une face ne se
lit qu'à l'œil, dans Hammer++ (Face Edit Sheet) ou en jeu avec `mat_luxels` — jugement humain, non
outillé ici.

## Les entités de lumière et leur falloff

`light` (ponctuelle), `light_spot` (cône), `light_environment` (soleil, un seul par carte — au-delà,
silencieusement ignoré), `light_dynamic` (calculée en jeu, jamais cuite, coûteuse en nombre).

**Deux systèmes de falloff, mutuellement exclusifs, et le second prime dès qu'il est renseigné** :

- **Constant/Linear/Quadratic** (`_constant_attn` etc.) — ratio historique, hérite d'un facteur
  d'échelle jusqu'à ×10 000 pour compenser la chute physique en 1/d², ce qui sature vite en HDR+bloom.
  [moteur] (VDC, Constant-Linear-Quadratic Falloff)
- **`_fifty_percent_distance` / `_zero_percent_distance`** — VRAD résout une quadratique inverse à
  partir de ces deux distances dès que la première est non nulle. Si `d0 < d50`, VRAD avertit et
  force `d0 = 2×d50` : le falloff réellement posé en jeu diverge alors silencieusement de ce qui a
  été saisi. [moteur] (`lightmap.cpp`, `SetLightFalloffParams`)

⚠️ Un `light_spot` dont l'angle intérieur ou extérieur dépasse 90° est **clampé à 90° par VRAD**, en
jeu comme au rendu — l'angle affiché dans Hammer au-delà de 90° est cosmétique et sans effet réel.
[moteur] (`lightmap.cpp` ~1293-1300, warning cité tel quel)

**Vérification** : le log de compile contient les deux warnings mot pour mot
(`_fifty_percent_distance`, `inner/outer angle larger than 90 degrees`) — `read_compile_log` les
retrouve. Le falloff *senti* en jeu (trop dur, trop mou) est un jugement humain, non outillé.

## Light styles

Chaque **face** ne peut porter que **4 styles simultanés** (`MAXLIGHTMAPS = 4`) ; au-delà, VRAD
ignore les styles excédentaires avec un simple warning, sans bloquer la compilation. Le moteur
connaît **64 styles globaux** (`MAX_LIGHTSTYLES`). [moteur] (`bspfile.h:43,679` ; `lightmap.cpp`)

⚠️ Une carte avec beaucoup de lumières nommées (néons clignotants superposés à un même mur, par
exemple) peut donc avoir des lumières qui *semblent* fonctionner dans Hammer et disparaissent
silencieusement en jeu sur les faces les plus chargées.

**Vérification** : `read_compile_log` — chercher « Too many light styles on a face at », qui donne
les coordonnées de la face fautive.

## HDR

Deux jeux de lightmaps indépendants dans le `.bsp` (déjà détaillé côté fichier dans
`eclairage.md`, avec la vérification par lump). Ce qui s'y ajoute côté éclairage :

- Une entité `light`/`light_environment` sans `_lightHDR` retombe sur `_light` en passe HDR — repli
  correct. Mais un `_lightHDR` renseigné par erreur (copier-coller) fait diverger silencieusement
  la passe HDR de la passe LDR, **sans aucune erreur**. [moteur] (`lightmap.cpp`, `ParseLightGeneric`)
- `-both` n'est pas un mode combiné : VRAD tourne **deux fois entier**, une passe `-ldr` puis une
  passe `-hdr`. Le temps de compile double strictement. [moteur] (`vrad_launcher.cpp:64-138`)

Arbitrage projet : LDR seul pour un intérieur RP dense en joueurs (le gain HDR y est marginal, le
coût de compile et de bande passante ne l'est pas) ; `-both`/`-hdr` réservé à un extérieur où le
contraste jour/nuit est un argument visuel central. [CONSENSUS, arbitrage projet]

**Vérification** : `read_map_geometry` — la présence des deux lumps HDR est une preuve récupérable
du fichier que la passe a eu lieu, plus fiable que les réglages qu'on croit avoir passés en ligne
de commande.

## Cubemaps

Construits **en jeu**, jamais à la compilation — VBSP ne pose que des cubemaps noires par défaut
(`cubemapdefault.vtf`) en attendant `buildcubemaps`. Le comptage de fichiers, la preuve côté
pakfile et le piège HDR/LDR séparés sont déjà dans `eclairage.md` ; ne pas les redupliquer ici.

⚠️ Une carte rechargée avant que le nouvel `env_cubemap` n'ait été compilé dans le `.bsp` ne peut
pas encore recevoir de reflet : `buildcubemaps` alimente des entités déjà présentes dans le fichier,
il n'en crée pas. Le geste, dans l'ordre : compiler d'abord, `buildcubemaps` ensuite.

**Vérification** : `run_console_command`/`read_convars` pour piloter `mat_specular`,
`building_cubemaps`, `buildcubemaps` en jeu ; le résultat visuel (reflet correct ou plat) est un
jugement humain via `capture_screen`.

## Ombres

Trois mécanismes distincts, à ne pas confondre :

- **Ombres cuites dans le lightmap** — la radiosité elle-même ; c'est ce que VRAD calcule par
  défaut pour les brushes et displacements opaques.
- **Ombres de texture (`-textureshadows`)** — projetées par l'alpha d'un matériau `$alphatest`/
  `$translucent` (grille, feuillage, clôture). VRAD ne calcule **jamais** d'ombre depuis une géométrie
  transparente ou translucide sans ce flag ; une clôture sans `-textureshadows` ni RAD file ne
  projette rien. [moteur] (VDC, article VRAD, section Bugs and caveats)
- **Ombres dynamiques temps réel** (joueurs, props physiques) — pilotées par `shadow_control` (ou
  `env_cascade_light` sur les branches qui l'ont déprécié), indépendantes de VRAD.

**Vérification** : « la clôture ne fait pas d'ombre » est un symptôme de compile, pas de placement —
`read_compile_log` ne dira rien (pas d'erreur, juste une absence) ; c'est `read_fgd_class` sur le
matériau/prop concerné puis une vérification visuelle qui tranchent.

## Ce qui fait exploser le temps de compile

VRAD est presque toujours l'étape la plus longue de la chaîne. Dans l'ordre d'impact observé dans
le code :

| Levier | Effet mesuré dans le code | Coût |
|---|---|---|
| `-both` (HDR+LDR) | relance VRAD entier deux fois | ×2 strict [moteur] |
| `-final` | équivaut exactement à `-extrasky 16` — pas un mode magique qui ajoute AO/textureshadows/StaticPropLighting | ×16 rayons pour l'indirect, rien d'autre par défaut [moteur] (`vrad.cpp`) |
| `-StaticPropLighting` | vertex lighting par prop, un travail par instance | croît avec le **nombre** de props, pas leur taille [moteur] |
| `numbounce` (défaut 100, historiquement 8) | rebonds de radiosité | rendements décroissants après quelques dizaines ; `-bounce 0` désactive l'indirect [moteur] (`vrad.cpp:51`) |

⚠️ **`-final` n'inclut pas `-staticproplighting` ni `-textureshadows`.** Un compile qu'on croit
« final » sans les avoir ajoutés explicitement livre des props non lightmappés et des clôtures sans
ombre, sans qu'aucune erreur ne le signale. [moteur]

Pour itérer vite : `-fast` (ou `-bounce 0`, pas de `-final`, pas de `-StaticPropLighting`) — cycles
de secondes à minutes plutôt que d'heures, mais `-fast` produit des taches de bruit dans les zones
sombres et sur les bords de displacement : jamais livré tel quel. [moteur] (VDC, article VRAD)

**Vérification** : `run_compile` avec `fast: true` en itération, `fast: false` réservé à la
livraison (déjà la règle du `SKILL.md` parent). `read_compile_log` donne la durée par étape ; un
doublement net et inexpliqué signale un `-both` implicite plutôt qu'une régression de géométrie.
Les options d'éclairage propres à Hammer++ (`-ambientocclusion`, `-propambient`,
`-worldtextureshadows`) ne sont pas exposées par `hammer-mcp`, pour la raison déjà donnée dans
`eclairage.md` : leur réglage est un jugement visuel, pas un booléen d'outil.

# Matériaux, modèles et packing

Trois familles de fichiers rendent une carte autonome : VTF (texture), VMT (matériau), MDL et sa
famille (modèle). Chacune a ses contraintes dures, et toutes finissent dans le même pakfile.
L'éclairage des matériaux (`$envmap`, cubemaps) est dans [lighting.md](lighting.md) — pas ici.
Le montage CS:S/HL2:EP2 est dans [gmod.md](gmod.md), le coût `prop_static`/`prop_dynamic` en jeu
dans [performance.md](performance.md) : cette page traite la fabrication du modèle, pas son coût.

## VTF — la texture

**Dimensions puissance de 2 obligatoires, et multiples de 4 pour tout format compressé** (bloc
DXT). Une texture non puissance de 2 n'est pas refusée mais traitée comme la puissance de 2
supérieure par Hammer. [moteur, VDC VTF]

- Le VTF stocke ses mipmaps **du plus petit au plus grand**, à l'inverse du DDS. [moteur]
- **DXT1** : 4 bits/pixel, sans alpha lisse (alpha 1-bit possible) — texture opaque standard.
  **DXT5** : 8 bits/pixel, alpha 8-bit interpolé — canal alpha de qualité (masque spéculaire,
  alpha-test fin). [moteur, VDC VTF]
- ⚠️ **Sur les branches Source 2013, un VTF de plus de 32 Mio ne charge pas** : un 4096×4096 doit
  rester en DXT1/DXT5/I8. VRAD ne calcule en plus aucune ombre de texture sur du DXT3 — DXT5 ou
  BGRA8888 pour tout matériau qui projette une ombre. [moteur, VDC VTF]

## VMT — le matériau

Un matériau manquant produit le damier violet-noir ; un **wireframe blanc n'est pas un matériau
manquant, c'est un shader manquant** — deux diagnostics différents. [moteur, VDC VMT]

Shaders qui comptent : `LightmappedGeneric` (brushes, lightmap), `VertexLitGeneric` (modèles,
éclairage par vertex ou per-pixel), `UnlitGeneric` (HUD/UI), `WorldVertexTransition` (blend de
deux textures sur displacement). Un paramètre non supporté par le shader ne produit **aucune
erreur** — il est silencieusement ignoré. [moteur, VDC VMT]

- `$basetexture` quasi obligatoire ; sur un modèle, le canal alpha du `$bumpmap` (ou du
  basetexture) porte le masque spéculaire — convention imposée, pas une option. [moteur]
- **`$alphatest` est nettement moins cher que `$translucent`** : rendu plus rapide, tri toujours
  correct (le translucent n'est correctement trié que sur le worldspawn non-`func_detail`), et
  compatible flashlight/ombres projetées — mais binaire, sans semi-transparence sans banding.
  [moteur, VDC $alphatest/$translucent]
- `$alphatestreference` **ne vaut pas 0,5 par défaut** : `LightmappedGeneric`, `UnlitGeneric` et
  `VertexLitGeneric` défaultent à **0,7** — toujours le fixer explicitement. `$translucent`
  désactive en plus entièrement les ombres de texture projetée sur ce matériau. [moteur, VDC
  $alphatest/$translucent]
- Les `%compile*` (`%compiletrigger`, `%compilenodraw`, `%compilewater`…) sont des drapeaux de
  matériau lus par VBSP à la compilation, pas des paramètres de rendu : un mauvais choix ne se
  voit qu'au compile ou en jeu, jamais en survolant le matériau dans Hammer.

## Surfaceprops

`$surfaceprop` (matériau) et son équivalent QC (modèle) pointent vers un bloc de
`scripts/surfaceproperties.txt` : bruit de pas, friction, decal d'impact, et santé/débris si
destructible. [moteur, VDC Material surface properties]

⚠️ **Une valeur absente ou mal orthographiée ne casse pas le compile** — elle retombe
silencieusement sur `default`, son de pas et decal faux sans aucune erreur console. [consensus]

## Anatomie d'un modèle

Le `.mdl` est un **index** : il référence `.vvd` (données par-vertex : position, normale, poids
d'os, UV), `.dx90.vtx` (bandes de triangles par LOD, nécessaires au rendu) et `.phy` (collision).
Aucun de ces fichiers ne contient l'intégralité à lui seul. [moteur, VDC .mdl/VTX]

- **`$staticprop`** au QC réduit le squelette à un unique os `static_prop`. Sans ce flag, un
  modèle garde animations et squelette : le placer en `prop_static` n'est pas fiable, le moteur
  attend l'hypothèse "statique" que seul le flag pose. [moteur, VDC $staticprop] Coût runtime :
  [performance.md](performance.md).
- **`$concave`** dans `$collisionmodel` permet un hull non convexe (arche, tube coudé). Sans lui,
  le compilateur remplit le creux avec un ou plusieurs hulls convexes — collision fausse, aucune
  erreur. Un hull convexe reste moins cher en CPU physique : ne pas demander `$concave` sur un
  objet qui n'a pas de creux. [moteur, VDC Collision Mesh]
- **Static Prop Combine** (`-staticpropcombine` à VBSP) fusionne des `prop_static` partageant un
  matériau en un modèle généré — un draw call de moins par groupe (Valve rapporte Nuke 40 % plus
  rapide). Exige les sources QC de chaque prop combiné ; un prop stock Valve doit être recompilé
  sous un autre nom, sinon la version VPK écrase la combinée. [moteur, VDC Static Prop Combine]

## La table de packing

Chemins relatifs au dossier du jeu (`garrysmod/`). Un fichier manquant dans cette liste = damier
violet ou modèle ERROR chez le joueur qui ne l'a pas déjà.

| Asset | Fichiers à embarquer | Piège |
|---|---|---|
| Matériau simple | `.vmt` + `.vtf` du `$basetexture` | tout VTF référencé (`$bumpmap`, `$envmapmask`, `$detail`…) doit aussi être packé |
| Matériau `WorldVertexTransition` | `.vmt` + **2** basetextures (`$basetexture`, `$basetexture2`) + leurs bumpmaps | un seul packé sur deux = damier sur la moitié du blend |
| Modèle (prop) | `.mdl` + `.vvd` + `.dx90.vtx` (+ `.dx80.vtx`/`.sw.vtx` si générés) + `.phy` si collision + **chaque** matériau de **chaque** skin | un skin alternatif non packé = ERROR uniquement sur ce skin, invisible en testant le skin 0 |
| Modèle avec LOD | idem + matériaux propres à chaque LOD si `$lod` en change | rare, à vérifier au QC |
| Son | `sound/<chemin>/<fichier>` | chemin relatif à `sound/` |
| Soundscape | `.txt` de soundscape + tous les `.wav` référencés + entrée dans `scripts/soundscapes_manifest.txt` | manifest absent = ne charge jamais, aucune erreur |
| Particules | `.pcf` + chaque matériau de particule (`.vmt`/`.vtf`) + entrée dans `particles/particles_manifest.txt` | idem, silencieux |
| Nav mesh | `maps/<carte>.nav`, à côté du `.bsp` | **jamais dans le pakfile** — fichier séparé, généré en jeu |
| Cubemaps | auto-générés dans le pakfile par `buildcubemaps` + resave, `c-X_Y_Z.vtf` | ne jamais copier/fabriquer à la main — encodent une position précise |
| Skybox 3D custom | 6 faces `skyname*up/dn/lf/rt/ft/bk.vtf` + `.vmt` | inutile si la skybox vient déjà d'un jeu monté |
| Detail sprites | `materials/detail/....vmt/.vtf` + `detail.vbsp` référencé par `detailvbsp` | concerne les displacements avec detail props |

⚠️ **Un `.vmt` posé à la racine de `materials/`** (pas dans un sous-dossier) peut être ignoré par
`bspzip` et les scanners qui l'enrobent : ranger sous un sous-dossier systématiquement. [moteur,
VDC BSPZIP]

**`run_pack` (hammer-mcp) ne devine rien** : il empaquette la liste explicite qu'on lui donne, il
ne scanne pas le `.bsp` pour trouver ce qu'une carte référence — détecter automatiquement les
assets référencés, y compris les `Model()`/`ClientsideModel()` appelés dynamiquement en Lua que
rien côté carte ne trace, est un trou d'outillage connu, ici comme dans le domaine public. `bspzip`
sort en 0 qu'il ait ajouté quelque chose ou non ; `run_pack` compte le pakfile avant/après plutôt
que de croire ce code retour.

## Deux échecs visuels, deux causes

| Symptôme | Cause | Diagnostic |
|---|---|---|
| Damier violet-noir | le modèle charge, **un de ses matériaux** échoue (VMT absent, sous-dossier oublié, shader/paramètre invalide) | console `mat_reloadmaterial`, `developer 1` (`gmod-mcp` → `run_console_command`, `read_console`) |
| ERROR model (balise rouge/noir 3D) | le **`.mdl` lui-même** ne charge pas — fichier manquant, corrompu, ou dépendance VTX/PHY absente | `read_pakfile` (hammer-mcp) pour vérifier que la famille complète est embarquée |

⚠️ **La casse des chemins ne pardonne pas sous Linux.** Un dédié GMod tourne sur un système de
fichiers sensible à la casse ; `Materials/Props/Foo.vmt` référencé comme `materials/props/foo.vmt`
charge sur un poste Windows et casse silencieusement en prod, sans exception pour `materials/`,
`models/` ou `sound/`. [moteur — comportement du système de fichiers]

## Les arbitrages

| Situation | Choix | Pourquoi |
|---|---|---|
| Transparence nette (grille, clôture) | `$alphatest` | moins cher, tri toujours correct |
| Dégradé de transparence (vitre teintée) | `$translucent`, avec parcimonie | seul moyen sans banding, mais paie le tri et l'overdraw |
| Géométrie décorative répétée (ferronnerie, moulure) | Propper → `prop_static` (`$staticprop`) | un modèle est un seul draw call optimisé ; réduit le coût BSP/visleaf |
| Géométrie simple à rôle structurel (porte, découpe de VIS) | rester en brush (`func_detail` si non structurel) | Propper sur un objet qui doit garder un rôle de compile est un contre-emploi |
| Collision concave (arche, tube coudé) | `$concave`, plusieurs hulls convexes assemblés | sans lui le compilateur remplit le creux |
| Collision simple (caisse, planche) | convexe simple, sans `$concave` | moins cher en CPU physique |

## Vérifier

- Packing complet et croissance du pakfile : `read_pakfile`, `run_pack` (hammer-mcp).
- Modèle/matériau chargé sans erreur en jeu : `capture_screen`, `read_console`, `read_logs`
  (gmod-mcp) — le test qui tranche reste de retirer le dossier d'assets custom et chercher
  `ERROR`/`Missing` en console (le protocole de livraison est dans
  [`source-map`](../../source-map/references/livraison.md)).
- Comptage d'entités pour situer le coût d'un choix brush/modèle : `read_map_geometry`,
  `read_bsp_entities` (hammer-mcp).
- Dimensions/format VTF, validité d'un `$surfaceprop`, flag `$staticprop` effectif, hull de
  collision réellement concave : jugement humain, non outillé — rien ici ne lit l'intérieur d'un
  VTF ou d'un MDL. Externe : VTFEdit, model viewer Hammer++/Crowbar.

# Visibilité

Source ne dessine que ce que le joueur peut voir, et « peut voir » est décidé **à la
compilation**, pas au rendu. `vbsp` découpe le monde en visleaves convexes à partir des brushes
*world* ; `vvis` calcule ensuite quelles paires de visleaves se voient et embarque ce tableau dans
le `.bsp`. Toute optimisation de visibilité consiste à aider ce calcul à conclure « non ».

**La règle qui prime : seul le monde (world brush) découpe l'arbre BSP.** Displacements, entités
point, entités brush et `func_detail` n'y participent pas — ils se posent dans les feuilles déjà
tracées, sans en créer de nouvelles. [moteur]

## Structurel contre `func_detail`

Le partage le plus rentable d'une carte, et un vrai jugement humain.

- **Structurel** : l'ossature — murs séparant deux pièces, sols, plafond, coque qui scelle.
- **`func_detail`** : le reste — moulures, mobilier, tuyauterie en brush. Déplacé dans le monde en
  `CONTENTS_DETAIL`, ignoré par `vvis`, ne découpe rien. [moteur]

Règle : *si l'enlever n'ouvre pas une ligne de vue entre deux pièces, c'est du détail.*

⚠️ **`func_detail` ne scelle jamais rien** — ni le vide, ni une aire d'areaportal. Ni les
displacements, ni une texture translucide non plus. Un mur extérieur ou une paroi d'areaportal en
détail fuit. [moteur]

⚠️ **Une carte tout en détail ne vaut pas mieux qu'une carte sans découpe** : sans ossature pour
trancher, `vbsp` produit une poignée de visleaves énormes — tout se voit, tout se dessine tout le
temps. L'objectif est l'équilibre, pas le maximum de détail. [consensus]

Vérifier : `read_map_geometry` donne le ratio structurel/détail et le compte de visleaves ; il ne
dit pas quel mur est lequel — ça reste un jugement humain, à confronter au plan.

## Hints et skip

Un hint brush force une découpe de visleaf là où `vvis` la raterait. Se texture entièrement en
`tools/toolsskip`, sauf la face de coupe voulue en `tools/toolshint` — les faces skip ne rendent
rien et n'influencent que la géométrie du brush, seule la face hint agit sur la subdivision.
[moteur]

⚠️ **Dans un coin, le hint doit intercepter la diagonale, pas suivre le couloir.** Un angle de
coupe < 180° laisse toujours une ligne droite entre les deux visleaves adjacents — le hint ne
bloque rien, mais coûte quand même du temps de compile. Il faut > 180° ; à exactement 180°, deux
hints sont nécessaires. C'est l'erreur classique du couloir en L. [moteur]

Le placement dépend des lignes de vue réelles du plan — **automatiser le comptage, pas le choix**.
`read_sightlines` donne les lignes de vue dégagées les plus longues, à confronter en jeu avec
`mat_leafvis 3` (`gmod-mcp` → `run_console_command`) pour vérifier que le hint a effectivement
séparé les deux feuilles.

## Areaportal, occluder, hint, `func_detail` — quand chacun

| | Coût | Coupe | Contrainte |
|---|---|---|---|
| `func_areaportal` | compilation, ~nul en jeu | tout (brushes, props, entités) | doit sceller hermétiquement une ouverture, un seul brush |
| `func_occluder` | **runtime, par frame et par modèle testé** | seulement les props | aucune contrainte de scellement |
| Hint brush | compilation seule | découpe de visleaf sur la géométrie | angle > 180° dans un coin, sinon inefficace |
| `func_detail` | ~nul, ignoré par `vvis` | rien — ne coupe jamais | ne scelle jamais, ne remplace jamais un mur porteur |

- Porte, fenêtre, séparation franche entre deux zones jouées → **areaportal**, le meilleur
  rapport gain/effort d'une carte d'intérieurs.
- Prop isolé ou volume ouvert où l'areaportal ne s'applique pas → **occluder**, en dernier
  recours et avec parcimonie.
- Coin de couloir, coupure purement géométrique sans ouverture → **hint**.
- Mobilier, ornement, tout ce qui ne doit pas influencer la structure → **`func_detail`**.

## Areaportal

Brush unique, sans displacement, entièrement entouré de world brush des deux côtés — chaque area
qu'il ferme doit être hermétique, au grain près : un écart de 0,1 unité entre deux brushes suffit
à la faire fuir dans une feuille voisine. [moteur]

⚠️ **Un areaportal ne peut pas traverser une surface d'eau.** Il en faut deux, un de chaque côté
du plan d'eau. [moteur]

Toujours ouvert (`Initial State: Open`) en bout de couloir vers une grande zone, lié à une porte
sinon. `MAX_MAP_AREAS` = 256, `MAX_MAP_AREAPORTALS` = 1024 — limites de compilation, pas des
budgets de conception. [moteur, `src/public/bspfile.h`]

Un areaportal mal scellé casse la compilation avec `Brush <n>: areaportal brush doesn't touch two
areas` — catalogue complet des messages de compilateur : `references/compile.md`.

## `func_occluder`

Calcule son occlusion **à l'exécution**, contrairement à l'areaportal précalculé. Chaque frame, le
moteur trace une ligne vers chaque modèle à l'écran pour savoir s'il est masqué — un coût qui
grandit avec le nombre de modèles testés, indépendant de leur complexité. Un occluder mal placé
coûte **plus cher que l'absence d'occluder**. [moteur]

Vérifier qu'il est rentable : `net_graph 1` ou `+showbudget` en jeu (`gmod-mcp` →
`run_console_command`, `read_convars`), comparer avec `ent_fire func_occluder toggle`. Un budget
détaillé par sous-système vit dans `references/performance.md` — pas ici.

## `func_viscluster`

Force `vvis` à traiter toutes les feuilles qu'il recouvre comme mutuellement visibles — réduit le
temps de compile VIS au prix d'un culling runtime moins précis et d'un VRAD potentiellement plus
long. Doit couvrir au moins ~10 % du volume d'une feuille pour agir ; ne doit jamais traverser
l'eau ni une areaportal, sous peine de casser les reflets sous-marins. [moteur]

⚠️ **Déconseillé si le jeu tourne VVIS++.** VVIS++ gère déjà les grandes zones ouvertes sans
explosion exponentielle du temps de calcul ; un viscluster y dégrade l'optimisation runtime sans
accélérer la compile. Vérifier le toolchain en usage (`stock` vs `plusplus`) avant d'en poser un —
détail dans `references/compile.md`.

## Skybox 2D et 3D skybox

La **skybox 2D** est une image statique sur les six faces d'un cube infini, vue à travers toute
face en `tools/toolsskybox`. Le **3D skybox** est une zone bâtie à petite échelle hors des limites
jouables, agrandie par le moteur et rendue derrière la géométrie normale — jamais un remplacement
de la skybox 2D, toujours dessiné devant elle. [moteur]

Échelle par défaut **1/16**, **1/32** sur Left 4 Dead. [moteur]

⚠️ **Un seul `sky_camera` dans toute la carte**, et il vit dans le 3D skybox. Un second dans le
monde principal bloque le nav mesh sur toute la carte. [moteur]

La géométrie du 3D skybox **n'est ni occluse ni culled** comme le reste de la carte — trop de
détail ou de translucide dedans coûte cher sans qu'aucun hint ni areaportal ne puisse intervenir.
[moteur]

## Leak

**Une carte doit être scellée sans interstice, y compris le ciel.** Toute fuite vers le vide
empêche `vvis` de tourner : pas de `.prt` (portal file), un `.lin` (pointfile) à la place. Les
causes classiques : un mur en `func_detail` au lieu de world, une displacement non doublée d'un
brush nodraw derrière, une areaportal mal scellée, ou une carte sans aucune entité (le compilateur
n'a alors aucun point de référence intérieur/extérieur). [moteur]

Une fuite invalide tout ce qui suit dans la chaîne : `vrad` fonctionne mal ou seulement en
éclairage direct, la carte est généralement injouable. `read_leak` transforme le pointfile brut en
entité nommée avec sa position — les compilateurs eux-mêmes ne donnent qu'un tracé de coordonnées.
`run_compile` s'arrête de lui-même à l'étape fautive plutôt que de continuer sur une carte fuyante.

## Mesurer et diagnostiquer

| Question | Outil |
|---|---|
| Le ratio structurel/détail, le compte de visleaves | `read_map_geometry` (hammer-mcp) |
| Les plus longues lignes de vue dégagées | `read_sightlines` (hammer-mcp) |
| Le VMF avant compile — hints mal orientés, areaportal ouvert | `read_vmf_lint` (hammer-mcp) |
| Où et pourquoi une compile a leaké | `read_leak`, `read_compile_log` (hammer-mcp) |
| La feuille/l'area/le cluster du joueur, en jeu | `mat_leafvis 1/2/3` via `run_console_command` (gmod-mcp) |
| Le PVS réellement rendu depuis un point figé | `r_lockpvs 1`, comparé à `r_novis 1` via `run_console_command` (gmod-mcp) |
| Le coût runtime d'un occluder | `net_graph 1` / `+showbudget` via `run_console_command`, `read_convars` (gmod-mcp) |
| Où poser un hint ou une areaportal | jugement humain, non outillé |

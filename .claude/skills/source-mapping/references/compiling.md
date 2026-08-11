# Compiler

Piloter les outils — `run_compile`, Wine, stock/Hammer++, `cull` — vit dans
`source-map/references/compile.md`. Ici : ce que chaque passe fait réellement, quels flags
changent quelque chose, comment traquer un leak, et le catalogue des messages.

## Les trois passes

- **vbsp** transforme les brushes en polygones, génère les visleaves et les detail props, avale
  la plupart des entités internes dans le monde, patche les matériaux `WorldVertexTransition`
  hors displacement, et écrit le `.lin` s'il ne trouve pas de scellement. Le `.bsp` qu'il produit
  est jouable mais **sans VIS et sans lumière**. [moteur]
- **vvis** teste la visibilité entre visleaves (clipping de leurs plans) et écrit le résultat dans
  le `.bsp`. Sans `-fast`, c'est la passe qui dure — de la minute à l'heure sur une grande carte
  extérieure. [moteur]
- **vrad** calcule les lightmaps, l'éclairage par sommet des props, les échantillons d'ambiance ;
  c'est en général **la plus lente des trois**, et une carte non scellée ou mal optimisée
  l'allonge encore. [moteur]

## Les flags qui changent vraiment quelque chose

| Situation | Flags | Effet réel |
|---|---|---|
| Itérer sur le gameplay, pas encore la lumière | `vvis -fast`, `vrad -fast` | vvis ne teste pas la visibilité (juste un premier passage grossier) ; vrad ignore les rebonds. Provoque des taches de couleur aléatoires dans le noir et sur les bords de displacement — **jamais livrer avec `-fast`**. [moteur] |
| Livrer | `vrad -final` | Équivaut à un échantillonnage de props nettement plus fin (`-staticpropsamplescale 16` sur plusieurs jeux) — coût de temps réel, pas un simple label. [moteur] |
| Props aux ombres fausses (collision grossière : grilles, clôtures) | `-staticproppolys` (+ `-textureshadows` si alpha) | vrad ombre depuis le maillage de rendu du prop, pas sa hitbox. `-textureshadows` réclame en général `-staticproppolys` pour être visible. [moteur] |
| Formes de props courbes mal dégradées | `-staticproplighting` | Passe en éclairage par sommet sur les props — le temps de compile grimpe avec leur nombre ; à réserver aux dernières passes. [moteur] |
| Ne toucher qu'aux entités, géométrie et lumière déjà bonnes | `vbsp -onlyents` | Ne réembarque que le bloc d'entités ; conserve VIS et lighting existants. Marque le `.bsp` comme *stale* (avertissement en jeu) — alternative au patch de lump quand on a la source. [moteur] |
| Carte destinée au HDR | `-both`, jamais `-hdr` seul pour une livraison | Sur les branches pré-dépréciation, charger une carte compilée `-hdr` seul avec le HDR désactivé côté client force `mat_fullbright 1` sur **toutes** les cartes suivantes jusqu'à l'activation des cheats. [moteur] |
| Machine partagée, compile longue | `-threads <n-1>` ou `-low` | Laisse la machine réactive pendant la compile ; allonge légèrement le temps. [consensus] |
| T-junctions en excès (`func_detail` touchant le monde) | ne pas dégainer `-notjunc` par défaut | `-notjunc` désactive le correctif de raccord et produit un scintillement visible dans le noir, surtout avec du bump mapping — dernier recours, pas une solution. [consensus] |

⚠️ **`-leaktest` n'est pas ce qui produit le `.lin`.** Il fait seulement arrêter vbsp net au
premier leak détecté ; le pointfile est écrit dans tous les cas, flag présent ou non. Sans lui,
vbsp continue jusqu'au bout et vvis refuse ensuite de tourner. [moteur]

## Lire la progression de vvis

Utile pour distinguer un run qui avance d'un run bloqué — vvis affiche peu, et le seul signe de
vie sur une grande carte peut être ce compteur :

| Sortie console | Ce que ça mesure |
|---|---|
| `number portalclusters` | nombre effectif de visleaves (un `func_viscluster` fusionne plusieurs feuilles en une) [moteur] |
| `BasePortalVis: 0...10` | premier passage grossier, élimine trivialement ce qui ne se voit pas — **pas exécuté avec `-fast`** [moteur] |
| `PortalFlow: 0...10` | le calcul de visibilité réel — la partie longue, absente en `-fast` [moteur] |
| `Building PAS...` | calcul du Potentially Audible Set, après le PVS | [moteur] |
| `visdatasize: N compressed from M` | taille des données de visibilité embarquées ; plafond dur de 16 Mio sur les branches Source 2013 | [moteur] |

⚠️ `-onlyprops` sur vbsp ne génère pas de `.prt` — enchaîné avec vvis normal, vvis **échoue**
plutôt que de sauter la passe. À réserver à un `.bsp` qu'on ne recompile plus qu'en props. [moteur]

## Traquer un leak

⚠️ **L'entité nommée dans `leaked!` n'est jamais la cause.** vbsp remonte du vide vers l'intérieur
par flood-fill et rapporte la première entité rencontrée sur ce chemin — la supprimer déplace
simplement le message sur la suivante. Théorie du scellement : `references/visibilite.md`. [moteur]

1. `read_compile_log` sur la sortie de vbsp : le premier `**** leaked ****` compte, pas ceux qui
   suivent — vvis refuse de tourner sur une carte qui fuit, et le run s'arrête de lui-même.
2. `read_leak` corrèle le pointfile (`.lin`) avec les entités et nomme celle qui se tient sur le
   trajet. Le fichier trace des coordonnées ligne par ligne : la première est le point de départ
   dans le vide, la dernière l'entité d'arrivée — la position dite est **où le rayon est passé**,
   pas nécessairement où est le trou. [moteur]
3. Si le pointfile ne mène nulle part d'évident, les causes qui ne sont pas de la théorie du
   scellement mais des accidents de construction :
   - **origine désynchronisée** — une entité-brush à helper d'origine (`func_door_rotating`,
     `func_rot_button`) fuit si son origine est hors du monde, même si le corps du brush y est.
     Arrive typiquement après un déplacement en mode Vertex Tool, qui ne déplace pas l'origine.
     [moteur]
   - **face translucide tournée vers le vide** — une seule face translucide suffit à rompre le
     scellement, quel que soit le côté ; le pointfile traverse le brush tout droit. [moteur]
   - **`func_detail` non recouvert** — un `func_detail` qui n'a rien derrière lui en world brush
     fuit, puisqu'il ne scelle jamais rien lui-même. [moteur]
   - **aucune entité dans la carte** — vbsp n'a alors aucun point de référence intérieur/extérieur
     et peut rapporter un leak sans qu'il y en ait un géométriquement. Toujours garder au moins un
     spawn. [moteur]
   - **faux positif** — rare : recopier la carte dans un nouveau fichier et recompiler; si le leak
     disparaît, le fichier d'origine était corrompu. [consensus]
   - **`func_viscluster` en travers d'une areaportal ou d'une eau** — pas une cause de leak par
     lui-même, mais le symptôme croisé (leak et viscluster mal posé) se confond facilement au
     pointfile ; vérifier qu'il ne traverse ni l'une ni l'autre. [moteur]
4. Une entité dont l'origine tombe **exactement** à `0 0 0`, ou à l'intérieur d'un brush plein, ne
   fuit jamais — elle est ignorée pour la détermination intérieur/extérieur, ce qui explique
   certains « non-leaks » déroutants sur des props mal placés. [moteur]

## Le catalogue des messages

| Message | Ce que ça veut réellement dire | Quoi faire |
|---|---|---|
| `**** leaked ****` / `Entity <classe> (id) leaked!` | Chemin ouvert vers le vide ; l'entité citée est le point de départ du flood-fill, pas la cause. | `read_leak`, suivre le pointfile, sceller en world brush. Ne jamais supprimer l'entité citée. [moteur] |
| `LEAKED` sans `.lin` exploitable (0 octet) | Le leak existe mais vbsp n'a pas pu tracer un chemin propre — souvent plusieurs leaks simultanés, ou de la géométrie massive hors grille. | Réduire par dichotomie (cordon), chercher un brush isolé loin du reste. [contesté] |
| `Displacement found on a(n) <classe> entity — not supported` | Un displacement s'est retrouvé sur un brush qui n'est plus world (converti par erreur en `func_detail`/`func_brush`). Les displacements ne vivent que sur la géométrie de monde. | `read_vmf_lint` identifie le vrai brush — l'index imprimé par le compilateur est inutilisable (toujours 0). Le reconvertir en world. [consensus] |
| `Too many t-junctions to fix up!` | Trop de `func_detail` intersectant le monde pour que le correctif de raccord tienne sa limite interne. | Convertir une partie des `func_detail` en `func_brush` (pas le même fix-up), ou en props. `-notjunc` en dernier recours seulement. [consensus] |
| `MAX_MAP_BRUSHSIDES` / `MAX_MAP_PLANES` / `MAX_MAP_*` dépassé | Un lump touche sa limite dure, codée dans `bspfile.h`, pas un réglage de ligne de commande (`BRUSHSIDES`/`PLANES`/`NODES`/`LEAFS` = 65536 ; `ENTITIES` = 8192 ; `AREAPORTALS` = 1024 — voir `00-constantes-verifiees.md`). | `read_map_geometry` dit lequel et de combien. Réduire la géométrie (detail, props, instances) ; Hammer++ relève certaines de ces limites, jamais toutes. [moteur] |
| `no entities in the map` | Pas de `worldspawn` valide, ou aucune entité de référence intérieur/extérieur — vbsp peut alors rapporter un leak même sans trou géométrique. | Vérifier l'intégrité du `.vmf`, garantir au moins un spawn. [moteur] |
| `material not found: <chemin>` | Le matériau référencé n'existe dans aucun VPK/dossier monté pour le `-game` utilisé — le compile continue avec une texture de secours (damier). | Vérifier `-game`/`read_source_games`, la casse du chemin (sensible sous Wine/Linux), l'existence du `.vmt`/`.vtf`. [consensus] |
| `Bad surface extents` | Empreinte de lightmap trop grande pour une face — échelle de texture aberrante (souvent hors `[0.1, 10]`), ou displacement à sommets quasi confondus. | Réaligner en *World*, réduire l'échelle, augmenter le `lightmapscale` de la face concernée. [consensus] |
| `WARNING: node without a volume` / `BSP node with unbounded volume` | Un nœud de l'arbre BSP n'a pas pu être borné — souvent de la géométrie invalide issue de vertex-edit ou de props incrustés dans un mur. | Ignorable en pratique si rien ne se voit en jeu ; sinon isoler par cordon la zone récemment vertex-éditée. **[contesté]** — pas de page VDC dédiée trouvée, traitement communautaire. |
| `brush outside world` (brush loin du reste de la carte) | Un brush ou une entité s'est égaré à une distance aberrante, souvent après un copier-coller, gonflant les limites de la carte et risquant un leak ou un plantage. | Vue *Overview*/zoom arrière massif pour le repérer, le supprimer ou le replacer. [consensus] |
| `func_areaportal ... has no area` / `doesn't touch two areas` | Le brush ne touche pas deux zones distinctes et scellées — flotte dans le vide, ou un écart de 0,1 unité rompt le contact. | Repositionner contre une paroi scellée des deux côtés ; un seul brush par areaportal. [moteur] |
| `Cluster portals saw into cluster` | Un portail de vvis se voit lui-même à travers une géométrie dégénérée — quasi toujours un symptôme collatéral d'un leak ou d'un areaportal/hint mal formé. | Corriger le scellement d'abord, revérifier ensuite. **[contesté]** — pas de page VDC isolée. |
| `*** Suppressing further FindPortalSide errors ***` | vvis a rencontré tant d'erreurs de portail qu'il arrête de les logguer une à une — indicateur de gravité, pas l'erreur elle-même. | Remonter au tout premier `FindPortalSide error` avant la coupure ; vérifier l'étanchéité en priorité. **[contesté]** — interprétation littérale, pas de doc primaire directe. |
| `lightmap sample position` (impossible de placer un échantillon) | Recoupe la famille `Bad surface extents` — face dégénérée ou géométrie qui chevauche un displacement. | Même traitement que `Bad surface extents`. **[contesté]** — non isolé formellement dans les sources consultées. |
| `Bogus range` (lighting/HDR) | Valeur de couleur/intensité hors plage représentable — souvent une `light`/`light_environment` à intensité nulle, négative ou extrême. | Vérifier les valeurs de brightness des lumières proches de la zone citée. **[contesté]** — pas de source primaire consultée. |
| `Bad command line` (souvent depuis Hammer++) | Un flag du profil de compile n'est pas reconnu par l'exécutable ciblé — fréquent quand un jeu reçoit un flag propre à un autre. | Vérifier `-game` et l'exécutable réellement invoqué contre la doc du jeu ciblé. [consensus] |
| `Error opening ...vmf` / pas de `.bsp` en fin de compile | La copie finale vers `maps/` a échoué — généralement parce que vbsp a planté avant de produire un `.bsp` (erreur fatale amont). | Remonter au premier message fatal, pas se fier au message de copie. [consensus] |
| `Patching WVT material: ...` | Un matériau `WorldVertexTransition` est utilisé sur une face non-displacement ; vbsp le patche pour qu'il rende quand même. | Rien à faire — information, pas une erreur. [moteur] |
| `FixTjuncs...` | vbsp corrige les raccords en T créés par des `func_detail` touchant le monde. | Rien à faire tant que ça ne précède pas `Too many t-junctions to fix up!`. [moteur] |

## Vérifier

| Question | Outil |
|---|---|
| Où en est la chaîne, quelle passe a échoué | `read_compile_log` (hammer-mcp) |
| Position du leak, entité corrélée | `read_leak` (hammer-mcp) |
| Quel lump touche sa limite, et de combien | `read_map_geometry` (hammer-mcp) |
| Le VMF avant compile — hint, areaportal, brush suspect | `read_vmf_lint` (hammer-mcp) |
| Quel `-game` cible réellement quel jeu | `read_source_games` (hammer-mcp) |
| Les binaires stock/Hammer++ sont-ils là | `health` (hammer-mcp) |
| `mat_fullbright` forcé après une carte `-hdr` seul, en jeu | jugement humain, non outillé — comparer avant/après en jeu (`gmod-mcp` → `run_console_command`) |

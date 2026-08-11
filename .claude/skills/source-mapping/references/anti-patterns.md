# Mythes, débats et détection

Le mapping Source charrie plus de dogme que de mesure. Cette page ne répète aucun interdit déjà
posé ailleurs — elle démonte ce qu'on répète sans vérifier, dit où la communauté elle-même ne
tranche pas, et donne à un agent les signaux concrets pour détecter chaque erreur dans un fichier
plutôt que de la deviner.

## Les mythes démontés

| Mythe | Ce qui est réellement vrai | Cas où il est vrai quand même |
|---|---|---|
| « Trop de brushes = lag » | Le nombre brut de brushes world n'est pas la métrique qui compte — c'est leur effet sur le découpage VIS (`references/visibilite.md`) [consensus] | `MAX_MAP_BRUSHSIDES` = 65536 faces est une limite dure de compilation [moteur] : au-delà, ce n'est plus une question de FPS, la compile échoue tout court |
| « Les props sont toujours moins chers que les brushes » | Faux dans les deux sens absolus — Source ne batch pas le rendu de plusieurs `.mdl`, chaque prop isolé est un draw call séparé ; un comparatif cité donne un `func_detail` plus rapide qu'un displacement équivalent [contesté, chiffré une fois] | Un prop **statique combiné** (propcombine) bat presque toujours l'équivalent en brushes détaillés — c'est le nombre de draw calls qui tranche, pas la catégorie (`references/performance.md`) |
| « Il faut nodraw toutes les faces cachées, le gain est énorme » | Bonne pratique documentée, mais **aucun benchmark chiffré solide** ne compare une carte 100 % nodraw à une carte non traitée à géométrie égale [contesté] | Coût nul en apparence, donc à faire quand même — mais ce n'est pas la priorité n°1 d'optimisation face à hint/areaportal/`func_detail` |
| « `func_detail` sur tout ce qui n'est pas un mur porteur » | Vraie heuristique de départ, fausse au pied de la lettre : un `func_detail` **ne scelle jamais rien** et ne peut pas former d'areaportal (`references/visibilite.md`) [moteur] | Sur tout ce qui ne participe ni à l'enveloppe de la carte ni à une areaportal, l'heuristique tient sans réserve |
| « La skybox géante qui englobe la carte règle les leaks » | Catastrophique : la carte devient un ou deux visleaves, VIS ne peut plus rien couper, tout est rendu en permanence — l'anti-solution exacte au problème qu'elle prétend résoudre [moteur] | Aucun — toujours corriger le leak à la source via le pointfile (`references/compile.md`) |
| « La limite de 32768 unités » | C'est une **étendue**, pas une borne : le monde va de −16384 à +16384 sur chaque axe (`MAX_COORD_INTEGER`), 32768 est la distance bord à bord [moteur, `worldsize.h`] | Nulle part — construire « jusqu'à 32768 » depuis l'origine sort du monde d'un facteur deux, dans les deux sens |
| « `-fast` suffit pour tester » | Vrai pour de l'itération courante sur le gameplay ; faux comme validation finale — vvis ne teste pas la visibilité et vrad ignore les rebonds, ce qui produit du bruit visible sur les bords sombres et les displacements [moteur] | Jamais suffisant comme dernier compile avant test en jeu ou livraison (`references/compile.md`) |
| « Un leak, ça marche quand même » | Faux : une carte qui fuit n'a pas de `.prt`, donc pas de VVIS ; VRAD calcule alors mal ou seulement en direct — la carte compile, mais elle est injouable dans les zones touchées [moteur] | Nulle part — une fuite invalide tout ce qui suit dans la chaîne, `run_compile` s'arrête de lui-même à l'étape fautive |
| « 1 unité Hammer = 1 pouce, base scientifique du scaling » | VDC documente lui-même l'incohérence : l'architecture est calibrée sur 1 pied = 16 unités, les personnages sur 1 pied = 12 unités — appliquer 16 au joueur donnerait des yeux à 4 pieds de haut, ce qui ne correspond à rien [contesté, VDC le dit lui-même] | Bonne estimation grossière pour du brushwork architectural pur (portes, plafonds), jamais pour du placement lié au joueur (`references/level-design.md`) |

Le point commun de ces neuf mythes : chacun confond un geste qui **paraît** sûr (recouvrir, tout
nodrawer, tout détailer, tester en `-fast`) avec un geste qui **est** sûr. Le moteur ne récompense
jamais la prudence apparente — il sanctionne ce qui n'a pas été mesuré.

## Les débats non tranchés

Là où prétendre savoir serait malhonnête :

- **Ampleur réelle du gain nodraw** — tout le monde s'accorde sur la bonne pratique, personne ne
  la chiffre sur une carte réaliste complète. Manque : un benchmark public avant/après à géométrie
  identique.
- **Seuil au-delà duquel les hint brushes deviennent contre-productifs** — VDC et la communauté
  avertissent qu'un usage excessif augmente le rendu au lieu de le réduire, sans règle chiffrée par
  salle ou par couloir. Manque : dépend de la topologie, jugé au cas par cas, pas de mesure de
  référence.
- **Propcombine contre `func_detail` pour du décor répétitif** — le comparatif souvent cité
  (brush plus rapide qu'un displacement équivalent) date d'avant la généralisation de propcombine
  dans les toolchains modernes. Manque : une reprise du même comparatif avec les outils actuels.
- **Lightmap scale « idéal »** — 16 est la valeur historique par défaut, mais aucune valeur
  recommandée universelle n'existe en dehors de « adapter face par face » (`references/lighting.md`
  donne déjà cette table). Manque : un consensus sur où la baisse vaut le coût de compile.
- **`WARNING: node without a volume`, `Cluster portals saw into cluster`, `FindPortalSide error`**
  — comportements observés au compile, sans page VDC dédiée qui explique le mécanisme exact
  (catalogue complet : `references/compile.md`). Manque : une source primaire, pas seulement du
  traitement communautaire.
- **GUI Hammer contre ligne de commande / wrapper de compile** — aucune source ne documente d'écart
  de sortie moteur entre les deux, les deux appellent les mêmes exécutables `vbsp`/`vvis`/`vrad`.
  Le vrai différentiel concerne l'ergonomie (logs, prérequis), pas le résultat compilé — souvent
  présenté à tort comme un choix technique.

Ce que ces débats ont en commun : la communauté sait **quel effet a du sens** (le nodraw aide, le
hint peut nuire mal placé) mais aucun n'a de seuil chiffré publié. Un agent qui cite un chiffre
précis pour l'un de ces cinq points invente une précision que la source n'a pas.

## La table de détection

Pour un agent qui inspecte un `.vmf`, un `.bsp` compilé, ou un log — le signal à chercher, pas le
jugement à porter.

| Symptôme observable | Erreur probable | Outil qui le révèle |
|---|---|---|
| Nombre de visleaves anormalement bas rapporté à la taille de carte | skybox géante ou carte insuffisamment structurelle | `read_bsp_info`, `read_map_extents` (hammer-mcp) |
| `LEAK` / `leaked!` dans le log, `.lin` non vide | scellement rompu — mur en détail, displacement non doublé, areaportal mal scellée | `read_compile_log`, `read_leak` (hammer-mcp) |
| Ratio structurel/détail extrême dans un sens ou l'autre | tout en world brush (VIS non optimisée) ou tout en détail (visleaves énormes) | `read_map_geometry` (hammer-mcp) |
| Comptage de faces de brush proche de 65536 | géométrie haute résolution (cylindres, arches) laissée en world brush | `read_brush_volumes` (hammer-mcp) contre le tableau de `references/brushwork.md` |
| `.vmt` référencé absent du pakfile, damier violet-noir en jeu | packing incomplet — un fichier référencé par le matériau non embarqué | `read_pakfile` (hammer-mcp), `read_console` (gmod-mcp) |
| Flag de compile `-fast` sur ce qui est présenté comme le dernier build | validation finale faite sur un compile dégradé | `read_compile_log` (hammer-mcp) — chercher les flags loggés |
| Histogramme `lightmapscale` plat (tout à 16 ou tout à 4) | non-discrimination face par face, gaspillage ou banding | `read_vmf` (hammer-mcp), croisé avec la taille de face |
| `env_cubemap` présent mais lump cubemap vide dans le `.bsp` compilé | `buildcubemaps` jamais lancé après le dernier compile | `read_pakfile`, `read_bsp_info` (hammer-mcp) ; `run_console_command` (gmod-mcp) pour rejouer `buildcubemaps` |
| Deux entités partageant le même `targetname` | I/O fantôme — les deux reçoivent chaque input adressé au nom | `read_bsp_entities` (hammer-mcp), `read_vmf_lint` |
| Comptage d'entités réseau proche de la limite d'edicts runtime | excès d'entités, ou confusion avec `MAX_MAP_ENTITIES` (compilation, pas runtime) | `read_bsp_entities` (hammer-mcp) pour la compilation, `read_entities` (gmod-mcp) pour le runtime réel |
| `sky_camera` présent plusieurs fois dans le fichier | un second `sky_camera` bloque le nav mesh sur toute la carte | `read_vmf` (hammer-mcp) |
| Displacement en bordure de skybox sans brush world nodraw en vis-à-vis | leak par displacement non scellant | `read_vmf`, `read_leak` (hammer-mcp) |
| `trigger_multiple`/`trigger_once` sans le flag `Clients (Players)` coché | trigger inerte pour le joueur, sans aucune erreur de compile ni de console | `read_vmf_lint` si la règle est couverte ; sinon `spawn_entity` puis observer l'absence d'output (gmod-mcp) |
| Grand nombre de `prop_dynamic` sans parent, sans nom, sans animation | candidats non convertis en `prop_static`, coût edict et physique inutile | `read_prop_survey` (hammer-mcp) — un candidat, jamais un verdict |
| `water_lod_control` présent plus d'une fois dans le fichier | échec de compile garanti — un seul est autorisé par carte | `read_vmf` (hammer-mcp) |
| Brush `water` dont la bounding-box n'est pas un prisme droit rectangulaire | rendu du plan d'eau cassé | `read_vmf` (hammer-mcp), croisé avec les faces non-eau attendues en `toolsnodraw` |

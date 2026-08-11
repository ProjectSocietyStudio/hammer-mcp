# Géométrie de brush

La géométrie de brush est la matière première de toute carte Hammer : ce que vbsp compile, ce que
vvis découpe, ce qui scelle ou fuit. Cette page couvre la grille, les formes valides, les textures
d'outil et le choix world brush / `func_detail` / entité brush — pas la visibilité (`visibilite.md`),
pas l'éclairage, pas les displacements, pas les perfs, qui ont chacun leur propre référence.

## La grille

**Le pas de grille de Hammer est toujours une puissance de deux** : 1 - 2 - 4 - 8 - 16 - 32 - 64 -
128 - 256 - 512 - 1024 unités, jamais de valeur intermédiaire [moteur]. Descendre sous 1 unité pour
un ajustement fin est toléré mais rarement nécessaire — c'est le premier pas vers la tolérance de
recollage ci-dessous, pas une échelle de travail normale [consensus].

Vérification : jugement humain, non outillé — Hammer affiche le pas courant (`[`/`]`), et
`read_vmf_lint` peut signaler un brush hors grille si le lint l'implémente ; sinon c'est une lecture
visuelle en éditeur.

## Formes valides

**Un brush doit être convexe, à faces planaires.** C'est la définition qu'applique vbsp : une face
non plane ou un volume concave donne un *invalid brush* [moteur]. Un brush composé n'existe pas —
une forme non convexe se construit en plusieurs brushes convexes assemblés.

⚠️ **vbsp ne recolle un vertex mal aligné qu'à ~0.03 unité du plan de la face** [moteur]. Au-delà,
aucune correction automatique : le brush reste invalide, silencieusement dans Hammer, et peut
produire des portails de visleaf mal formés à la compile — donc un leak qui ne se voit pas en
éditeur. Toute édition au vertex tool doit revérifier la planarité de **toutes** les faces qui
partagent le vertex déplacé, pas seulement celle qu'on visait.

Vérification : **Map → Check for Problems** (Alt+P) dans Hammer, avant toute compile — c'est du
jugement humain assisté par l'éditeur, aucun outil `hammer-mcp` ne rejoue ce contrôle. En aval,
`read_vmf_lint` et, si la compile est allée jusque-là, `read_leak`.

## Découper une forme

| Besoin | Outil | Pourquoi |
|---|---|---|
| Séparer un brush en deux par un plan | Clip tool | Coupe nette, résultat toujours convexe et planaire |
| Ajuster un coin, un biseau | Vertex tool, avec prudence | Plus propre que Carve, mais chaque déplacement doit rester au grid — sinon la tolérance de 0.03u est dépassée |
| Trou, arche, forme complexe | Assembler plusieurs brushes convexes, ou passer en displacement | Carve produit des faces invalides et des volumes corrompus dès que le résultat n'est plus un seul volume convexe |
| Cas rare où Carve reste tolérable | Uniquement si la coupe reste **un seul** volume convexe, sans split | Un split en morceaux crée du brushwork non optimisé et des angles hors grille |

⚠️ « Ne jamais utiliser Carve » est **[contesté]** : trop absolu. Le vrai interdit porte sur l'usage
qui force un split en plusieurs morceaux ou une forme concave — pas sur l'outil lui-même.

Vérification : Check for Problems après toute opération de découpe, puis `read_vmf_lint`. Aucun
outil `hammer-mcp` ne juge la qualité géométrique d'un découpage — c'est un contrôle éditeur.

## Textures d'outil

| Besoin | Texture | Piège |
|---|---|---|
| Face jamais vue en jeu | `toolsnodraw` | Reste solide et **scelle** — zéro rendu, pas zéro collision [moteur] |
| Face qui ne doit exister nulle part | `toolsskip` | N'existe pas dans le BSP compilé : aucune collision, aucune découpe. L'utiliser à la place de nodraw crée un trou de collision invisible en éditeur [moteur] |
| Forcer une découpe de visleaf précise | `toolshint` sur la face de coupe, `toolsskip` sur les autres faces du même brush | Sans hint, vvis découpe seul et souvent mal dans un couloir en L [moteur] |
| Bloquer joueur + physique + balles | `toolsclip` | Solide aussi aux items et au C4 selon le jeu |
| Bloquer seulement le joueur | `toolsplayerclip` | ⚠️ ignoré par la génération de nav mesh — un bot peut traverser une zone bloquée au joueur [moteur] |
| Volume d'entité non solide (trigger, viscluster) | `toolstrigger` | La texture seule ne fait rien : doit habiller un brush **attaché à une entité** (`trigger_*`) [moteur] |
| Zone areaportal | `toolsareaportal` | Idem : sans `func_areaportal` lié, la texture est inerte [moteur] |

⚠️ « nodraw et skip sont interchangeables » est **[contesté]** : faux, comportements documentés
opposés (nodraw scelle et découpe, skip n'existe pas dans le BSP compilé). Confusion fréquente et
coûteuse — c'est la paire de textures la plus mal utilisée du corpus VDC.

Vérification : `read_compile_log` et `read_bsp_info` après compile — une face `toolsskip` ne doit
apparaître nulle part dans les comptes du BSP compilé, contrairement à `toolsnodraw`.

## World brush, `func_detail`, entité brush

**Le partage qui compte** : est-ce que retirer ce brush ouvre une ligne de vue ou casse le sceau du
monde ? Si oui, c'est structurel (world brush). Sinon, c'est du détail.

| | World brush | `func_detail` | Entité brush (`func_brush`, `func_wall`…) |
|---|---|---|---|
| Découpe les visleafs | oui | non — reversé en `CONTENTS_DETAIL` | non |
| Peut sceller le monde / une areaportal | oui | **non, jamais** | non |
| Compte dans `MAX_MAP_BRUSHES` | oui | oui | oui |
| Usage | murs, sols, plafonds porteurs | moulures, mobilier, poteaux, marches | porte, vitre, mur qui bascule solide/non-solide |

⚠️ **Un `func_detail` ne scelle pas.** Un mur extérieur posé en détail fait fuir la carte même si la
pièce a l'air close en jeu [moteur]. Et un `func_detail` **chope les autres `func_detail`** : vbsp
stock n'a pas de niveaux de détail, donc deux détails qui se touchent se découpent l'un l'autre
sans arbitrage — seul le contact détail/structurel est asymétrique (le détail est chopé, pas
l'inverse) [moteur].

**`func_brush`** remplace `func_wall` / `func_illusionary` / `func_wall_toggle`, officiellement
dépréciés — `Solidity` (0 = toggle, 1 = jamais solide, 2 = toujours solide) couvre les trois usages
[moteur]. **`func_lod`** fait la même chose qu'un `prop_static` en LOD mais reste un edict à part
entière — n'y a recours que si le modèle ne peut vraiment pas être un prop [moteur].

Le choix structurel/détail est **le seul jugement vraiment humain de cette page** ; le comptage qui
l'accompagne ne l'est pas.

Vérification : `read_map_geometry` donne le ratio world/detail mais pas quel mur est lequel —
c'est un point de départ, pas un verdict. `read_brush_volumes` chiffre le volume par brush. Le
sceau se prouve en compilant et en lisant `read_leak` si la carte fuit. La VIS proprement dite —
hint/skip, areaportals, occluders, visclusters — vit dans `visibilite.md`.

## Limites dures

Toutes lues dans `src/public/bspfile.h` (`ValveSoftware/source-sdk-2013`), pas sur un wiki
[moteur] :

| Constante | Valeur | Ce qui la fait grimper vite |
|---|---|---|
| `MAX_MAP_BRUSHES` | 8192 | tout brush, monde + détail + entité brush confondus |
| `MAX_MAP_BRUSHSIDES` | 65536 | souvent la première limite atteinte — cylindres et arches en haute résolution en world brush plutôt qu'en détail |
| `MAX_MAP_ENTITIES` | 8192 | comprend les entités brush |
| `MAX_MAP_PLANES` | 65536 | chaque face unique ; aligner les brushes bord à bord sur un même plan réutilise l'entrée au lieu d'en créer une |
| `MAX_MAP_TEXINFO` | 12288 | rarement la limite qui casse en premier |

⚠️ **32768 est une étendue, pas une borne.** Le monde va de −16384 à +16384 sur chaque axe
(`MAX_COORD_INTEGER`) [moteur]. Construire « jusqu'à 32768 » sort du monde d'un facteur deux.

Le compilateur nomme la constante dépassée en toutes lettres dans son message d'erreur — pas besoin
de deviner laquelle a cassé.

Vérification : `read_bsp_info` et `read_compile_log` donnent les comptes compilés ; les comparer au
tableau ci-dessus. `read_map_geometry` avant compile pour voir si une carte a encore de la marge.

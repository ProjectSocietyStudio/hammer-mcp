# Ce qu'on sait vérifier, et ce qu'on ne sait pas

Savoir une règle ne sert à rien si on ne sait pas dire si elle est respectée. Cette page relie
chaque famille de règles du skill à sa méthode de contrôle, et nomme sans détour ce que rien ne
contrôle.

Trois statuts, et un seul est confortable :

| Statut | Ce que ça veut dire |
|---|---|
| **offline** | un outil `hammer-mcp` répond sur le fichier, sans moteur, sans serveur |
| **en jeu** | il faut le moteur en marche : `gmod-mcp`, donc le serveur partagé |
| **humain** | aucun outil ne tranche. Le dire est la seule honnêteté possible |

## Par domaine

| Règle du skill | Comment on la vérifie | Statut |
|---|---|---|
| Remplissage des lumps vs plafonds vbsp ([brushwork](brushwork.md)) | `read_map_geometry` | offline |
| Emprise réelle, sortie du monde ([brushwork](brushwork.md)) | `read_map_extents` | offline |
| Classe ou keyvalue inconnue du FGD ([entites](entites.md)) | `read_vmf_lint`, `read_fgd_class` | offline |
| Output vers une cible inexistante ([entites](entites.md)) | `read_vmf_lint` | offline |
| Inventaire et position des entités ([entites](entites.md)) | `read_bsp_entities`, `read_vmf` | offline |
| Carte scellée, traque d'un leak ([compile](compile.md)) | `read_leak` sur le pointfile, `read_compile_log` | offline |
| Sens réel d'un message de compilateur ([compile](compile.md)) | `read_compile_log` | offline |
| Longueur des lignes de vue ([visibilite](visibilite.md)) | `read_sightlines` | offline |
| Un brush est-il clos, convexe, dans le monde, sur la grille ([brushwork](brushwork.md)) | `read_vmf_solids` | offline |
| Une carte tient-elle son budget, et lequel ([performance](performance.md)) | `read_map_report` | offline |
| Un hint a-t-il changé quelque chose ([visibilite](visibilite.md)) | compiler avant/après, comparer `read_visleaf_stats` | offline |
| Props dynamiques convertibles en statiques ([performance](performance.md)) | `read_prop_survey` | offline |
| Emprise et volume des entités brush ([performance](performance.md)) | `read_brush_volumes` | offline |
| Cubemaps construits, lighting statique cuit ([lighting](lighting.md)) | `read_pakfile` — compte les `c-*.vtf` et les `.vhv` | offline |
| Assets embarqués vs dépendances externes ([assets](assets.md)) | `read_pakfile`, puis `run_pack` | offline |
| Nav mesh encore valide après compilation ([gmod](gmod.md)) | `read_nav` | offline |
| Toolchain, FGD, profil de jeu disponibles ([compile](compile.md)) | `health`, `read_source_games` | offline |
| Découpage réel en visleaves ([visibilite](visibilite.md)) | `mat_leafvis`, `r_lockpvs` via `run_console_command` | en jeu |
| Ce qui est réellement dessiné ([performance](performance.md)) | `mat_wireframe`, `+showbudget` via `run_console_command` | en jeu |
| Coût serveur sous charge ([performance](performance.md)) | `read_runtime`, `read_players`, `read_entities` | en jeu |
| Cubemaps à reconstruire ([lighting](lighting.md)) | `buildcubemaps` via `run_console_command` | en jeu |
| Damier violet, modèle ERROR ([assets](assets.md)) | `capture_screen`, `read_console` | en jeu |
| Ambiance sonore, brouillard, eau ([ambiance](ambiance.md)) | `capture_screen`, `read_view`, écoute humaine | en jeu |
| Un brush structurel devrait-il être `func_detail` ([visibilite](visibilite.md)) | — | humain |
| Où poser un hint, un areaportal ([visibilite](visibilite.md)) | — | humain |
| Quel lightmap scale mérite telle surface ([lighting](lighting.md)) | — | humain |
| L'éclairage est-il beau, la ville lisible ([level-design](level-design.md)) | — | humain |
| Échelle, composition, flow ([level-design](level-design.md)) | — | humain |
| Le displacement est-il bien cousu ([displacements](displacements.md)) | — | humain |

⚠️ **La colonne « humain » n'est pas une faiblesse de l'outillage, c'est la nature du métier.**
Un agent qui maquille un jugement esthétique en métrique produit un chiffre faux et une fausse
assurance. Dire « je ne peux pas trancher, regarde » est une réponse valide et souvent la bonne.

## Ce que le fichier compilé a définitivement perdu

Un `.bsp` n'est pas une carte, c'est le résultat d'une carte. Auditer une carte dont on n'a pas le
`.vmf`, c'est accepter ces angles morts :

| Perdu | Pourquoi |
|---|---|
| structurel vs `func_detail` | vbsp fond le détail dans le monde à la compilation |
| hints et skips | consommés par vvis, absents du fichier final |
| visgroups, cordon, organisation de travail | n'existent que dans le `.vmf` |
| lightmap scale par face | la taille du lump se mesure, la décision par surface non |
| l'intention du mappeur | aucun fichier ne la contient |

Face à une de ces questions sur une carte compilée, la réponse est **« non déterminable depuis un
`.bsp` »**, pas une estimation.

## Les trous d'outillage, relevés et non comblés

Constat au 11/08/2026 **en fin de journée**, à partir du catalogue de `hammer-mcp`. Ce n'est pas
un chantier ouvert : c'est ce qu'il faut savoir avant de promettre une vérification qui n'existe
pas.

Deux lacunes de la version du matin ont été comblées dans la journée et sont retirées de ce
tableau plutôt que barrées : la **table des matériaux** (`read_materials`) et la **géométrie de
brush**, qui n'est plus un refus — voir ci-dessous.

| Trou | Ce qu'il empêche |
|---|---|
| `run_pack` exige une liste explicite | aucune détection des assets réellement référencés ; un oubli reste invisible jusqu'au damier violet |
| aucune lecture de la géométrie d'un `.nav` | `read_nav` ne dit que la fraîcheur, pas la couverture |
| aucun lecteur de `.gma` | une carte du Workshop doit être extraite hors outillage avant d'être mesurée |
| displacements, visgroups, cordon, occluders | lus ou comptés au mieux, jamais créés ni édités |
| areaportals | comptés par `read_map_geometry`, jamais validés fonctionnellement |
| génération de cubemaps et de nav mesh | hors périmètre par construction — le moteur est requis, donc `gmod-mcp` |
| lecteur de `vprof` | envisagé, jamais écrit, faute d'échantillon réel pour le calibrer |

## Le refus sur la géométrie de brush, et pourquoi il est tombé

`hammer-mcp` refusait de créer des brushes, avec un motif écrit en tête de son chemin d'écriture :
poser des plans et des axes de texture **sans oracle** produit des cartes qui compilent et qui sont
fausses.

L'argument était juste ; c'est sa conclusion qui a expiré, parce que les oracles existent
maintenant. Quatre, et ils sont indépendants :

| Oracle | Ce qu'il attrape |
|---|---|
| **l'algèbre** — `read_vmf_solids` | il remonte des plans vers le volume, là où l'écrivain descend du volume vers les plans : une erreur de signe ne peut pas se cacher dans les deux sens |
| **le compilateur** — vbsp | une pièce close construite entièrement par l'outil compile sans leak, et fuit dès qu'on retire un mur |
| **le moteur** | la pièce démarre, ou non |
| **l'œil** | tout le reste, et il reste requis |

Conséquence pour ce skill : **la colonne « humain » n'a pas rétréci.** Ce qui a changé, c'est qu'un
agent peut désormais *agir* sur ce qu'il diagnostique — poser un `func_detail`, un hint, un volume —
au lieu de seulement le nommer. Décider **où** les poser reste un jugement.

⚠️ Ne pas en conclure qu'une carte construite par outil est bonne. Les quatre oracles répondent
« close, convexe, dans le monde, scellée ». Aucun ne répond « belle », ni « lisible », ni « au bon
endroit ».

⚠️ **`write_lump_patch` produit un fichier valide dont l'effet en jeu n'est pas prouvé.** Le codec
`.lmp` est mesuré ; que Garry's Mod l'honore réellement ne l'est pas. Tant que cette porte n'est pas
passée, ne bâtis pas un plan de livraison dessus.

⚠️ **Seul Garry's Mod a réellement été exécuté ici.** Les lecteurs BSP et VMF sont du Source
générique, mais les profils des autres jeux sont plausibles et non vérifiés. Une affirmation du
genre « pour CS:S, fais X » n'a été essayée par personne dans cet atelier — dis-le si tu l'écris.

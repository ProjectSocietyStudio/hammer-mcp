# Garry's Mod contre Half-Life 2

GMod n'est pas un jeu Source de plus : c'est un mod multijoueur qui charge des gamemodes en Lua
par-dessus le moteur. Ce document dit ce qui change une fois qu'une carte quitte HL2/CS:S pour
GMod. La perf générale reste dans [performance.md](performance.md), la visibilité dans
[visibilite.md](visibilite.md), le packing d'assets dans [assets.md](assets.md).

## Compiler pour GMod

**Le FGD à charger est `garrysmod.fgd`, pas `base.fgd`.** Il déclare les entités propres à GMod
(`gmod_button`, `gmod_hands`) et les FGD de chaque gamemode chargé (`ttt.fgd` pour TTT). Compiler
avec `base.fgd` ne casse rien à la compilation : les entités GMod restent simplement invisibles
dans Hammer, une perte silencieuse. [moteur]

Deux chaînes de compilateurs compilent toutes les deux un `.bsp` valide pour GMod :

| Chaîne | Quand | Vérifier |
|---|---|---|
| Source SDK Base 2013 Multiplayer | la plus documentée, la cible de Hammer++ | `read_source_games` liste les jeux installés et leur `toolchain` |
| Compilateurs embarqués dans `GarrysMod/bin/` | repli, sans dépendance externe | idem, `toolchain.dir` peut être `null` si le jeu n'a pas de `bin/` séparé |

[consensus] — les deux chemins sont attestés, aucune source ne documente d'écart de sortie entre
eux. `read_fgd_class` confirme qu'une classe donnée existe bien dans le FGD chargé avant de
l'employer dans un `.vmf`.

## Le montage de contenu — le piège CS:S

`garrysmod/cfg/mount.cfg` déclare, jeu par jeu, quel contenu d'un autre titre GMod expose en plus
du sien (`"cstrike" "<chemin>/cstrike"`). Il pilote `IsMounted` côté Lua **et** ce que voient
Hammer et les compilateurs à la compilation — une carte qui référence une texture CS:S doit avoir
CS:S monté **au moment de compiler**, pas seulement au runtime. Les chemins sont sensibles à la
casse sous Linux. [moteur]

⚠️ **Damier violet/noir en GMod signifie presque toujours une dépendance CS:S ou HL2 Episode Two
non montée**, pas un asset réellement manquant : une grande partie du contenu communautaire est
bâtie sur les VPK de CS:S. Vérifier avec `read_pakfile` ce que la carte embarque déjà, puis
`mount.cfg` côté serveur pour ce qu'elle emprunte sans l'embarquer. [consensus]

## Spawns — ce que DarkRP lit et ce qu'il ignore

`info_player_start` reste le spawn générique hérité de HL2, lu par Sandbox et par tout gamemode
qui n'a pas sa propre logique. **DarkRP ne lit pas nativement `info_player_start` pour placer un
job** : le spawn par job passe par un champ Lua (`PlayerSpawn`/`PlayerSelectSpawn`) déclaré dans la
définition du job, enregistré en base par une commande admin — hors du `.bsp`. Une carte DarkRP
n'a donc besoin que de spawns génériques ; inventer une entité de carte pour « le spawn du job
policier » ne sera lu par rien. [consensus]

**Les portes achetables DarkRP reconnaissent une liste fermée de cinq classes**, testée par
`isDoor()` dans `sh_doors.lua` du gamemode : `func_door`, `func_door_rotating`,
`prop_door_rotating`, `func_movelinear`, `prop_dynamic`. [moteur] — source :
`github.com/FPtje/DarkRP/blob/master/gamemode/modules/doorsystem/sh_doors.lua`. Une porte montée
sur une autre classe (un `func_button` habillé en porte) s'ouvre normalement mais n'a **jamais**
de menu d'achat, sans erreur nulle part. Rien de tout cela ne se règle en keyvalue Hammer :
propriétaire, titre, groupe autorisé sont des networked vars côté Lua, pas des champs de la
classe. ⚠️ Un serveur cible peut forker `sh_doors.lua` — vérifier la liste dans le dépôt du
gamemode réellement installé, pas supposer l'amont FPtje.

## Nav mesh et nodegraph — deux systèmes, un seul se répare seul

| | `.nav` (nav mesh) | `.ain` (nodegraph) |
|---|---|---|
| Sert | les `NextBot` | les NPC classiques (Combine, zombies HL2) |
| Généré par | jamais le compilateur — `nav_generate` en jeu, `sv_cheats 1`, uniquement | le moteur, automatiquement, au premier chargement si absent/invalide |
| Invalidé par une recompile | oui, silencieusement | oui, mais le moteur le régénère seul au chargement suivant |
| Coût d'oubli | Nextbots figés, **console muette** | coût CPU ponctuel au premier `map`, rien de cassé |
| Vérifier | `read_nav` rend `fresh`/`stale` en comparant la taille de BSP inscrite dans le fichier à celle chargée | log serveur au premier `changelevel` après recompile |

`rp_nycity_day` embarque un `.ain` dans son pakfile — vérifiable avec `read_pakfile`. Aucun
générateur de nav mesh n'existe hors moteur, ici ou ailleurs dans le domaine public ; regénérer
exige `gmod-mcp` en jeu, ça se demande, ça ne se décide pas (voir `SKILL.md`).

## Workshop

`gmad` empaquette un dossier en `.gma`, `gmpublish` l'uploade — deux binaires livrés dans
`garrysmod/bin/`, ni l'un ni l'autre outillé par ce projet : cette étape reste manuelle. Deux
contraintes dures avant d'y passer :

- **L'icône doit être un JPEG baseline 512×512, chroma 4:2:0.** Un JPEG progressif, un PNG, ou un
  export 4:2:2/4:4:4 est rejeté silencieusement par le compresseur. [moteur]
- **Liste blanche d'extensions** dans `AddonWhiteList.h` de `gmad` : `.dll`, `.exe`, `.js`,
  `.html`, `.css` et la plupart des `.txt` sont bannis (exception : scripts de véhicule). [moteur]

`addon.json` doit être à la racine, pas dans un sous-dossier, sous peine d'un rejet « not allowed
by whitelist » à la création du `.gma`. [consensus]

## Deux chiffres à ne pas confondre avec leur voisin

**La limite d'edicts n'est pas la limite d'entités de compilation.** `MAX_EDICTS` = 2048 dans
`const.h` est la limite **runtime** du moteur Source stock — combien d'entités peuvent exister
*en même temps en jeu*, carte plus joueurs plus armes plus ragdolls plus props spawnés. [moteur]
GMod la relève, mais GMod est fermé : la valeur exacte n'est vérifiable dans aucun code source
ici. **[consensus]** — à mesurer sur l'instance réelle, pas à citer. Elle n'a rien à voir avec
`MAX_MAP_ENTITIES` = 8192, qui borne le lump 0 **à la compilation** et n'existe qu'au moment où
`vbsp` écrit le `.bsp` — une carte peut respecter 8192 sans épuiser les 2048 (ou plus) edicts
runtime une fois des joueurs dedans, et inversement une petite carte peut épuiser les edicts si
elle laisse `sbox_maxprops` sans borne. Vérifier : `read_map_extents`/`read_bsp_entities` pour le
compte de compilation ; `gmod-mcp` → `read_entities` pour le compte runtime réel.

**« 32768 » est une étendue, pas une borne.** `MAX_COORD_INTEGER` = 16384 : le monde va de −16384
à +16384 sur chaque axe. L'étendue totale, bord à bord, fait 32768 — c'est l'origine du chiffre,
pas une limite qu'on pourrait placer n'importe où dans l'espace. [moteur] Le folklore qui présente
« 32768 » comme la taille maximale d'une carte fait construire deux fois trop grand : à partir de
l'origine, on n'a que 16384 dans chaque direction, pas 32768. Vérifier : `read_map_extents`.

## La charge multijoueur réelle

Un DarkRP à 32-64 joueurs consomme des edicts pour les entités de carte **et** pour tout ce qui
apparaît en jeu — armes tenues, projectiles, ragdolls, props spawnés. Une carte déjà dense en
entités statiques réduit d'autant la marge qui reste aux joueurs en cours de partie ; ce n'est pas
un défaut de la carte en soi, mais un budget à connaître avant de l'ajouter. Les `sbox_max*`
(`sbox_maxprops`, `sbox_maxragdolls`, `sbox_maxnpcs`…) bornent le spawn joueur côté serveur, pas
côté carte — ne jamais supposer leur valeur par défaut, la lire sur l'instance cible. [consensus]
Vérifier : `gmod-mcp` → `read_convars` pour les `sbox_max*` effectifs, `read_runtime` pour la
charge en cours, `read_players` pour le nombre connecté.

Le poids réel d'un `prop_physics` non batché, le coût d'une collision mesh redimensionnée
dynamiquement, la densité de props physiques toujours actifs — jugement humain, non outillé :
aucun outil ici ne mesure un coût CPU en jeu, seul `gmod-mcp` observe l'instant présent.

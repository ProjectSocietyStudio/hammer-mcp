# hammer-mcp

Serveur MCP local pour le travail de carte Source : lecture et édition de `.vmf`, lecture de
`.bsp`, patch d'entités sans recompilation, compilation sous Wine, et audit d'une carte contre les
exigences du dépôt.

Dépôt séparé, cloné en frère de `gmod-mcp/` dans le workspace Project Society. Le `.gitignore`
parent ignore tout à la racine (`/*`) puis ré-autorise nommément : ce dossier lui est donc
invisible sans qu'aucune ligne y soit ajoutée.

**Il ne parle jamais à un serveur en cours d'exécution.** Il ne touche aucun chemin sous
`srcds/garrysmod/data/gmod_mcp/` et ne pose aucun verrou — un second lecteur de ce répertoire
efface les résultats que le daemon `gmod-mcp` attend. Tout ce qui demande le moteur vivant vit
dans `gmod-mcp`, pas ici.

## État

| Famille | État |
|---|---|
| BSP (`read_bsp_info`, `read_bsp_entities`) | **prouvé** — jalon 1 ci-dessous |
| Patch de lump (`read_lump_patch`, `write_lump_patch`, `read_lump_patch_status`) | codec prouvé ; **effet en jeu non prouvé** (porte B) |
| VMF (`read_vmf`, `read_vmf_lint`, `read_fgd_class`) | **prouvé** — chaque règle vérifiée par une faute injectée |
| Compile (`run_compile`, `read_compile_log`, `read_leak`, `run_pack`) | **prouvé** — fuite provoquée puis localisée |
| Audit | à écrire |
| Données de l'ancienne prod | à écrire |
| Sidecar Python (srctools) | **installé et prouvé** — voir ci-dessous |
| Mesure (`read_map_extents`, `read_map_geometry`, `read_prop_survey`) | **prouvé** — recoupe trois mesures indépendantes |

## Les portes de faisabilité

### Porte A — les compilateurs sous Wine : **passée le 02/08/2026**

`vbsp.exe`, `vvis.exe` et `vrad.exe` (build « Garry's Mod Edition », 22/07/2026) se chargent et
s'exécutent sous wine 9.0, `WINEPREFIX=~/.wine`, cwd forcé sur le répertoire `bin` pour que
`tier0.dll` résolve.

Compile complet de la carte sonde `test/fixtures/hmcp_probe.vmf` (une pièce scellée, un
`info_player_start`, une lumière, un `info_target` marqueur) :

| Étape | Sortie | Code |
|---|---|---|
| `vbsp -game <garrysmod> hmcp_probe.vmf` | `hmcp_probe.bsp`, aucune fuite | 0 |
| `vvis -fast` | 4 portails, 16 clusters visibles | 0 |
| `vrad -fast` | 32 triangles, lighting écrit | 0 |

Résultat : `.bsp` de 56 236 octets, VBSP version 20, `mapRevision` 1. Il est commité comme fixture.

Un seul avertissement, bénin : `Skybox vtf files for skybox/sky_day01_01 weren't compiled with the
same size texture` — vbsp ne peut pas construire le cubemap par défaut. Sans effet sur la
géométrie.

**Le chemin doit être en forme Windows absolue** (`Z:\...`). Un chemin relatif se résout contre le
cwd de wine et compile silencieusement le mauvais fichier. `WINEDEBUG=-all` est indispensable :
sinon stderr est un mur de `fixme:`.

### Porte C — la chaîne Hammer++ sous Wine : **passée le 11/08/2026**

`vbspplusplus.exe`, `vvisplusplus.exe`, `vradplusplus.exe` et `bspzipplusplus.exe` (builds de
juin 2026) s'exécutent sous le même wine 9.0 que la chaîne stock, sans DLL supplémentaire.

**Ce que la porte a corrigé, et c'est l'essentiel : ils ne vivent pas là où on les attendait.**

| | stock | Hammer++ |
|---|---|---|
| Répertoire | `GarrysMod/bin/` | `GarrysMod/bin/win64/` |
| Architecture | PE32 i386 | PE32+ x86-64 |
| Les `.fgd` | `bin/` | — (`toolsplusplus.fgd` livré avec, à part) |

`bin/win64/` a **aussi** ses propres `vbsp.exe`/`vvis.exe`/`vrad.exe` 64-bit stock, et exige la
branche bêta **x86-64** de GMod (`BetaKey "x86-64"` dans `appmanifest_4000.acf`). Conséquence pour
la configuration : `gmodBin` désigne à la fois le dossier des compilateurs **et** celui des `.fgd`
— les deux rôles se séparent ici, et un seul chemin ne suffit plus.

Deux archives distinctes, contrairement à ce que la page de téléchargement laisse croire :

- `hammerplusplus_gmod_build8871.zip` — l'**éditeur seul**, aucun compilateur dedans ;
- `tools_plusplus.zip` (dépôt `ficool2/misc_tools`) — les quatre compilateurs, `studiomdlplusplus`
  et `toolsplusplus.fgd`. Son dossier `compatibility/` **n'a pas été installé** : il contient
  `tier0.dll`, `vstdlib.dll`, `filesystem_stdio.dll` et consorts, qui écraseraient ceux de
  l'install Steam. Rien n'en a eu besoin.

Compile complet de `test/fixtures/hmcp_probe.vmf`, les trois étapes à 0 :

| | PLANES | VERTEXES | TEXINFO | FACES | BRUSHES |
|---|---|---|---|---|---|
| stock | 40 | 35 | 3 | 16 | 6 |
| Hammer++ | 40 | 35 | 3 | 16 | 6 |

**Contrôle négatif** — sans lui la porte ne prouverait qu'une carte qui marche. `info_player_start`
déplacé en `0 0 2000`, hors du volume scellé : VBSP++ imprime le même `**** leaked ****`, la même
ligne `Entity info_player_start (0.00 0.00 2000.00) leaked!`, et écrit un `.lin` de deux points **au
même format, l'entité au second** — exactement la convention sur laquelle `read_leak` est calibré.

Les quatre sorties brutes sont versionnées dans `test/fixtures/logs/` et rejouées par
`test/compile.test.ts` : `parseCompileLog` reste muet sur les trois compiles propres et voit la
fuite. Cela prouve ces deux cas, **pas** que toutes les erreurs des builds `++` sont couvertes —
leurs messages propres n'ont pas encore d'échantillon.

### Ce que la chaîne Hammer++ rapporte, et ce qu'elle ne rapporte pas

Un seul flag est exposé — `cull` sur `run_compile` — parce qu'un seul a pu être mesuré ici.

**`cull`** active `-cullverts -cullplanes -cullbrushes -cullbrushsides` : vbsp ne supprime
normalement ce que rien ne référence qu'une fois une limite atteinte. Sur `ttt_traps.vmf`,
mesuré le 11/08/2026 :

| | sans | avec | écart |
|---|---|---|---|
| `PLANES` | 400 | 318 | **−20,5 %** |
| `VERTEXES` | 725 | 632 | **−12,8 %** |
| `FACES` | 441 | 441 | 0 |
| `TEXINFO` | 101 | 101 | 0 |
| octets | 218 912 | 195 936 | **−10,5 %** |

Faces et texinfos inchangés : c'est ce qui distingue un élagage d'une carte cassée. `BRUSHES` et
`BRUSHSIDES` n'ont pas bougé non plus — cette carte n'a rien d'inutilisé de ce côté, pas la preuve
que les deux flags ne servent à rien.

`cull` sur la chaîne stock est **refusé**, pas ignoré : vbsp accepte les options inconnues en
silence, et une compile qui annonce un succès sans avoir rien élagué est pire qu'une erreur.

**Deux flags que la veille annonçait et qui ne tiennent pas ici** :

- **`-allowdynamicpropsasstatic` ne convertit rien.** Il lève le refus de vbsp sur un
  `prop_static` dont le modèle n'est pas marqué statique ; la conversion elle-même reste une
  édition du VMF. Non exposé : `ttt_traps.vmf` n'a **aucun** prop, et la seule carte qui en a 59
  (`rp_nycity_day`) n'a pas de source. Sans oracle constructible, pas d'outil — même règle que
  pour `read_vprof`.
- **`bspzip -threads` ne concerne pas `run_pack`.** Le multithread de BSPZIP++ est sur `-repack`,
  une autre opération ; `run_pack` fait `-addlist`. `toolchain: "plusplus"` lui donne quand même
  le binaire `++`. `-repack -compress` n'a pas été essayé : rien ne dit que GMod lise un lump
  compressé en LZMA.

### Porte B — GMod honore-t-il `maps/<map>_l_0.lmp` ? : **NON TESTÉE**

Le codec est écrit et prouvé contre un fichier de Valve (`srcds/garrysmod/maps/c1a1_l_0.lmp`), mais
**rien ne prouve encore que la branche GMod actuelle lise ces fichiers**. Les trois exemplaires
livrés avec Half-Life 2 prouvent que Source l'a supporté, pas que GMod le supporte aujourd'hui.

La vérification demande un redémarrage de `srcds`, partagé entre sessions. Protocole, sur
`gm_construct` et non sur la carte de production :

1. `write_lump_patch` avec un `info_target` nommé `hmcp_probe` ;
2. déployer par `./tools/sync-server-config.sh` — **seule route sanctionnée** vers
   `srcds/garrysmod/` ;
3. `./tools/start-server.sh gm_construct sandbox` ;
4. `mcp__gmod-mcp__read_entities` → 1 attendu ;
5. **contrôle négatif** : `mapRevision + 1`, redéployer, redémarrer → 0 attendu. C'est lui qui
   prouve le mécanisme plutôt qu'une coïncidence.

En cas d'échec, le repli est un manifeste GLua lu à `InitPostEntity`. À noter que même si la porte
passe, le manifeste reste préférable pour **ajouter** une entité : agnostique du format, il survit
à une recompilation et se recharge à chaud. L'avantage propre au `.lmp` est étroit mais réel :
**éditer ou supprimer une entité que la carte fait naître**, avant qu'elle naisse, keyvalues
comprises.

## Le format `.lmp`, tel que mesuré

En-tête de 20 octets, cinq `int32` petit-boutistes, puis la charge utile :

| Offset | Champ | Valeur |
|---|---|---|
| 0 | `lumpOffset` | 20 dans tous les fichiers livrés par Valve |
| 4 | `lumpID` | 0 pour la liste d'entités |
| 8 | `lumpVersion` | 0 |
| 12 | `lumpLength` | taille de la charge utile, NUL final compris |
| 16 | `mapRevision` | **doit égaler celui du `.bsp` cible** |

`mapRevision` est le dernier `int32` de l'en-tête du BSP, à l'**offset 1032** (`ident[4]` +
`version` + `lump_t[64]` × 16 octets). La charge utile d'entités se termine par un NUL, comme vbsp
l'écrit dans le BSP lui-même.

**Le piège du mécanisme** : si les deux révisions diffèrent, le moteur **ignore le patch sans rien
dire**. La carte charge, semble normale, et aucune édition n'est là. `write_lump_patch` recopie
donc toujours la révision depuis le BSP cible, et `encodeLmp` en fait un argument requis sans
valeur par défaut — il est impossible de l'omettre par distraction.

### Ce qu'un patch de lump ne peut pas faire

- **Rallumer la carte.** Le lump LIGHTING (42,3 Mo sur `rp_nycity_day`) est cuit par vrad. Ajouter
  un `light` par patch ne fait rien. L'outil avertit.
- **Créer de la géométrie.** Une entité `func_*` référence un modèle de brush (`*N`) que seul vbsp
  peut produire.
- **Atteindre les clients.** Le `.lmp` vit côté serveur et n'est pas référencé par le `.bsp` : il
  n'est jamais téléchargé. Les entités purement client (`env_sprite`, `info_particle_system`,
  `sky_camera`…) existeraient côté serveur et seraient invisibles pour tous les joueurs. L'outil
  avertit également.

## Jalon 1 — lecture prouvée contre `rp_nycity_day`

Mesuré le 02/08/2026 sur `srcds/garrysmod/addons/rp_nycity_day/maps/rp_nycity_day.bsp` :

| | |
|---|---|
| Taille | 1 130 563 848 octets (1,13 Go) |
| Version / `mapRevision` | VBSP 20 / 10863 |
| Lump 40 PAKFILE | 1004,0 Mo |
| Lump 8 LIGHTING | 42,3 Mo |
| Lump 0 ENTITIES | 1 548 648 octets, **3555 entités** |
| Durée de lecture | **79 ms** |

Histogramme : `light_spot` 1262 · `func_door_rotating` 451 · `trigger_soundscape` 211 ·
`func_button` 182 · `func_door` 171 · `path_track` 129 · `light` 111 ·
`prop_physics_multiplayer` 111 · `env_soundscape_proxy` 107 · `info_player_start` 100 ·
**`prop_dynamic` 59**. Total portes : **622**.

Les 59 `prop_dynamic` recoupent exactement le nombre qu'`addons/r-estate/README.md` avait mesuré
pour les props que `Entity:isDoor()` accepte à tort — deux mesures indépendantes qui tombent
juste, donc le parseur lit bien la carte que le serveur charge.

**Reste non fait** : le croisement contre le serveur vivant (`mcp__gmod-mcp__read_entities`), qui
est un oracle gratuit sur ce même nombre. Il demande un `srcds` démarré.

Les 79 ms tiennent à la lecture par offsets : seuls 1036 octets d'en-tête puis 1,5 Mo de lump sont
touchés. **Aucun lecteur ne doit jamais charger le fichier entier** — un `readFileSync` de 1,13 Go
dans un serveur MCP le tue transport stdio ouvert, ce que l'agent voit comme un blocage et non
comme une erreur.

## Discipline d'écriture

Les seules cibles d'écriture sont `server-config/**`, `.hammer-mcp/**` et ce que l'appelant passe
explicitement. `srcds/` et `reference/` sont refusés.

`srcds/` est géré par SteamCMD : un `validate` ou un changement de branche y remplace des fichiers,
donc ce qui est à nous y serait perdu sans avertissement. Ce qui est à nous vit dans
`server-config/` et est déployé par `./tools/sync-server-config.sh`.

**C'est de la discipline, pas de l'application.** Le hook `deny-readonly-trees.sh` du dépôt
intercepte les outils Edit/Write, il ne voit pas un `node:fs` appelé dans un serveur MCP. D'où
`src/fs/guard.ts` : un unique `assertWritable()` par lequel toute écriture transite, qui résout les
liens symboliques avant de juger (`srcds/garrysmod/addons/*` sont des liens vers `addons/`, donc un
chemin lexicalement innocent peut atterrir dans l'arbre SteamCMD), et un test de contrat qui
l'assert sur les chemins résolus.

## Le sidecar Python

Les formats Source sont déjà écrits, en Python. [`srctools`](https://github.com/TeamSpen210/srctools)
lit et écrit VMF, BSP, VPK, VTF, VMT et FGD, il est maintenu, et **aucune bibliothèque JS/TS ni
Rust mature n'existe pour le BSP**. Le réécrire aurait été des mois de travail sur des problèmes
déjà résolus.

`sidecar/` est donc un venv épinglé (`srctools==2.7.0`) et un point d'entrée unique : un verbe en
`argv[1]`, du JSON sur stdin, du JSON sur stdout, les diagnostics sur stderr. `./sidecar/setup.sh`
le construit ; le venv vit sous `<stateDir>/sidecar-venv`, hors du dépôt, parce que c'est de la
sortie de build propre à la machine.

**Un sous-processus par appel, pas de daemon, pas de verrou.** C'est ce qui garde hammer-mcp sans
état et hors du mode de panne qui a rendu `daemon.lock` nécessaire côté gmod-mcp. Le coût mesuré
d'un aller-retour est de **87 ms**, import de srctools compris — assez bas pour ne pas justifier un
processus résident.

**La frontière suit la fréquence d'appel, pas le format.** Ce qui est chaud et déjà prouvé reste en
TypeScript — lecture BSP par offsets, KeyValues à offsets préservés, codec `.lmp`. Ce qui est froid
et coûteux à réécrire passe ici — FGD, VTF, VPK, décompilation. La mesure tranche : notre lecteur
d'en-tête ouvre `rp_nycity_day.bsp` en **79 ms**, `BSP()` de srctools en **1,48 s**. Sur le chemin
chaud, on garde le nôtre.

### Ce que srctools lit chez nous, mesuré le 11/08/2026

| Fichier | Résultat |
|---|---|
| `ttt_traps.vmf` (7082 lignes, écrit par Hammer) | 65 entités, 24 brushes, 0,02 s |
| `rp_nycity_day.bsp` (1,13 Go) | VBSP 20, `mapRevision` **10863**, ouvert en 1,48 s |
| son lump 0 | **3554** entités en 0,27 s, `prop_dynamic` **59**, `light_spot` **1262** |

`mapRevision`, `prop_dynamic` et `light_spot` retombent **exactement** sur ce que notre lecteur
TypeScript et `r-estate` avaient mesuré séparément. Deux implémentations indépendantes qui
concordent sur trois nombres : c'est l'oracle qui fait qu'on peut se fier aux deux.

**Le quatrième nombre, lui, diffère de 1** — et il faut le savoir avant de crier au bug.
`read_bsp_entities` compte **3555**, srctools **3554** : srctools range le `worldspawn` à part
(`vmf.spawn`) et l'exclut de `vmf.entities`, là où notre lecteur le compte comme une entité du
lump. Les deux conventions sont défendables ; ce qui ne l'est pas, c'est de comparer les deux
chiffres sans le savoir.

### Décompilation

`bspsrc` est le seul décompilateur BSP→VMF mature, et il est en Java. Le `java` par défaut de cette
machine est en **1.8**, trop ancien — mais **17 et 21 sont installés** (`/usr/lib/jvm/`). Tout appel
devra donc pointer une JVM explicitement plutôt que se fier au `java` du PATH.

## Outils

Convention `gmod-mcp` : `read_*` observe, `run_*` exécute, verbe_nom mute, snake_case. Les outils
qui écrivent ou exécutent sont **gardés** — ils exigent `confirm: true`, ou leur nom dans
`toolAllowlist`.

| Outil | Realm | Gardé | Ce qu'il fait |
|---|---|---|---|
| `health` | `local` | | État de la chaîne d'outils : `gmodBin`, binaires présents, FGD, version de wine |
| `read_bsp_info` | `map` | | En-tête d'un `.bsp` : version, `mapRevision`, les 64 lumps |
| `read_bsp_entities` | `map` | | Entités du lump 0, filtrées et paginées, avec histogramme |
| `read_lump_patch` | `map` | | Décode un `.lmp` et ses entités |
| `write_lump_patch` | `map` | ● | Construit un patch d'entités par ops add/update/remove |
| `read_lump_patch_status` | `map` | | Compare `server-config/maps/` au déployé et aux révisions |
| `read_map_extents` | `map` | | Étendue réelle du monde (lump 14), en unités et en mètres |
| `read_map_geometry` | `map` | | Contenu de chaque lump et marge restante avant le plafond de vbsp |
| `read_prop_survey` | `map` | | Inventaire des props, et ceux qui sont `prop_dynamic` pour rien |
| `read_pakfile` | `map` | | Contenu du pakfile embarqué (lump 40), et les preuves de compilation qu'il porte |
| `read_sightlines` | `map` | | Les plus longues lignes de vue dégagées, tracées contre l'arbre du monde |
| `read_brush_volumes` | `map` | | Emprise au sol et volume de chaque entité-brush, par classe |
| `read_fgd_class` | `map` | | Le schéma d'une classe selon la FGD du jeu : keyvalues, entrées, sorties |
| `read_vmf` | `map` | | Entités, sorties et comptages d'un `.vmf`, sans jugement |
| `read_vmf_lint` | `map` | | Ce qui clochera à la compilation ou en jeu, avant de compiler |
| `run_compile` | `local` | ● | vbsp, vvis et vrad sous Wine, rendus en findings par étape. `toolchain: "plusplus"` pour la chaîne Hammer++ |
| `read_compile_log` | `map` | | Traduit la sortie d'un compilateur en findings expliqués |
| `read_leak` | `map` | | Transforme « leaked! » en un lieu et une entité nommée |
| `run_pack` | `local` | ● | Empaquette des fichiers dans un `.bsp` via bspzip, et vérifie. `toolchain` idem |
| `read_nav` | `map` | | Dit si un nav mesh correspond encore à sa carte |

Le realm `map` désigne le travail fichier hors ligne ; `local` un binaire de l'hôte. Ce ne sont
délibérément pas les `sv`/`cl` de gmod-mcp : ce serveur n'a pas de realm GLua.

## Jalon 2 — la mesure, recoupée par trois chemins indépendants

Mesuré le 11/08/2026 sur `rp_nycity_day`. Chaque nombre a un témoin extérieur : c'est ce qui
distingue une mesure d'une valeur affichée avec aplomb.

| Ce qu'on mesure | Résultat | Le témoin |
|---|---|---|
| Étendue du monde (lump 14) | mins `(-15424, -15936, -6208)`, **802,6 m** de portée, 639 338 m² | `rvehicles` §624 avait lu le même lump à la main : « la map fait 802 mètres », mêmes mins |
| `prop_dynamic` | **59** | `r-estate` les avait comptés par `Entity:isDoor()` en jeu |
| `mapRevision` | **10863** | notre lecteur TS, et srctools, séparément |
| Pakfile embarqué | **15 258 fichiers**, 1001,7 Mo | le lump 40 fait 1004 Mo au jalon 1 |

L'unité : **1 unité Hammer = 1 pouce = 0,0254 m**. Ce n'est pas une convention choisie, c'est le
rapport qui fait tomber la carte sur les 802 m relevés à la main.

### Le pakfile dit comment la carte a été compilée

`read_pakfile` ouvre le lump 40 — un ZIP ordinaire — et deux de ses comptes sont des **preuves
récupérables du fichier seul**, là où il faudrait sinon croire la mémoire de quelqu'un sur les
réglages de compilation :

- **345 `c-*.vtf`** → `buildcubemaps` a bien été exécuté ;
- **3983 `.vhv`** → l'éclairage par sommet des props statiques a été cuit (`-StaticPropLighting`).

Le reste de l'inventaire : 2840 `.vmt`, 2616 `.vtf`, 939 `.mdl`, 187 `.wav` et 63 `.mp3` — dont
trois pistes de club de plus de 10 Mo chacune — et un `.ain`, le nodegraph des NPC.

### Ce que la carte de production révèle sur sa propre chaîne de compilation

`read_map_geometry` compare chaque lump aux plafonds de `src/public/bspfile.h` du SDK 2013, lus à
la source. Trois lumps sont serrés — `TEXINFO` **96,4 %**, `VERTEXES` **95,0 %**, `BRUSHES`
**84,4 %** : cette carte ne peut plus beaucoup grandir.

Et un lump **dépasse** : `MODELS` à **1218 pour un plafond de 1024**, soit 119 %. La carte se
charge tous les jours. Ce n'est donc pas une carte cassée, **c'est la preuve que les compilateurs
qui l'ont produite relèvent ce plafond** — l'outil le dit dans ces termes plutôt que de crier à
l'erreur.

### Les lignes de vue, et les trois façons de se tromper avant d'y arriver

`read_sightlines` descend l'arbre BSP exactement comme le moteur le fait pour un
`util.TraceLine` — la récursion est celle de `SV_RecursiveHullCheck`, inchangée depuis Quake.
Trois lumps suffisent (PLANES, NODES, LEAFS) : 1,6 Mo lus sur une carte de 1,13 Go, arbre chargé en
**20 ms**, puis 26 000 tracés en 22 ms.

**Le traceur est validé contre un échantillonnage dense** — marcher le segment point par point doit
rendre le même verdict qu'une descente d'arbre. Mesuré le 11/08/2026 : **1275 accords sur 1276**
sur la carte de production, l'unique écart étant un mur plus fin que le pas d'échantillonnage. Sur
la carte sonde, qui est une pièce scellée, un rayon vers l'extérieur **doit** être bloqué : c'est le
contrôle négatif sans lequel un traceur qui répond « dégagé » partout passerait tous les autres
tests.

Restait à savoir **où échantillonner**. Trois méthodes ont été essayées et rendaient toutes des
nombres confiants et faux :

| Méthode | Ce qu'elle a rendu | Pourquoi c'était faux |
|---|---|---|
| Origines d'entités (`info_player_start`, `path_track`) | 706 m | les `path_track` montent à z=3980 — ce sont des trajets d'ascenseurs ; la médiane des spawns est à z=-380, une salle enterrée |
| Première surface sous un tracé vers le bas | 852 m, sol jusqu'à z=7232 | depuis le ciel, la première surface rencontrée est **le toit** |
| Surface la plus basse de la colonne | 820 m, z médian -6080 | le point le plus bas est le **plancher de la boîte à ciel**, sous la ville |

La méthode retenue ne s'appuie sur aucune convention inventée : **l'altitude où le mappeur a mis
son contenu**. La médiane des origines des 3452 entités tombe à **z=195**, et les entités de rue
confirment indépendamment — props à 76, portes à 121, ambiances à 168, lampadaires à 232. Un
histogramme des surfaces praticables place 320 d'entre elles dans la bande `z=0`, deuxième pic
derrière le plancher du vide. Deux signaux indépendants, même réponse.

**Ce que l'outil ne sait pas, et le dit** : un `.bsp` n'a aucune notion de « rue ». Les
`prop_static` (3986 sur cette carte) et les entités-brush ne sont pas dans l'arbre du monde — une
porte fermée s'y lit comme ouverte. L'outil renvoie ces réserves dans un champ `excludes` plutôt
que de laisser croire qu'il mesure ce qu'il ne mesure pas.

Résultat sur `rp_nycity_day`, pas de 512 u, 1051 points en zone bâtie, 551 775 paires en **387 ms** :
la plus longue ligne dégagée fait **30 278 u = 769 m**. Elle est réelle — vérifiée point par point —
mais elle traverse des dégagements, pas une avenue.

### Les surfaces bâties

`read_brush_volumes` lit la boîte englobante du modèle de chaque entité-brush (`model` `"*N"`,
lump 14). Sur `rp_nycity_day`, **les 1217 modèles sont attribués à 100 %** à une entité — c'est
l'oracle du raccord : un modèle orphelin signifierait que la correspondance est fausse.

| Classe | n | Emprise médiane |
|---|---|---|
| `func_door_rotating` | 451 | 0,14 m² |
| `trigger_soundscape` | 211 | 208,1 m² |
| `func_door` | 171 | 0,14 m² |
| `func_brush` | 26 | 64,0 m² |

Les comptes de portes retombent sur l'histogramme du jalon 1, et les ordres de grandeur se tiennent :
une porte est une dalle mince, une ambiance sonore couvre une pièce. **Ce sont des boîtes
englobantes, pas des volumes réels** — une pièce en L se mesure comme son rectangle enveloppant, et
l'outil le dit. Ce qu'il ne peut pas faire, c'est nommer un « lot » : un `.bsp` ne porte pas cette
notion, et `etalonnage-bronx` devra la définir par une convention explicite avant qu'on puisse la
mesurer.

### Le garde-fou qui empêche d'inventer un chiffre

Une taille de structure fausse produirait un compte plausible et faux. `read_map_geometry` ne
rapporte donc un compte que si la longueur du lump divise **exactement** par la taille de
l'enregistrement, et dit pourquoi quand ce n'est pas le cas. Il l'a fait dès le premier essai sur
`DISP_VERTS` : 944 944 octets ne sont pas un multiple des 20 attendus, aucun compte n'a été rendu.

### Pourquoi la liste des conversions `prop_static` n'était pas triviale

Le premier filtre cherchait la **présence** des clés `targetname`, `parentname`, `defaultanim`. Il
a rendu **0 candidat sur 59**, ce qui ressemblait à un résultat. Hammer écrit en réalité *toutes*
les clés de la classe avec leur valeur par défaut : les 59 props portent les trois. Seule une
**valeur non vide** signifie quelque chose — 29 parentés, 14 nommés, 2 animés. Le filtre corrigé
rend **17 candidats**, et l'outil accompagne la liste d'une réserve : convertir exige une
recompilation, et un modèle sans support statique ne se convertit pas du tout.

## La FGD comme schéma, et le lint qui s'y adosse

La FGD est ce que Hammer applique : quelles keyvalues une classe accepte, à quelles entrées elle
répond, quelles sorties elle sait émettre. Un VMF vérifié contre elle rend, **avant une compilation
de quarante minutes**, la faute qui ne se voit sinon qu'en jeu — une entité qui ne fait rien, sans
la moindre erreur.

C'est `garrysmod.fgd` de l'installation GMod qui fait foi, pas la base multi-jeux qu'embarque
srctools. Cette dernière est plus large et plus fausse pour nous : son `prop_dynamic` réunit **111
keyvalues** de tous les jeux Source, là où celui de GMod en déclare **39** ; et elle ignore
`sent_ball`, qu'un lint traiterait alors comme une classe inconnue.

**Un helper malformé ne coûte pas la FGD entière.** La ligne 187 de `garrysmod.fgd` déclare
`sphere(ball_size, 255, 255, 255, diameter)` — cinq arguments là où srctools en accepte 0, 1 ou 4 —
et le parse s'arrête. Les helpers sont des indices d'affichage pour Hammer : ils ne disent rien de
la validité d'une keyvalue. On les rend donc tolérants, et **ce qui a été toléré est compté et
rapporté** (`toleratedHelpers`) plutôt que d'être avalé en silence. Résultat : **563 classes en
0,22 s, un seul helper toléré**.

### En GMod, la FGD n'est pas toute la vérité

Un gamemode ou un addon enregistre ses propres entités en Lua, et Hammer n'en entend jamais parler.
Sur `ttt_traps.vmf`, le lint rendait **11 erreurs `unknown-classname` toutes fausses** :
`ttt_damageowner` est bel et bien défini par
`gamemodes/terrortown/entities/entities/ttt_damageowner.lua`.

`read_vmf_lint` scanne donc les entités Lua du dépôt — **488 classes trouvées** — et ne les accuse
plus. Le scan penche volontairement vers l'excès de savoir : une classe listée à tort coûte un
avertissement manqué, une classe oubliée coûte une accusation fausse sur toutes les cartes qui
l'utilisent.

Même prudence sur les cibles de sortie : une sortie qui vise un nom absent de la carte est un
**avertissement, pas une erreur**, parce qu'en GMod une entité créée par Lua peut porter ce nom à
l'exécution. C'est une piste, pas un verdict, et le message le dit.

### Chaque règle est prouvée par une faute injectée

Un lint qui ne trouve rien et un lint cassé se ressemblent exactement. Chaque règle a donc son
contrôle : une copie de la carte sonde, une faute précise dedans, et l'assurance que la règle la
nomme — et qu'elle reste muette sur l'original.

| Règle | La faute injectée |
|---|---|
| `unknown-classname` | `info_player_strat` au lieu de `info_player_start` |
| `unknown-keyvalue` | une clé inventée sur `info_player_start` |
| `bad-texture-scale` | échelle 0,01 — vbsp répond « Bad surface extents » en nommant une face introuvable dans Hammer |
| `output-target-missing` | un `logic_auto` qui vise `no_such_entity` |
| `displacement-on-entity` | rendue avec **le vrai identifiant de brush**, que vbsp n'imprime jamais (il affiche toujours 0) |

`read_fgd_class` propose les classes voisines quand on se trompe de nom — par distance d'édition,
pas par sous-chaîne : `prop_dynamik` ne contient aucune classe et n'est contenu par aucune, alors
qu'il est à une lettre de `prop_dynamic`. Et il restitue la casse déclarée (`SetAnimation`), que
srctools normalise en minuscules dans ses index.

## La compilation, et ce que les compilateurs ne disent pas

Trois réglages sont porteurs, tous mesurés et non devinés : le répertoire courant doit être `bin/`
ou `tier0.dll` ne se résout pas ; `WINEDEBUG=-all` est indispensable, sinon stderr est un mur de
`fixme:` ; et **le chemin doit être en forme Windows absolue** (`Z:\...`). Ce dernier est le plus
vicieux : un chemin relatif se résout contre le répertoire de travail de wine, et vbsp compile
alors **un autre fichier, sans erreur**. `toWindowsPath` refuse donc un chemin relatif plutôt que
de le convertir.

`run_compile` **s'arrête à la première étape qui échoue**. Enchaîner vvis après une fuite, c'est
dépenser une heure à calculer une visibilité qui ne veut rien dire.

### Le pointfile disait le contraire de ce que je croyais

`read_leak` lit le `.lin` que vbsp écrit à côté de la carte. J'avais supposé que son premier point
était l'entité fautive — c'est ce que raconte la tradition Quake. **Faux, mesuré le 11/08/2026** :
sur la carte sonde dont on avait sorti l'`info_player_start`, le pointfile fait deux points et
l'entité est sur le **second**. Ne corréler que le départ nommait une `light` à 232 unités et
manquait complètement la cause.

Les deux extrémités sont donc corrélées, et l'outil ne désigne un coupable que si une entité se
tient à moins de 16 unités d'un bout. Résultat sur la carte cassée : `info_player_start`, **à 0
unité**. Le contrôle négatif existe aussi — sans entité près d'un bout, l'outil ne désigne
personne, là où une corrélation naïve nommerait toujours sa plus proche voisine.

### Ce qu'un message de compilateur mérite comme traduction

Les compilateurs parlent à qui les a écrits en 2004, et plusieurs de leurs messages **désignent la
mauvaise chose**. Chaque règle porte donc la correction plutôt que de répéter la ligne :

| Message | Ce que la règle ajoute |
|---|---|
| `**** leaked ****` | aucune position — d'où le renvoi vers `read_leak` et le pointfile |
| `Displacement found on a(n) X entity` | l'identifiant de brush imprimé est **toujours 0** ; `read_vmf_lint` donne le vrai |
| `Bad surface extents` | nomme une face par un index introuvable dans Hammer |
| `Can't load skybox file … default cubemap` | **rien ne manque** — vbsp n'a pas pu construire un cubemap par défaut |

Ce dernier a coûté une correction : il déclenchait aussi la règle générique « matériau manquant »,
dont le conseil — empaqueter l'asset — était faux. Le classement est passé en **première règle qui
matche**, spécifiques avant génériques.

### run_pack ne croit pas son propre code de retour

`bspzip` sort en 0 qu'il ait ajouté quelque chose ou non. `run_pack` compte donc le contenu du
pakfile avant et après, et ne rend `ok: true` que si le nombre de fichiers a crû **exactement** de
ce qui était demandé. Vérifié : 1 → 2 fichiers, 34 876 → 36 876 octets.

## Le nav mesh, ou la panne qui ne dit rien

Recompiler une carte invalide toujours son nav mesh. Le moteur compare la taille de BSP inscrite
dans le `.nav` à celle de la carte qu'il charge, et **ne dit rien** quand elles diffèrent : en jeu,
cela se voit comme des Nextbots qui refusent de se déplacer, console muette.

`read_nav` lit cet en-tête. Vérifié contre la vérité terrain, au même octet, sur les deux cartes
livrées :

| Carte | Taille inscrite | Taille réelle du `.bsp` | Verdict |
|---|---|---|---|
| `gm_construct` | 36 735 656 | 36 735 656 | frais |
| `gm_flatgrass` | 47 430 424 | 47 430 424 | frais |

Le contrôle négatif accompagne : le même mesh posé à côté d'une carte d'une autre taille est
déclaré **périmé**. Sans lui, un vérificateur qui répondrait toujours « frais » serait
indiscernable sur toutes les cartes saines.

**Ce qui est prouvé et ce qui ne l'est pas** : magie, version, taille inscrite et drapeau
« analysé » sont lus au format documenté et recoupés sur deux fichiers. Le nombre de zones, lui,
est au **mieux indicatif** — `gm_construct` en annonce 2271 dans 7,2 Mo, soit 3189 octets chacune,
là où `gm_flatgrass` en annonce 853 à 325 octets. L'écart peut être réel — les points de cachette
et les chemins de rencontre croissent plus vite que le nombre de zones — mais rien ici ne le
démontre, et le champ est documenté comme tel plutôt que présenté comme une mesure.

**Générer un nav mesh reste hors de portée** : seul `nav_generate` en jeu le fait, et la veille n'a
trouvé aucun générateur hors moteur, ni ici ni ailleurs dans le domaine public.

## Architecture

```
src/kv/{lex,parse,serialize}.ts    KeyValues Valve, offsets préservés
src/bsp/{header,entities}.ts       lecteurs par offset, jamais le fichier entier
src/lmp/codec.ts                   codec du fichier de lump
src/entity/{model,edit}.ts         modèle d'entité commun aux trois formats, ops d'édition
src/fs/guard.ts                    assertWritable — point de passage unique
src/mcp/{registry,server}.ts       plomberie MCP
src/tools/*.ts                     définitions d'outils
```

### Pourquoi le chemin d'écriture est un splice et non une resérialisation

Viser un aller-retour octet-identique en resérialisant un VMF écrit par Hammer est un piège : la
grammaire admet des clés dupliquées dans un même bloc (plusieurs `solid`, plusieurs `side`, un
`connections` aux noms de sortie répétés), l'espacement de Hammer n'est pas régulier, et un
flottant comme `5416.0312` ne survit pas à un cycle parse → number → format. Une modification
d'une entité produirait un diff de milliers de lignes.

L'AST garde donc `[start, end)` pour chaque bloc et chaque paire, et les éditions sont des
remplacements de plages appliqués de droite à gauche. **Tout ce qui n'est pas touché est
octet-identique par construction.** Seuls les blocs neufs sont formatés.

`serialize()` existe, mais pour formater ce qu'on **crée**, pas pour réécrire ce qu'on édite.
L'oracle de test correspondant est `findOffsetGaps()` : il vérifie que les offsets analysés rendent
compte de la totalité de la source — nœuds ordonnés, sans recouvrement, et entre eux rien d'autre
que de l'espace ou un commentaire. C'est exactement la propriété dont dépend le splice. Il passe
sur `ttt_traps.vmf` (7082 lignes, écrit par Hammer).

## Plomberie partagée avec gmod-mcp

`src/mcp/registry.ts`, `src/mcp/server.ts`, `src/config.ts`, `src/logger.ts`, `src/install.ts` et
`src/proc/run.ts` étaient des copies adaptées de celles de gmod-mcp, dupliquées **délibérément** :
un paquet partagé paraissait prématuré pour ~350 lignes entre deux dépôts. Le seuil de révision
inscrit ici était « un troisième serveur MCP, ou le même bug de plomberie corrigé deux fois ».

**Il a été atteint le 11/08/2026** : la dérive était déjà mesurable (`clip()` recopiée deux fois
côté gmod-mcp, `stripAnsi()` d'un seul côté, le bloc image de l'autre) et la montée du SDK de
`^1.12` à `1.30` allait devoir être faite et prouvée deux fois. Ces six fichiers sont désormais des
adaptateurs de trois lignes au-dessus de [`@rolists/mcp-core`](../mcp-core/README.md), dépôt frère.

Ce qui **ne monte pas** au noyau : `src/fs/guard.ts`, propre à nos arbres d'écriture, et l'enum
`Realm` — `map`/`local` reste délibérément distinct des `sv`/`cl`/`local` de gmod-mcp. Les cycles
de vie non plus ne fusionnent pas : gmod-mcp tient un verrou et un transport vers un moteur vivant,
hammer-mcp est sans état. **Deux serveurs, un noyau.**

## Développement

```bash
pnpm install
pnpm build       # tsc -> dist/
pnpm test        # vitest
pnpm typecheck   # tsc --noEmit, tests inclus
```

Enregistrement auprès de Claude Code :

```bash
node dist/index.js install     # fusionne dans <repoRoot>/.mcp.json, préserve gmod-mcp
```

`.claude/settings.json` du dépôt parent porte déjà `"hammer-mcp"` dans `enabledMcpjsonServers` et
les outils `read_*` dans sa liste d'autorisations — les outils gardés en sont volontairement
absents.

**`.mcp.json` n'est pas suivi par git** : la liste blanche du `.gitignore` parent l'exclut, parce
qu'il porte des chemins **absolus** — le même motif qui en exclut les `.luarc.json`. La commande
`install` est donc à relancer **dans chaque clone**, après `pnpm build`.

### Fixtures

`test/fixtures/hmcp_probe.{vmf,bsp}` sont à nous — produits par `gen_probe.py`, compilés par la
porte A. Les fichiers de Valve (`ttt_traps.vmf`, `c1a1_l_0.lmp`) sont lus depuis `srcds/` et non
commités : cet arbre est géré par SteamCMD, et ces fichiers ne sont pas les nôtres. Les tests qui
en dépendent se sautent proprement quand ils sont absents ; les deux ont bien tourné le 02/08/2026.

## Configuration

`<repoRoot>/.hammer-mcp/config.json`, tous les champs optionnels :

| Champ | Défaut |
|---|---|
| `gmodBin` | `~/.steam/steam/steamapps/common/GarrysMod/bin` |
| `gmodBinPlusPlus` | `<gmodBin>/win64` |
| `gmodGameDir` | `~/.steam/steam/steamapps/common/GarrysMod/garrysmod` |
| `backend` | `wine` |
| `winePrefix` | `~/.wine` |
| `sidecarPython` | `<stateDir>/sidecar-venv/bin/python` |
| `toolAllowlist` | `[]` |

La chaîne d'outils Source vit **hors du dépôt**, dans la bibliothèque Steam, et livrée avec le
**client** GMod — `srcds/bin/` n'en contient rien. Ces chemins sont donc propres à la machine, et
aucun outil qui en dépend ne doit lever : il rapporte ce qui manque.

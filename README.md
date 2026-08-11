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
| VMF | à écrire |
| Compile | porte A passée ; outils à écrire |
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
| `gmodGameDir` | `~/.steam/steam/steamapps/common/GarrysMod/garrysmod` |
| `backend` | `wine` |
| `winePrefix` | `~/.wine` |
| `sidecarPython` | `<stateDir>/sidecar-venv/bin/python` |
| `toolAllowlist` | `[]` |

La chaîne d'outils Source vit **hors du dépôt**, dans la bibliothèque Steam, et livrée avec le
**client** GMod — `srcds/bin/` n'en contient rien. Ces chemins sont donc propres à la machine, et
aucun outil qui en dépend ne doit lever : il rapporte ce qui manque.

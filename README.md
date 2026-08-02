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

Le realm `map` désigne le travail fichier hors ligne ; `local` un binaire de l'hôte. Ce ne sont
délibérément pas les `sv`/`cl` de gmod-mcp : ce serveur n'a pas de realm GLua.

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

## Plomberie dupliquée depuis gmod-mcp — délibérément

`src/mcp/registry.ts`, `src/mcp/server.ts`, `src/config.ts`, `src/logger.ts`, `src/install.ts` et
`src/proc/run.ts` sont des copies adaptées. Les deux serveurs ont des cycles de vie différents —
gmod-mcp est un pont vers un moteur vivant, avec un état et un verrou ; hammer-mcp est de
l'outillage fichier sans état — et fusionner doublerait la surface d'un transport déjà assez
fragile pour nécessiter `daemon.lock`. Un paquet partagé serait prématuré pour ~350 lignes entre
deux dépôts.

**Seuil de révision** : un troisième serveur MCP, ou le même bug de plomberie corrigé deux fois.

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

Puis ajouter `"hammer-mcp"` à `enabledMcpjsonServers` dans `.claude/settings.json`, et n'y
autoriser que les outils `read_*`.

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
| `toolAllowlist` | `[]` |

La chaîne d'outils Source vit **hors du dépôt**, dans la bibliothèque Steam, et livrée avec le
**client** GMod — `srcds/bin/` n'en contient rien. Ces chemins sont donc propres à la machine, et
aucun outil qui en dépend ne doit lever : il rapporte ce qui manque.

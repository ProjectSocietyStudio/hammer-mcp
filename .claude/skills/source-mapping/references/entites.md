# Entités et système I/O

Ce que porte une entité, comment elle parle aux autres, et où finit ce qu'on peut changer sans
recompiler. La perf des trois classes de props est dans [performance.md](performance.md) ; le
détail GMod (FGD `garrysmod.fgd`, `mount.cfg`, portes DarkRP, nav mesh) est dans
[gmod.md](gmod.md) — une seule phrase de renvoi ici, pas de reprise.

## Point entity contre brush entity

Un **point entity** n'a qu'une position (`origin`, parfois des angles) — pas de volume propre. Un
**brush entity** est un ou plusieurs brushes rattachés à un modèle interne (`*N`) référencé dans le
lump `models`. `read_vmf` distingue les deux ; un `func_*` ou `trigger_*` sans brush attaché est un
VMF cassé, pas une entité valide. [consensus]

## Le lump 0 est du texte

**Le lump entités (`LUMP_ENTITIES`, index 0) est le seul lump texte pur du BSP** : une suite de
blocs `{ "classname" "..." "targetname" "..." ... }`, `worldspawn` en premier. [moteur] C'est ce
qui rend `read_bsp_entities` et le patch de lump possibles sans parseur binaire.

**Modifiable sans recompiler** : keyvalues, position, angles d'une entité existante ; ajout ou
suppression d'entités **point** ; les connexions I/O elles-mêmes (blocs `connections`). **Jamais
modifiable ainsi** : géométrie brush, displacement, lightmap, visibility — tout ce qui vit dans un
autre lump exige `vbsp`/`vvis`/`vrad`. Vérifier : `write_lump_patch` + `read_lump_patch_status`
(hammer-mcp) ; le détail du protocole de vérification en jeu est dans `SKILL.md`, pas ici.

⚠️ **Le patch de lump n'est pas prouvé côté jeu.** Le codec `.lmp` fonctionne — c'est mesuré — mais
personne n'a encore vérifié que Garry's Mod charge réellement un `.lmp` déposé à côté de son `.bsp`.
Tant que cette porte n'est pas passée, `write_lump_patch` produit un fichier valide dont l'effet en
jeu reste une hypothèse. Ne bâtis pas un plan de livraison dessus.

## Le format d'un output

`Cible , Input , Paramètre , Délai , Nombre de tirs` — identique dans tout Source 1. [moteur]

- Input vide → l'entité reçoit son `Use` par défaut (héritage GoldSrc). [consensus]
- Paramètre vide sur un output qui porte sa propre valeur (`OnHealthChanged` transmet la santé) →
  cette valeur passe telle quelle. [moteur]
- Délai en secondes, **relatif au déclenchement de l'output**, jamais un temps absolu de carte.
  [consensus]

Vérifier : `read_vmf` sur le bloc `connections {}` d'une entité, ou en jeu `ent_messages_draw 1` /
`run_console_command` (gmod-mcp).

## Résolution de la cible

Le moteur essaie d'abord un match sur **targetname** (exact ou wildcard) ; c'est seulement en
l'absence de match qu'il retombe sur le **classname**. [consensus]

⚠️ **Un targetname qui vaut un classname existant intercepte tout output destiné à cette classe** —
nommer une entité `prop_physics` capte les outputs adressés à tous les `prop_physics` de la carte.

**Wildcard : suffixe seulement.** `porte1*` matche `porte1_trigger` ; `*_lumiere` **ne matche
rien** en moteur stock (préfixe non supporté). Convention de nommage qui en découle : grouper des
entités liées sous un préfixe commun (`porte1_trigger`, `porte1_lumiere`) pour les cibler en une
fois via `porte1_*`, plutôt qu'un suffixe partagé. [moteur pour le comportement, consensus pour la
portée exacte] Mapbase étend au préfixe et au joker `?` — hors moteur stock/GMod.

**Deux entités partageant un targetname reçoivent toutes les deux l'input** — Hammer l'affiche en
gras dans la liste des noms, seul signal, aucune erreur de compile. Casse typique : deux portes
nommées pareil par accident s'ouvrent ensemble. [consensus]

Vérifier : `read_vmf` (histogramme des `targetname`), `read_vmf_lint` signale les cibles orphelines
qu'il peut résoudre statiquement.

## `!activator` / `!caller` / `!self` / `!player`

| Mot-clé | Résout vers |
|---|---|
| `!activator` | l'entité à l'origine de la chaîne causale (le joueur qui touche un `trigger_multiple`) |
| `!caller` | l'entité qui vient d'émettre l'output courant — diffère de `!activator` au milieu d'un relais |
| `!self` | l'entité qui reçoit l'input, valide seulement dans ses propres champs I/O |
| `!player` | raccourci vers le joueur solo, peu fiable en multijoueur |

[consensus] Vérifier en isolant une chaîne à deux relais et en comparant `!activator` reçu au
dernier maillon contre `!caller` — `ent_messages_draw` ou `read_console` (gmod-mcp) le montrent.

## Les `logic_*` qui comptent

| Entité | Sert à | Piège |
|---|---|---|
| `logic_relay` | centraliser un déclenchement vers plusieurs cibles, activable/désactivable sans toucher la source | mal nommé, il se confond avec une simple redirection — son intérêt est l'`Enable`/`Disable`, pas juste le fan-out |
| `logic_case` | brancher jusqu'à 16 valeurs (`OnCase01..16`), tirage aléatoire natif | pas de valeur par défaut si aucun cas ne matche — prévoir un `OnDefault` ou une garde |
| `logic_branch` + `logic_branch_listener` | décision binaire partagée entre plusieurs auditeurs | `logic_branch` seul ne notifie pas les autres branches — le listener est requis pour synchroniser |
| `math_counter` | compter des événements avant d'agir | son output `OutValue` ne se met pas seul à zéro — un `SetValue 0` explicite est nécessaire pour réarmer |
| `logic_auto` | déclencher une chaîne au chargement de la carte | compte comme un edict réseau, pas une entité purement logique — voir plus bas |

Vérifier : `read_vmf` pour l'inventaire, `read_fgd_class` pour les inputs/outputs exacts d'une
classe avant de l'employer.

## `logic_auto` et l'ordre de spawn

`OnMapSpawn` se déclenche **avant que le joueur soit garanti spawné** — y accéder sans délai peut
lever une violation d'accès. [consensus] **Aucune garantie d'ordre n'existe entre plusieurs
entités qui écoutent `OnMapSpawn` en parallèle** : deux `logic_auto` (ou relais alimentés par eux)
peuvent s'exécuter dans un ordre différent d'une partie à l'autre. [consensus] Un `logic_auto`
compte comme un edict réseau, pas une entité purement logique — `logic_relay` sur son `OnSpawn` est
l'alternative si l'edict compte. [moteur]

Vérifier : ajouter un délai court et observer si le bug d'accès disparaît ; pas d'outil qui prouve
l'ordre a priori — jugement humain, non outillé.

## Triggers et leurs flags

`trigger` (la classe de base, hors FGD) ne doit jamais être posée telle quelle : `InitTrigger`
n'est pas appelé, donc ni modèle ni collision ne se mettent en place. [moteur] Utiliser
`trigger_multiple`/`trigger_once`/etc., qui en héritent correctement.

⚠️ **Le flag `Clients (Players)` n'est souvent pas coché par défaut.** Sans lui, le trigger existe,
compile, ne produit **aucune erreur en jeu** — il ignore simplement le joueur et ne réagit qu'aux
classes couvertes par ses autres flags (NPC, physique). C'est l'erreur la plus signalée du mapping
Source parce que rien ne prévient qu'elle manque. [consensus]

Vérifier : `read_vmf_lint` (si la règle est couverte) ou en jeu, spawn + traverser en `gmod-mcp` →
`spawn_entity` puis observer l'absence d'output.

## Filtres

Un `filter_*` examine un activateur potentiel et le rejette s'il ne correspond pas — référencé par
le keyvalue `Filter Name` du trigger ou de l'entité qui l'utilise. `filter_multi` combine plusieurs
filtres. [moteur] `filter_activator_name` / `filter_activator_class` couvrent le cas courant ;
préférer un filtre réutilisable sur plusieurs triggers plutôt qu'empiler des `logic_case` sur
classname.

⚠️ **Un filtre ne se désactive pas par un Output — seulement en le détruisant** (`Kill`). [moteur]

Vérifier : `read_fgd_class` sur le filtre exact avant de l'employer — la liste des filtres varie
selon le jeu (26 classes recensées côté moteur stock, dont plusieurs spécifiques à un gamemode).

## Les limites dures — ne pas confondre les deux familles

**`MAX_MAP_ENTITIES` = 8192 est une limite de compilation**, celle du lump 0 tel que `vbsp`
l'écrit — dépassée, `vbsp` refuse avec une erreur explicite. [moteur, `bspfile.h:62`]

**`MAX_EDICTS` = 2048 est la limite runtime du moteur Source stock 2013** — combien d'entités
réseau (joueurs, NPC, props spawnés compris) peuvent exister *en même temps en jeu*. [moteur,
`const.h:65-67`] Ce sont deux compteurs différents, mesurés à deux moments différents ; une carte
peut respecter l'un et épuiser l'autre une fois des joueurs dedans.

**La valeur runtime relevée par Garry's Mod n'est pas vérifiable dans ce dépôt** (moteur fermé) :
`[consensus]`, à mesurer sur l'instance réelle plutôt qu'à citer de mémoire. Détail et méthode de
mesure dans [gmod.md](gmod.md), §« Deux chiffres à ne pas confondre avec leur voisin ».

Vérifier le compte de compilation : `read_bsp_entities` / `read_map_extents` (hammer-mcp). Vérifier
le compte runtime réel : `read_entities` (gmod-mcp).

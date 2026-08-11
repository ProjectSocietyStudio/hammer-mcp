---
name: source-map
description: Travailler une carte Source / Garry's Mod — mesurer, auditer, éditer un VMF, compiler, empaqueter, livrer. Utiliser dès qu'il est question de carte, .vmf, .bsp, Hammer, vbsp/vvis/vrad, fuite (leak), lightmap, cubemap, nav mesh, packing d'assets, ou de rp_nycity_day elle-même.
---

# Travailler une carte Source

L'outillage vit dans **`hammer-mcp`** (hors ligne : fichiers, compilateurs) et **`gmod-mcp`**
(en ligne : le moteur qui tourne). Cette skill dit **quoi faire et dans quel ordre** ; les seuils,
les limites et les schémas vivent dans les outils, où ils sont vérifiés, pas ici.

Elle couvre **l'outillage**. Le savoir-métier — brushwork, VIS, éclairage, displacements, perfs,
level design — vit dans la skill `source-mapping`, qui ne recopie pas celle-ci.

`hammer-mcp` est public depuis le 11/08/2026 : son journal de mesures est dans
[`docs/`](https://github.com/ProjectSocietyStudio/hammer-mcp/tree/main/docs), et ce qui est prouvé
y est séparé de ce qui ne l'est pas.

## La règle qui prime

**Un `.bsp` ne se lit pas à la main.** La carte de production fait 1,13 Go, dont 1004 Mo de
pakfile. Un `readFileSync` dessus tue le transport MCP, et l'agent voit un blocage, pas une erreur.
Tous les lecteurs de `hammer-mcp` vont par offsets — ils lisent 1,5 Mo là où le fichier en fait
1 130. Ne jamais contourner l'outil.

## L'état des lieux avant tout

| Question | L'outil |
|---|---|
| Qu'est-ce qui est cassé dans ma chaîne ? | `health` — profil de jeu actif, binaires Wine, FGD, sidecar Python |
| Sur quel jeu je travaille ? | `read_source_games` — ce qui est installé, lu chez Steam et dans `gameinfo.txt` |
| Quelle taille fait cette carte ? | `read_map_extents` |
| Peut-elle encore grandir ? | `read_map_geometry` |
| Qu'est-ce qu'elle embarque ? | `read_pakfile` |
| Qu'y a-t-il dedans ? | `read_bsp_entities`, `read_prop_survey` |

Sur `rp_nycity_day`, la réponse à « peut-elle grandir » est **non** : `TEXINFO` à 96 %, `VERTEXES`
à 95 %, et `MODELS` **au-delà de son plafond** (1218 pour 1024). Ce dernier point ne veut pas dire
que la carte est cassée — elle se charge tous les jours — mais que ses compilateurs relèvent ce
plafond. Toute proposition qui ajoute de la géométrie doit commencer par là.

**Le jeu n'est plus supposé.** Les outils qui en dépendent prennent un argument `game` et
**rendent dans leur sortie le profil contre lequel ils ont répondu**, plus s'il vient de l'appel ou
de la configuration. Un id inconnu est refusé en nommant ceux qui existent, jamais résolu vers le
défaut. Seul GMod a réellement été exécuté ; les autres profils sont plausibles et non vérifiés, et
`health` dit pour chaque valeur d'où elle vient.

## Éditer une carte dont on n'a pas la source

C'est le cas de la production. Il n'existe pas de `.vmf` de `rp_nycity_day`.

**Le patch de lump** (`write_lump_patch`) réécrit la liste d'entités d'un `.bsp` compilé sans
recompiler. Il permet d'**éditer ou supprimer une entité que la carte fait naître**, avant qu'elle
naisse — ce qu'aucun script Lua ne peut faire. Il ne peut pas : rallumer la carte (le lump LIGHTING
est cuit), créer de la géométrie, ni atteindre les clients (le `.lmp` vit côté serveur).

**Pour simplement ajouter une entité, préférer un manifeste GLua** lu à `InitPostEntity` :
agnostique du format, survit à une recompilation, se recharge à chaud.

⚠️ **La porte B n'est pas passée.** Rien ne prouve encore que la branche GMod actuelle lise les
fichiers `.lmp`. Le protocole de vérification, contrôle négatif compris, est dans
`hammer-mcp/README.md`. Ne pas présenter un patch de lump comme fonctionnel avant.

## Écrire ou modifier un VMF

1. `read_fgd_class` avant d'inventer une keyvalue — la FGD du jeu est le schéma que Hammer
   applique, et elle a réponse à « est-ce que cette classe accepte cette clé ».
2. `read_vmf_lint` **avant chaque compilation**. Il attrape en une seconde ce qu'une compilation
   met quarante minutes à refuser, et ce qui ne se voit sinon qu'en jeu.
3. `edit_vmf` fait un splice sur le texte d'origine : entités, keyvalues, sorties. **Tout ce qui
   n'est pas touché reste octet pour octet identique**, donc un changement d'une entité donne un
   diff d'une entité. Il est gardé (`confirm: true`) et écrit un `.bak` par défaut.

   Ne jamais resérialiser un VMF. Ce qu'une resérialisation coûte a été mesuré, et ce n'est pas ce
   qu'on croit : notre formateur recopie les valeurs verbatim, donc `5416.0312` y survit. Ce qui
   ne survit pas, c'est ce que la grammaire ne modélise pas — **commentaires `//`, lignes vides,
   indentation qui n'est pas une tabulation par niveau**. Les éditeurs tiers et les cartes
   retouchées à la main en ont, et la perte est silencieuse. (Le sidecar Python, lui, relit les
   valeurs comme des nombres : ne jamais écrire un VMF par là.)

   **Il ne crée pas de géométrie de brush**, délibérément : choisir des plans et des axes de
   texture sans contrôle visuel produit des cartes qui compilent et qui sont fausses.

**En GMod, la FGD n'est pas toute la vérité** : le Lua enregistre ses propres entités. Un
`unknown-classname` sur une classe `ttt_*` ou `r*` est probablement un faux positif — le lint
connaît déjà les entités Lua du dépôt et les classes des compilateurs Hammer++, mais pas celles
d'un addon absent. Il dit contre quels schémas il a tranché (`fgdsLoaded`).

**Une carte à `func_instance` se lit dépliée ou pas du tout.** Repliée, une instance est une entité
là où il y a un bâtiment : les comptages sont massivement sous-estimés, et toute sortie qui franchit
la frontière d'une instance ressemble à une référence morte. `read_vmf` et `read_vmf_lint` prennent
`collapseInstances: true` — à mettre dès qu'un `func_instance` apparaît dans l'histogramme.

## Compiler

Détail dans [references/compile.md](references/compile.md). L'essentiel :

- `read_vmf_lint` d'abord, toujours.
- `run_compile` avec `fast: true` pour itérer ; `fast: false` seulement pour livrer.
- `toolchain: "stock"` par défaut. `"plusplus"` quand vvis dure des heures ou qu'une carte bute
  sur une limite — et alors recompiler en `stock` pour comparer avant de conclure quoi que ce soit.
- **Copier le `.vmf` hors de `srcds/` et `reference/` avant de compiler** : le compilateur écrit le
  `.bsp` à côté de sa source, et les hooks refusent ces deux arbres.
- Une **fuite invalide tout ce qui suit**. `run_compile` s'arrête de lui-même à l'étape fautive.
- `read_leak` transforme « leaked! » en une entité nommée. Les compilateurs, eux, ne donnent
  aucune position.

## Optimiser, éclairer, livrer

Trois domaines où le comptage est automatisable et le **placement ne l'est pas** :

- [references/optimisation.md](references/optimisation.md) — visleaves, `func_detail`, hints,
  areaportals, props.
- [references/eclairage.md](references/eclairage.md) — lightmaps, HDR, cubemaps, props statiques.
- [references/livraison.md](references/livraison.md) — packing, nav mesh, contrôle avant livraison.

## Ce qu'aucun outil ici ne sait faire

À dire plutôt qu'à contourner :

- **Nommer une rue, un lot, un quartier.** Un `.bsp` ne porte pas ces notions. `read_sightlines`
  mesure des lignes de vue entre points praticables, pas « la plus longue avenue » ; si une spec a
  besoin de « lot », elle doit d'abord définir la convention qui le délimite.
- **Voir les props et les entités-brush.** Le traceur ne connaît que l'arbre du monde : une porte
  fermée s'y lit comme ouverte.
- **Générer un nav mesh.** Seul `nav_generate` en jeu le fait. Aucun générateur hors moteur
  n'existe, ici ou ailleurs.
- **Juger.** Quel mur est structurel, où poser un hint, si une carte est belle. Compter les
  areaportals est automatique ; décider où les mettre ne l'est pas.

## Le serveur est partagé

`srcds` et le daemon `gmod-mcp` sont partagés entre sessions. **Ne jamais les redémarrer
unilatéralement** — deux daemons détruisent le transport en silence. Toute vérification en jeu
(porte B, `buildcubemaps`, `nav_generate`, croisement de comptage) se demande, elle ne se décide
pas.

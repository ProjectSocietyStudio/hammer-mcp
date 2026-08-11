# Performance client et serveur

Ce qui coûte des images par seconde, et ce qui coûte des millisecondes de tick serveur, sont deux
sujets distincts — l'un se mesure en jeu sur un client, l'autre sur les 60+ joueurs connectés.
La **visibilité** (VIS, areaportals, hints, occluders) prime sur tout le reste : c'est ce qui décide
si une chose est dessinée du tout, avant même de demander combien elle coûte. Détail :
[visibilite.md](visibilite.md) — n'en refais pas le contenu ici.

## La règle qui résume tout, côté client

**Le nombre de triangles à l'écran n'est presque jamais le facteur limitant.** Le goulot typique
est le nombre de **draw calls** (un par changement de matériau ou par prop non batché), le
**fillrate** (overdraw, transparence) et, côté serveur, le nombre d'entités simulées. [consensus]

⚠️ **« Source n'a pas de `r_speeds` » est [contesté].** La cvar existe bien dans le moteur — c'est
un héritage GoldSrc — mais elle est devenue peu informative sur Source, où `+showbudget` et
`mat_wireframe` la remplacent en pratique. Dire « Source n'a pas de r_speeds » revient donc à
recopier une inexactitude répétée par la doc communautaire ; la formulation correcte est
« obsolète, pas absente ».

**Aucun budget de triangles officiel Valve n'a été retrouvé pour une scène complète.** Les seuls
chiffres Valve identifiés (3000 à 7500 tris) portent sur des **modèles individuels** de HL2, datés
2004 — pas une scène. Les seuils « restez sous 10 000/20 000 tris visibles » qui circulent sur les
forums de mapping sont du folklore sans source primaire. [contesté] Ne pas citer de chiffre : le
budget se **mesure** sur cette carte, avec `+showbudget` (catégorie rendu monde, en ms/frame) et
`mat_wireframe 2` pour voir ce qui est réellement dessiné depuis les points de vue joueur réels.

## `prop_static` / `prop_dynamic` / `prop_physics`

| | `prop_static` | `prop_dynamic` | `prop_physics` |
|---|---|---|---|
| Edict | non — pas d'entité réseau après compile [moteur] | oui | oui |
| Batching | oui, prop combine possible à la compile | non | non |
| Coût par tick | quasi nul | faible, entité réelle même immobile | simulation VPhysics à chaque tick |
| Éclairage | bakeable en lightmap ou per-vertex, coût VRAD | dynamique | dynamique |
| Quand | tout objet qui ne bouge, ne s'anime et n'a ni I/O ni parent — la grande majorité du décor | animation, parentage, changement de skin/modèle à l'exécution | ramassable, poussable, destructible |

⚠️ **« `prop_static` est gratuit » est approximatif.** Pas d'edict ne veut pas dire pas de coût :
lightmaps par LOD, VRAM, temps VRAD avec `-StaticPropLighting`. C'est la classe la moins chère du
moteur, pas une classe sans coût. [moteur]

`func_lod` fait la même chose qu'un `prop_static` en fade mais **reste un edict** — n'y recourir
que si le modèle ne peut vraiment pas devenir un prop. [moteur, VDC `Func_lod`]

Mesurer : `read_prop_survey` (hammer-mcp) liste les `prop_dynamic` sans nom, parent, animation ni
sortie — candidats à la conversion, jamais un verdict, puisque convertir exige de recompiler et
qu'un modèle sans support statique ne se convertit pas. Sur `rp_nycity_day` : 59 `prop_dynamic`,
17 candidats identifiés, 42 justifiés (parentés, nommés ou animés).

## Brush contre modèle

| | Brush (world ou `func_detail`) | Modèle (`prop_static`) |
|---|---|---|
| VIS | profite nativement du culling par visleaf | aucun impact sur le découpage (sauf s'il est structurel via `func_brush`, qui n'en a pas) |
| Lightmapping | natif, cohérent avec le reste du monde | lightmap par LOD, coût VRAM propre |
| Coût de compile | subdivise les visleaves si posé en world brush non-detail | aucun coût VIS, profite du LOD modèle |
| Bon usage | grande surface plane, structure porteuse | détail architectural complexe, non bloquant pour le gameplay |

**Un radiateur ou une balustrade en world brush peut fragmenter le VIS d'une zone entière** et
faire chuter le framerate d'endroits sans rapport avec l'objet — le réflexe est de le passer en
`func_detail` ou en modèle, pas de le garder en world brush par habitude. Le partage
structurel/détail et son diagnostic (`mat_leafvis`, `read_map_geometry`) sont dans
[visibilite.md](visibilite.md) et [brushwork.md](brushwork.md).

Ne pas remplacer systématiquement du brushwork simple par des modèles en pensant gagner : un
modèle échappe au VIS mais ajoute un draw call par renderable ; pour une grande surface plane, le
brush reste souvent moins cher.

## Fade distance et LOD

`fademindist`/`fademaxdist` réduit le nombre de renderables traités par frame, sans recompilation.
Le fade « pop » plutôt qu'il ne fond en douceur sur du matériel bas de gamme, et un petit objet
disparaît plus près qu'un gros à distance de fade égale. [moteur]

Le LOD d'un modèle (`$lod` du QC) ne se déclenche pas sur la distance brute à la caméra, mais sur
`(100 / pixels-écran-par-unité)` — dépend donc de la résolution, du FOV et de la taille à l'écran,
pas seulement des unités Hammer. Jusqu'à 8 niveaux par modèle. [moteur, VDC `$lod`]

Mesurer : comparer le framerate avec `fademaxdist` activé/désactivé, ou `r_drawothermodels 0/2`
pour isoler le poids des props dans la frame courante (`gmod-mcp` → `run_console_command`).

## Fillrate et overdraw

L'overdraw scale avec la **surface en pixels** des couches superposées, pas avec le nombre de
triangles — un feuillage low-poly avec plusieurs calques alpha peut coûter plus cher qu'un décor
massif opaque. [consensus] Transparence, réfraction (eau expensive), reflets spéculaires et HDR
sont les sources classiques de double rendu.

Eau : `WaterCheap` n'a ni réflexion ni réfraction temps réel (une réflexion appauvrie via `$envmap`
reste possible) ; `Water` expensive fait les deux. Le joueur peut forcer le fallback cheap depuis
les options vidéo — **toujours poser des `env_cubemap`** même en ne comptant que sur l'expensive,
car le fallback s'appuie dessus. [moteur]

Mesurer : `mat_fillrate 1` (aussi `mat_measurefillrate` selon la version) colore les pixels par
nombre de fois redessinés, à combiner avec `+showbudget` pour chiffrer en ms (`gmod-mcp` →
`run_console_command`).

## Ombres et matériaux coûteux

Les ombres de `prop_static` sur lightmap coûtent en temps VRAD, pas en temps de rendu — le budget
à surveiller est celui de la compile (`-StaticPropLighting`), pas celui du client. Les lightmaps
par prop peuvent avoir une résolution supérieure aux lightmaps de brush/displacement, avec un coût
VRAM par LOD. [moteur]

Un matériau normal-mappé désactive le per-vertex lighting des `prop_static` selon la branche du
moteur ; sur les branches qui le permettent, **un seul prop normal-mappé fait traiter tous les
autres props comme normal-mappés**, ce qui allonge VRAD pour toute la carte. [moteur]

## La charge serveur — un sujet distinct

Ce qui compte à 60 joueurs connectés n'est pas ce qui compte sur un client seul :

- **La boucle serveur (réseau, physique, Lua) est mono-thread.** Plus de cœurs n'aide quasiment
  pas le tick — seule la fréquence single-thread compte. [consensus]
- **`prop_physics` en nombre** : chaque instance ajoute un coût physique par tick (collision,
  intégration) en plus du coût edict/réseau. Une accumulation en sandbox se corrige par une limite
  de gameplay, pas en montant le tickrate — le tickrate ne corrige pas une simulation O(n) qui
  explose. [consensus]
- **La limite d'edicts réseau du moteur Source 1 est 2048** (`MAX_EDICTS`, `src/public/const.h`
  l.65-67) [moteur]. La valeur runtime effective sur la branche GMod du serveur n'est pas
  vérifiable dans ce dépôt (moteur fermé) — à mesurer via `gmod-mcp`, pas à citer de mémoire.
- **Monter le tickrate sans réduire la charge simulée sature le CPU** plutôt que d'améliorer la
  fluidité perçue. Le symptôme n'est pas réseau : `net_graph 4` montre la ligne `sv` clignoter en
  rouge quand le serveur consomme tout son budget de tick.

Mesurer côté serveur : `net_graph 4` (ligne `sv`), `vprof_generate_report` (rapport `.txt` par
sous-système, utile en post-mortem hors session live), et le comptage d'entités de la carte
(`read_bsp_entities`, hammer-mcp) à confronter à la limite d'edicts. Le détail par hook Lua — le
vrai coût CPU d'un `Think` ou d'un `PlayerTick` — n'est pas un sujet de cette page : voir
`.claude/skills/glua/references/perf.md`, qui documente `r_harness_hookcost` et `vprof` (HolyLib)
pour ça, et met en garde contre `fprofiler` qui ne fait pas ce qu'on lui prête.

## Mesurer, en un tableau

| Question | Outil |
|---|---|
| Budget de frame par sous-système moteur | `+showbudget` (`gmod-mcp` → `run_console_command`) — forcer `mat_queue_mode 0` pendant la mesure, sinon le multithreading fausse la répartition |
| Ce qui est réellement dessiné (pas juste dans le PVS) | `mat_wireframe 2` |
| L'overdraw / le fillrate | `mat_fillrate 1` |
| Le poids des props dans la frame | `r_drawothermodels 0` ou `2`, comparé |
| Charge réseau/CPU serveur en direct | `net_graph 4`, ligne `sv` |
| Profil par sous-système serveur, hors session live | `vprof_generate_report` (écrit un `.txt` dans le gamedir) |
| Candidats `prop_dynamic` → `prop_static` | `read_prop_survey` (hammer-mcp, hors ligne) |
| Ratio structurel/détail, comptages bruts | `read_map_geometry` (hammer-mcp, hors ligne) |
| Comptage d'entités contre la limite d'edicts | `read_bsp_entities` (hammer-mcp, hors ligne) |
| Coût par hook Lua (`Think`, `PlayerTick`…) | hors sujet ici — `glua/references/perf.md` |
| Où couper : quel modèle passer en `prop_static`, quel niveau de fade choisir | jugement humain, non outillé |

Aucun outil `read_vprof` n'existe dans ce dépôt : `vprof` se pilote par console
(`run_console_command`) et se lit via `vprof_generate_report`, pas via un lecteur `hammer-mcp` ou
`gmod-mcp` dédié — un tel outil est envisagé, pas construit.

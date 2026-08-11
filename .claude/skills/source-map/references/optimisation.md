# Optimiser la visibilité

Source ne dessine que ce que le joueur peut voir, et « peut voir » est décidé à la compilation.
Toute l'optimisation consiste à aider vvis à conclure que deux endroits ne se voient pas.

## Structurel contre `func_detail`

Le partage le plus rentable, et le seul jugement vraiment humain de cette page.

- **Structurel** : ce qui constitue l'ossature — les murs qui séparent, les sols, le plafond, la
  boîte qui scelle. vvis découpe le monde dessus.
- **`func_detail`** : tout le reste — moulures, poteaux, escaliers, mobilier en brush. Reversé dans
  le monde en `CONTENTS_DETAIL`, **invisible pour vvis**, ne découpe rien.

Règle : *si l'enlever n'ouvre pas une ligne de vue entre deux pièces, c'est du détail.*

⚠️ **Un `func_detail` ne scelle pas.** Une carte dont un mur extérieur est en détail fuit.

`read_map_geometry` donne le ratio ; il ne dit pas quel mur est lequel.

## Hints et skip

Un brush texturé `toolshint` sur une face et `toolsskip` sur les autres force une découpe de
visleaf là où on la veut. C'est l'outil du couloir en L : sans hint, vvis découpe mal et les deux
branches se voient.

Le placement dépend des lignes de vue réelles — **automatiser le comptage, pas le choix**.

## Areaportals et occluders

Deux mécanismes qu'on confond souvent :

| | `func_areaportal` | `func_occluder` |
|---|---|---|
| Quand | à la compilation, découpe réellement les visleaves | à l'exécution |
| Ce qu'il cache | tout | **seulement les props** |
| Contrainte | doit sceller hermétiquement une ouverture | aucune |

Un areaportal posé dans une embrasure de porte, lié à la porte, est le meilleur rapport
gain/effort d'une carte d'intérieurs. Mal scellé, il fait échouer la compilation.

## Les props

`read_prop_survey` liste les `prop_dynamic` qui n'ont ni nom, ni parent, ni animation, ni sortie :
ceux-là sont dynamiques pour rien. Chacun est une vraie entité serveur qui tourne à chaque tick et
que tout balayage de `ents.GetAll()` compte, là où un `prop_static` ne coûte rien.

**Mais convertir exige de recompiler**, et un modèle sans support statique ne se convertit pas.
La liste est un point de départ, pas un verdict — l'outil le dit lui-même.

Sur `rp_nycity_day` : 59 `prop_dynamic`, dont **17 candidats**. Les 42 autres sont parentés,
nommés ou animés.

## Mesurer

Hors ligne : `read_map_geometry` (comptages, marge avant les plafonds), `read_sightlines` (les plus
longues lignes de vue dégagées).

En jeu, et donc via `gmod-mcp` : `mat_leafvis`, `+showbudget`, `cl_showfps 2`, `r_speeds`,
`vprof_generate_report`. Toutes ces sorties sont du texte parsable — mais elles exigent un serveur
qui tourne, partagé, qu'on ne redémarre pas de son propre chef.

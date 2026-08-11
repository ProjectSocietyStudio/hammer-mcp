# Compiler une carte

## Les trois étapes

| Étape | Ce qu'elle fait | Ordre de grandeur |
|---|---|---|
| **vbsp** | construit l'arbre BSP, écrit la liste d'entités, détecte les fuites | secondes à minutes |
| **vvis** | calcule la visibilité entre visleaves (le PVS) | **la lente** — minutes à heures |
| **vrad** | radiosité : lightmaps, éclairage des props, échantillons d'ambiance | minutes à heures |

`run_compile` les enchaîne et **s'arrête à la première qui échoue**. Ce n'est pas de la prudence
excessive : lancer vvis après une fuite, c'est dépenser une heure à calculer une visibilité qui ne
veut rien dire.

## Itérer, puis livrer

- **Itérer** : `fast: true`. vvis rend un PVS conservateur, vrad un éclairage grossier. Qualité de
  développement uniquement, mais on voit sa carte en minutes.
- **Livrer** : `fast: false`, et `hdr: true` si la carte doit avoir un jeu de lightmaps HDR.
- **Ne toucher qu'aux entités** : rien à recompiler du tout. Un patch de lump suffit, ou
  `vbsp -onlyents` si on a la source.

## Quelle chaîne — stock ou Hammer++

`run_compile` prend `toolchain`. **Le défaut est `stock`, et ce n'est pas de la prudence** : le seul
moyen de savoir si la chaîne `++` a changé quelque chose qu'elle n'aurait pas dû, c'est de
recompiler la même source avec la chaîne stock et de comparer. Un défaut que personne n'a choisi
supprimerait cette comparaison sans que ça se voie.

| Situation | Chaîne |
|---|---|
| Itérer, livrer, tout le quotidien | `stock` |
| vvis dure des heures | `plusplus` — c'est là que le gain est massif |
| Une carte bute sur `MAX_MAP_*` | `plusplus` + `cull` |
| Un doute sur un résultat rendu par `plusplus` | recompiler en `stock` et comparer |

`cull` (Hammer++ seulement) élague ce que rien ne référence sans attendre qu'une limite soit
atteinte. Mesuré sur `ttt_traps` : −20,5 % de `PLANES`, −12,8 % de `VERTEXES`, −10,5 % de fichier,
faces et texinfos inchangés. Il est **refusé** sur la chaîne stock plutôt qu'ignoré — vbsp avale
les options inconnues en silence.

Les binaires `++` sont optionnels : `health` dit s'ils sont là. Absents, seul `toolchain:
"plusplus"` échoue, et il le dit en nommant la chaîne.

## Lire une sortie de compilateur

`read_compile_log` traduit. Les compilateurs parlent à qui les a écrits en 2004, et plusieurs de
leurs messages **désignent la mauvaise chose** :

| Ce qu'il dit | Ce que c'est vraiment |
|---|---|
| `**** leaked ****` | aucune position donnée. Le `.lin` en a une : `read_leak` |
| `Displacement found on a(n) X entity` | l'identifiant de brush imprimé est **toujours 0**, inutilisable. `read_vmf_lint` donne le vrai |
| `Bad surface extents` | échelle de texture hors `[0.1, 10]`. La face est nommée par un index introuvable dans Hammer |
| `Can't load skybox file … default cubemap` | **rien ne manque.** vbsp n'a pas pu fabriquer un cubemap par défaut. Sans effet sur la géométrie |
| `MAX_MAP_*` | un lump est plein. `read_map_geometry` dit lequel et de combien |

## Une fuite

Une carte qui fuit n'est pas scellée : quelque chose à l'intérieur voit le vide. Conséquences —
le PVS ne peut pas être calculé, la carte se charge **fullbright**, et vvis/vrad ne veulent plus
rien dire.

**Seuls les brushes du monde scellent.** Ni `func_detail`, ni les displacements, ni les entités-brush.
Une carte scellée avec des `func_detail` fuit.

`read_leak` corrèle les deux extrémités du pointfile avec les entités et nomme celle qui se tient
dessus. Attention : la position ainsi trouvée dit **où le rayon est passé**, pas nécessairement où
est le trou — mais elle donne le point de départ de la recherche, ce que le compilateur ne fait pas.

## Les pièges de la chaîne Wine

Mesurés, pas devinés :

- **Chemin en forme Windows absolue** (`Z:\...`). Un chemin relatif se résout contre le répertoire
  de travail de wine, et vbsp compile silencieusement le mauvais fichier. `run_compile` refuse un
  chemin relatif plutôt que de le convertir.
- **Répertoire courant sur `bin/`**, sinon `tier0.dll` ne se résout pas.
- **`WINEDEBUG=-all`**, sinon stderr est un mur de `fixme:` qui enterre la sortie du compilateur.
- Les compilateurs sont livrés avec le **client** GMod, pas avec `srcds`. `srcds/bin/` n'en
  contient aucun.

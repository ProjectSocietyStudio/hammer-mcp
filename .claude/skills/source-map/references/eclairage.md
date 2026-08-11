# Éclairer une carte

## Lightmaps et luxels

L'échelle par défaut est 16 unités par luxel. Plus fin = plus beau et **beaucoup** plus lent :
la charge croît au carré.

⚠️ **Les displacements ne sont pas subdivisés** comme les faces de brush. Une échelle fine sur un
displacement est la cause n°1 d'une compilation vrad qui passe de minutes à heures.
`read_vmf_lint` la signale.

## Ce qui est cuit, et ce qui ne l'est pas

**Tout l'éclairage statique est cuit par vrad, dans le `.bsp`.** Conséquences directes :

- Ajouter une entité `light` par patch de lump **ne fait rien**. L'outil avertit.
- Changer une lumière exige une recompilation vrad complète.
- Une carte qui fuit se charge **fullbright** : l'éclairage n'a pas pu être calculé.

## HDR

Deux jeux de lightmaps indépendants, dans deux lumps distincts. Cela peut plus que doubler le
volume du fichier. `read_map_geometry` montre les deux lumps : leur présence est une **preuve
récupérable du fichier** que la compilation HDR a bien eu lieu, plus fiable que de croire les
réglages qu'on pense avoir utilisés.

## Cubemaps

Les surfaces réfléchissantes ont besoin de cubemaps, construits **en jeu** par `buildcubemaps`,
pas à la compilation. Sans eux, tout ce qui réfléchit affiche le cubemap par défaut.

La vérification est côté fichier : `read_pakfile` compte les `c-*.vtf` embarqués. Sur
`rp_nycity_day`, **345** — donc `buildcubemaps` a bien tourné. C'est une preuve, pas un souvenir.

⚠️ HDR et LDR ont chacun leurs cubemaps. Les construire dans un mode ne les construit pas dans
l'autre.

## Props statiques

Par défaut, un `prop_static` reçoit **un seul échantillon d'éclairage** pour tout le modèle — d'où
les props qui semblent flotter, éclairés différemment du sol qu'ils touchent. `vrad
-StaticPropLighting` cuit un éclairage par sommet dans des fichiers `.vhv`.

Même vérification que pour les cubemaps : `read_pakfile` compte les `.vhv`. Sur `rp_nycity_day`,
**3983** — l'éclairage par sommet a bien été cuit.

## Ce que VRAD++ ajoute, et pourquoi ce n'est pas un outil

La chaîne Hammer++ (`toolchain: "plusplus"`) ouvre des options d'éclairage que la chaîne stock n'a
pas : `-ambientocclusion` / `-aoscale`, `-propambient`, `-worldtextureshadows`, les lumières douces.

**Aucune n'est exposée par `hammer-mcp`, et c'est délibéré.** Un outil peut prouver qu'un lump HDR
existe ou compter des `.vhv` ; il ne peut pas dire si une occlusion ambiante est bien réglée. C'est
un jugement visuel, donc il vit ici et se règle à l'œil, sur des captures — pas dans un booléen qui
rendrait « c'est bon ».

Pour les essayer, passer par `run_compile` avec `toolchain: "plusplus"` et regarder la carte. Le
seul contrôle machine disponible reste indirect : `read_map_geometry` dit si le lump LIGHTING a
changé de taille, ce qui prouve que vrad a refait son travail, pas qu'il l'a bien fait.

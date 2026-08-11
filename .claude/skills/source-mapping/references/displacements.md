# Displacements et terrain

Un displacement transforme une face de brush quadrilatère en un maillage de triangles librement
sculptable — le seul outil natif pour une surface organique continue (terrain, collines, pentes).
Cette page couvre les powers, les limites, le sewing, l'alpha painting et la collision — pas la
visibilité (`visibilite.md`), pas l'éclairage (`lighting.md`), pas les matériaux de blend
eux-mêmes (`assets.md`).

## Powers et coût

Le power fixe le nombre de triangles **indépendamment de la taille physique** de la face : une
face de 64×64 et une de 4096×4096 au même power ont le même nombre de sommets, seule la taille des
triangles change. Un displacement trop grand à un power donné produit des triangles énormes et un
rendu anguleux — mieux vaut découper en plusieurs displacements à la même power qu'augmenter la
power sur une grande face.

| Power | Sommets par côté | Triangles | Coût |
|---|---|---|---|
| 2 | 5 | 32 | terrain léger, relief mineur |
| 3 | 9 | 128 | terrain courant, détail visible |
| 4 | 17 | 512 | détail maximal, collision fragile — voir ⚠️ plus bas |

Triangles = `(1 << power) * (1 << power) * 2`, la formule du header lui-même [moteur]. Powers
disponibles : 2 à 4 seulement, `MIN_MAP_DISP_POWER` / `MAX_MAP_DISP_POWER` [moteur] — Hammer ne
propose rien en dehors.

⚠️ **Power 4 crashe en collision physique.** Documenté comme cause de crash quand des objets
physiques (débris, ragdolls) touchent un displacement power 4 [consensus] — préférer 4 displacements
power 3 sewés (même densité totale, volumes de collision séparés donc plus stables) à un power 4
unique.

## Limites dures

`MAX_MAP_DISPINFO` = 2048 displacements par carte [moteur]. Limite de lightmap : 125×125 luxels
sans bordure, 128×128 avec [moteur] — contrairement à une face brush, VBSP ne peut pas fragmenter
un displacement qui dépasse cette limite ; plus le displacement est grand en unités, moins on peut
descendre la lightmap scale.

Vérification : `read_bsp_info` donne le compte de displacements compilés à comparer à 2048 ;
`read_compile_log` signale un dépassement de lightmap à la compile.

## Les trois règles dures

**Un displacement se crée seulement sur une face de brush world**, jamais sur une entité brush
(`func_detail`, `func_brush`, `func_breakable`…) [moteur]. VBSP refuse toute entité qui porte un
displacement — erreur `"Displacement found on a(n) X entity - not supported (entity N, brush M)"`,
compile arrêtée net, aucun BSP produit. `read_vmf_lint` a une règle dédiée
(`displacement-on-entity`) qui l'attrape avant la compile.

**Un displacement ne bloque jamais la visibilité**, quel que soit le matériau appliqué [moteur] :
vvis l'ignore intégralement pour le calcul du PVS. Compter dessus pour couper une ligne de vue
produit un PVS énorme et des chutes de framerate qui ne s'expliquent qu'une fois ce point vérifié.
Le partage structurel / hint / areaportal est traité dans `visibilite.md`.

**Un displacement ne scelle jamais contre le vide**, même topologiquement fermé à l'œil [moteur] :
le hull de détection de leak l'ignore. Un sol en displacement posé directement au-dessus du vide
fuit alors que rien ne semble ouvert visuellement.

Vérification des trois : compiler et lire `read_compile_log` pour l'erreur d'entité ou l'avertissement
de leak ; `read_leak` transforme un leak en entité nommée si la compile échoue. Le comportement
visuel (une ligne de vue qui traverse, une porte qui ne devrait pas être visible) se confirme en jeu
via `gmod-mcp` (`run_console_command`, `capture_screen`) — jugement humain sur le screenshot.

## Sceller un displacement exposé

Sous tout displacement exposé au vide (terrain, toit), un brush classique en `toolsnodraw`
d'environ 16 unités referme le volume : deux brushes superposés, le supérieur devient le
displacement, l'inférieur nodraw scelle [consensus]. Ne jamais mettre `toolsnodraw` sur la face
sculptée elle-même — VBSP émet l'avertissement `"NODRAW on terrain surface!"`, signe que le nodraw
est au mauvais endroit [moteur].

## Sewing

Deux displacements adjacents gardent chacun leurs propres sommets de bord tant qu'ils ne sont pas
sewés (bouton *Sew* de Hammer) : sans ça, des micro-fissures apparaissent en vue rasante, et des
trous de collision peuvent s'ouvrir là où les bords ne coïncident pas exactement [consensus]. Le
sewing marche même entre deux powers différents — les sommets du plus fin bougent pour rejoindre
le plus grossier — mais exige un `Elev` commun entre les deux faces de base.

Vérification : `jugement humain, non outillé` — les cracks se voient en éditeur ou en jeu
(`gmod-mcp` `capture_screen`), aucun outil `hammer-mcp` ne les détecte hors ligne.

## Alpha painting et collision

L'alpha painting par sommet blend deux textures sur un displacement (herbe → terre), mais exige un
matériau `blend` dédié — le blend lui-même, ses shaders et sa fabrication vivent dans `assets.md`.

Le displacement expose des flags de collision par surface, dont *No Physics Collide* — utile pour
un relief fin surtout visuel (neige, débris) où on ne veut pas qu'un `prop_physics` s'y coince
[consensus]. Désactiver ce qui n'est pas nécessaire réduit un coût de collision qui sinon tourne
en continu même sans rien dessus.

## Displacement, brush ou modèle

| Cas | Choix | Pourquoi |
|---|---|---|
| Terrain extérieur, collines, pentes de grande étendue | Displacement, power 2-3, découpé en plusieurs faces | Seul outil natif pour une surface organique continue |
| Grande surface plane sans relief (route, dallage) | Brush classique | Le displacement ajoute triangulation, collision et lightmap sans bénéfice |
| Rocher isolé, formation répétée | `prop_static` | Un displacement n'est jamais instancié — chaque copie recrée toute la géométrie ; un prop partage son mesh et a un LOD |
| Mur ou plafond avec relief organique local (grotte) | Displacement power 2, `No Physics Collide` si des physprops peuvent s'y coincer | Coût de collision qui grimpe vite sur du vertical complexe |
| Transition entre deux textures de terrain | Alpha painting sur `WorldVertexTransition`, pas une jointure dure entre displacements | Transition douce sans géométrie ni découpe supplémentaire |

Vérification de l'arbitrage lui-même : `jugement humain, non outillé` — c'est un choix de design,
pas un comptage.

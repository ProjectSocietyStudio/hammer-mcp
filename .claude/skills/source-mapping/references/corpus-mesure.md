# Repères mesurés sur des cartes de production

Le reste du skill distingue `[moteur]`, `[consensus]` et `[contesté]`. Cette page ajoute la
quatrième marque, `[mesuré]` : des chiffres relevés par nous, sur de vraies cartes, avec
`hammer-mcp`.

**Corpus** : trois cartes urbaines de rôle-play Garry's Mod du mappeur **Fishke**, mesurées le
11/08/2026 sur les `.bsp` compilés extraits du Workshop — `rp_unioncity` (2018, 0,78 Go),
`rp_southside` (2020, 1,03 Go), `rp_nycity` (2022, 1,14 Go). Aucun `.vmf` source.

Ces chiffres ont été **attaqués avant d'être écrits** : une passe contradictoire a tenté de réfuter
chaque régularité. Ce qui suit est ce qui a résisté. Ce qui est tombé est dit aussi, plus bas —
c'est la partie la plus utile de la page. Une seconde vague de mesures, faite après la première
passe avec des lecteurs qui n'existaient pas encore, a corrigé un fait daté (§ ci-dessous, HDR) et
ajouté un repère (plans diagonaux) sans changer les repères déjà écrits.

⚠️ **Le dossier d'audit dont ces chiffres sont extraits n'est pas dans ce dépôt.** Les relevés
bruts, les passes de contradiction et la reconstitution de la méthode de l'auteur vivent dans le
dépôt privé de l'atelier. Ce qui est ici est ce qui a survécu, avec ce qui est tombé — pas le
raisonnement complet. Un repère qui vous paraît douteux l'est peut-être : la page dit à chaque
ligne sur combien de cartes il tient.

## Les deux avertissements qui conditionnent tout le reste

⚠️ **Une densité « par hectare » est normalisée par la boîte englobante du `worldspawn`**, laquelle
inclut le 3D skybox et tout le vide. C'est un **plancher**, jamais une densité de rue réelle. Toute
comparaison à une carte à soi doit refaire le même calcul biaisé de la même façon, sinon elle ne
veut rien dire.

⚠️ **`prop_static` n'est mesurable par aucun outil `hammer-mcp` livré sur un `.bsp` compilé** : il
vit dans le `GAME_LUMP`, que `read_prop_survey` ne lit pas. Ce n'est plus une limite de principe —
trois lecteurs ad hoc écrits pour cet audit (`readMaterials`, `readLightmapBudget`,
`readVisleafStats`, voir `comparatif-lumps.md`) prouvent qu'un lecteur de lump non-entités
supplémentaire est écrivable sans gros effort ; personne n'a encore écrit celui du `GAME_LUMP`. Sur
une carte urbaine, `prop_static` est probablement le gros du décor. **Aucun ratio
statique/dynamique de cette page n'est complet**, et aucun ne peut l'être tant que ce lecteur
manque.

## Les repères qui tiennent

| Repère | Valeur | Portée |
|---|---|---|
| Entités du lump 0 vs `MAX_EDICTS` (2048) | 165 % · 250 % · 209 % | une carte urbaine sérieuse **dépasse le plafond runtime stock à elle seule**, avant tout joueur et tout addon `[mesuré]` |
| `MAX_MAP_MODELS` (1024) | dépassé sur une seule carte : 1217 (118,8 %) | un compilateur stock aurait refusé cette carte `[mesuré]` |
| `MAX_MAP_LIGHTING` (16 Mio) | dépassé sur **les trois** : 158,6 % · 298,2 % · 201,3 % | une carte urbaine détaillée sort de l'enveloppe d'éclairage stock **avant** de manquer de modèles `[mesuré]` — corrigé le 11/08/2026 au soir, voir « ce qui est tombé » |
| Découpe diagonale, effet mesuré | 4 → 8 clusters avec un hint axial, → 10 en diagonal, dans la même pièce | un hint diagonal n'est pas un hint axial tourné : il subdivise **davantage** `[mesuré]` sur une pièce d'essai, n=1 |
| Densité de portes strictes | 5,44 · 9,14 · 9,73 par ha | `func_door` + `func_door_rotating` + `prop_door_rotating`, `func_movelinear` exclu. Saut de +68 %, puis plateau à +6 % `[mesuré]` |
| Type de porte employé | `func_door` / `func_door_rotating` dominent partout | 273 vs 24, puis 552 vs 0, puis 622 vs 0. `prop_door_rotating` est un essai abandonné `[mesuré]` |
| `AREAS`, `AREAPORTALS`, `WORLDLIGHTS` | tous < 40 % de leur plafond, sur les trois | ce ne sont **jamais** ces lumps qui contraignent une carte urbaine `[mesuré]` — ⚠️ ne pas lire ça comme « pas d'optimisation de visibilité », voir la ligne suivante |
| Plans de coupe diagonaux utilisés comme découpeurs BSP | 1,50× · 1,71× · 1,71× la disponibilité, contre 0,02× et 0,11× sur deux témoins | le vrai levier de visibilité de Fishke — hints posés en diagonale, pas areaportals `[mesuré]`, un seul témoin urbain comparable |
| Réemploi de matériaux entre cartes (préfixe hérité) | 0 % → 39 % → 78 % des matériaux, 0 % → 67 % → 89 % de l'usage | une bibliothèque personnelle construite et réemployée, pas reconstruite à chaque carte `[mesuré]` |
| Luxels/ha | 68 161 → 80 709 → 99 609, +46 % sur trois cartes | budget de lumière croissant, **sans dépendre du HDR** (absent sur la carte la plus récente, voir plus bas) `[mesuré]` |
| Poids du pakfile | 85,7 % à 94,0 % du `.bsp` | sur une carte qui embarque son contenu, la géométrie est une minorité du fichier `[mesuré]` |
| Découpage en visleaves vs témoin urbain | 1,3–1,6× plus dense (278 → 371–456 feuilles/ha), contre 4–6× face à un témoin non urbain | **ne pas confondre avec un trait distinctif de l'auteur** — l’écart tient surtout au genre de carte |

**Ce que ça change en pratique.** Le premier repère est le plus utile du lot : il dit qu'une carte
de ce gabarit est **impossible** sous un moteur Source stock, et qu'elle n'existe que parce que
Garry's Mod relève le plafond d'edicts. Toute carte urbaine ambitieuse doit intégrer ça dès le
cadrage, pas le découvrir à la première mise en charge.

Le lump qui sature **n'est pas le même d'une carte à l'autre** : `BRUSHES` à 97,9 % sur l'une,
`LEAFBRUSHES` à 99,8 % et `MODELS` à 98,4 % sur la deuxième, `MODELS` à 118,8 % et `TEXINFO` à
95,8 % sur la troisième. Une surveillance qui ne regarderait qu'un lump raterait les autres cas —
c'est `read_map_geometry` en entier qu'il faut lire, pas une ligne.

## Un fait daté corrigé le 11/08/2026 : pas de HDR sur la carte la plus récente

`rp_nycity` (2022) est compilée **sans HDR** — les lumps `LIGHTING_HDR`, `WORLDLIGHTS_HDR` et
`FACES_HDR` en sont absents, alors que les deux cartes précédentes les ont. La croyance inverse
venait d'un lecteur antérieur qui nommait à tort le lump `LEAF_AMBIENT_LIGHTING` (non vide sur les
trois cartes) « LIGHTING_HDR ». `[mesuré]` — erreur de nommage d'outil, pas de donnée fausse en
amont ; les documents d'audit en amont ont été corrigés en conséquence.

## Ce qui est tombé, et pourquoi c'est le plus instructif

| Affirmation séduisante | Pourquoi elle ne tient pas |
|---|---|
| « Le changement de compilateur se date entre 2020 et 2022 » | La carte de 2020 est à 98,4 % du plafond `MODELS` — compatible avec un compilateur stock **comme** avec un compilateur déjà modifié. La datation était une inférence déguisée en constat. **Suite le 11/08/2026 au soir** : la même carte est à 298 % de `MAX_MAP_LIGHTING`, donc elle sortait déjà de l'enveloppe stock. La datation reste fausse, mais dans l'autre sens — le changement est antérieur ou égal à cette carte, pas postérieur |
| « `MODELS` est le seul plafond dépassé du corpus » | Faux, et instructif sur la manière dont on se trompe : c'était le seul plafond que l'outil savait **évaluer**. Les limites n'étaient appliquées qu'aux lumps dont on connaît la taille d'enregistrement, et `MAX_MAP_LIGHTING` compte des octets. Le chiffre était dans les relevés depuis le premier jour. Un outil qui ne mesure pas quelque chose et un objet qui ne le fait pas se ressemblent trop |
| « Fishke construit méthodiquement au ras des plafonds » | Le seuil « proche de la limite » est celui de l'outil lui-même : l'énoncé recyclait la définition de l'instrument comme s'il s'agissait d'un signal. Et l'écart réel est large — de 80,4 % à 96,0 % selon les cartes |
| « Le ratio lumières/portes est stable, c'est un rythme de détail » | Trois points, 22 % d'écart entre min et max, et les deux séries sous-jacentes divergent. Un quatrième point ferait très probablement éclater le ratio |
| « La ville s'ouvre au fil des cartes » | La sightline maximale est une statistique **extrême** : une seule paire de points sur des centaines de milliers testées. Un corridor qui s'allonge ne dit rien de l'ouverture générale. Aucune médiane n'a été relevée |

⚠️ **Trois points ne font pas une tendance.** C'est la leçon générale de cet audit : sur un corpus
de trois, une progression monotone a une probabilité franche d'être du bruit, et une explication
causale n'est presque jamais testable contre l'alternative triviale « la carte est plus grande ».

## Deux faits de livraison

- Le nav mesh d'une des cartes est **à jour** : la taille de BSP enregistrée dans le `.nav`
  correspond exactement au `.bsp` livré `[mesuré]`.
- Le nav mesh de sa variante d'éclairage est **orphelin** : sa taille enregistrée ne correspond à
  aucun `.bsp` de l'archive, à 11,7 Mio près `[mesuré]`. Un mappeur reconnu publie donc un nav mesh
  qui ne va avec rien de ce qu'il livre — vérifier `read_nav` avant de reprendre une carte tierce
  n'est pas une précaution théorique.

## Ce que ce corpus ne dira jamais

Ces cartes sont compilées. Le découpage structurel/`func_detail`, les hints, les visgroups, le
lightmap scale par surface ont été détruits par vbsp. **On mesure ce que Fishke a livré, pas ce
qu'il a fait.** La qualité de son découpage de visibilité — sans doute la chose la plus intéressante
à apprendre de lui — reste hors d'atteinte sans charger les cartes dans le moteur.

Détail des relevés et de la passe contradictoire : voir
[couverture-outillage.md](couverture-outillage.md) pour ce que l'outillage sait et ne sait pas
mesurer.

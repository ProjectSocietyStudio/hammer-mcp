# Métier du level design

Le métier : dimensionner, bloquer, composer et faire lire une carte. Pas la visibilité — l'effet
d'une sightline sur `vvis`, les hints, les areaportals vivent dans `visibilite.md`. Ici, une
sightline est jugée par son effet sur le **joueur** : lisible, cassée, ou repère.

## Le piège de l'échelle

**« 1 unité Hammer = 1 pouce » est vrai par convention, pas par contrainte moteur** — Source
n'impose aucune taille réelle à l'unité, elle vient des assets. [moteur]

⚠️ **Deux échelles coexistent dans le même jeu.** L'architecture et la plupart des props sont
modélisés sur la base 1/16 de pied ; les personnages, sur 1/12 de pied — soit environ 33 % de plus
grand pour un mur ou une porte que pour la silhouette qui la franchit. [moteur] Il n'existe donc pas
une conversion HU→mètres unique et fiable : une pièce cotée « au réel » et jouée à hauteur de
joueur paraît petite, précisément parce que le décor et l'acteur ne partagent pas la même règle.

## La table des dimensions (unités Hammer)

| Grandeur | Valeur (HU) | Provenance |
|---|---|---|
| Hull debout (largeur × profondeur × hauteur) | 32 × 32 × 72 | [moteur] |
| Hull accroupi (HL2) | 32 × 32 × 36 | [moteur] |
| Hull accroupi (CS:S) | 32 × 32 × 45 | [moteur] |
| Largeur de passage minimale, mur droit / à 45° / mur décalé de la grille | 33 / 46 / 65 | [moteur] |
| Hauteur de vue debout (+ saut) | 64 (→ 85) | [moteur] |
| Hauteur de vue accroupi (+ saut) | 28 (→ 49) | [moteur] |
| Step size (marche franchie sans sauter) | 18 | [moteur] |
| Franchissement en sautant, debout, simple / saut+crouch (**Garry's Mod**) | 30 / 68 | [moteur, GMod] |
| Franchissement en sautant, accroupi (**Garry's Mod**) | 21 | [moteur, GMod] |
| Écart horizontal franchissable, à hauteur égale — immobile / en course / sprint+crouch-jump | 84 / 176 / 272 | [moteur] |
| Crouch-jump, obstacle vertical (CS:S, combos officiels) | 61 à 65 | [moteur, CS:S] |
| Crouch-jump, franchissement en GMod | ~62-68 selon technique — Valve ne documente pas GMod ici | [contesté] |
| Pente maximale praticable sans glisser | 45,573° | [moteur] |
| Portée de +use (interrupteur, poignée) | 82 | [moteur] |
| Largeur de couloir « normale » | 64 | [moteur] |
| Hauteur de plafond de couloir « normale » | 128 | [moteur] |
| Porte « normale » (largeur × hauteur) | 48 × 108 | [moteur] |
| Porte, dev texture de blockout courante | 56 × 112 | [consensus] — pas une valeur moteur, dépend du prop réel |
| Marche d'escalier (hauteur × profondeur) | 8 × 12 | [consensus] |
| Largeur d'escalier, intérieur / extérieur | 72 / 128 | [consensus] |
| 3D skybox, échelle | 1/16 (1/32 sur Left 4 Dead) | [moteur] |
| Lightmap scale par défaut | 16 × 16 par texel | [moteur] |

⚠️ **La vitesse de déplacement ne se lit pas dans un tableau.** Le HL2/CS:S par défaut donne 320 en
sprint, mais DarkRP et ses addons de mouvement changent couramment `sv_maxspeed`, `sv_stepsize`,
`sv_gravity`. Vérifier : `read_convars` (`gmod-mcp`) sur le serveur cible avant tout calcul fin de
largeur de couloir ou de hauteur de rebord — jamais une valeur trouvée en ligne.

Vérifier une cote existante sur une carte : `read_map_geometry`, `read_brush_volumes`,
`read_map_extents` (`hammer-mcp`) — comparer aux lignes ci-dessus plutôt que juger à l'œil dans
l'éditeur.

## Bloquer avant de détailer

**Le blockout se joue avant de se regarde.** Dev textures (orange mur, gris sol), volumes en
`toolsnodraw`/`toolsskip`, grille 16 ou 32 HU — jamais en dessous tant que le gameplay n'est pas
validé. Descendre à 1-4 HU est réservé à la finition, pas au blocking. [consensus] La grille et les
formes valides d'un brush sont couvertes par `brushwork.md`, pas ici.

**Habiller un blockout non testé oblige à tout refaire si l'échelle est fausse.** [consensus] Tester
en jeu avant de détailer, pas après.

Vérifier : jugement humain en éditeur (playtest du blockout), puis `capture_screen`, `read_view`
(`gmod-mcp`) une fois en jeu.

## Composition et lisibilité

- **Un repère se reconnaît à sa silhouette**, pas à sa texture — forme et verticalité doivent rester
  lisibles à distance et en contre-jour. [consensus]
- **La lumière est un signal de direction** au même titre qu'un couloir : une zone plus éclairée
  attire l'œil et donc le déplacement. [consensus]
- **La répétition sans variation casse la mémoire spatiale** : même module de couloir sans repère ni
  contraste, le joueur ne peut plus s'orienter. [consensus]
- **Un mur nu de grande surface aplatit la lecture du volume** et prive la lumière de tout contraste
  à exploiter. [consensus]

Pour l'effet d'une sightline sur `vvis` et le calcul de visibilité, voir `visibilite.md`. Ici, une
ligne de vue se juge à son effet sur le **combat** : au-delà de ~1028 HU le damage falloff domine, et
au-delà de ~2048 HU un duel lisible devient du spam ou du sniping — une sightline trop longue est un
problème de design avant d'être un problème de perf. [moteur/jeu, TF2]

Vérifier : `read_sightlines` (`hammer-mcp`) mesure la longueur, pas la lisibilité — la composition
elle-même est un jugement humain, non outillé. Ça ne se mesure pas, ça se regarde.

## Flow

**Une boucle vaut mieux qu'un couloir unique** : elle évite qu'un seul point de passage se fasse
camper. Un chokepoint sans cover est une ligne de mort instantanée, pas un point de tension.
[consensus] Casser une sightline trop longue en décalant un coin ou en posant un couvert préserve la
route de circulation ; fermer le passage la détruit.

Vérifier : jugement humain sur plan, confirmé par `read_sightlines` avant/après le décalage.

## Situation → choix

| Situation | Choix | Pourquoi |
|---|---|---|
| Cote d'une pièce copiée sur un plan réel | grossir légèrement, jamais du 1:1 | l'échelle props/personnages diverge déjà de ~33 % ; une pièce « au réel » se sent écrasée à hauteur de joueur |
| Marche franchissable sans escalier ni saut | ≤ 18 HU | au-delà, le moteur exige un saut — comportement, pas goût |
| Rampe ou escalier | rampe pour un flux continu, escalier pour ponctuer le rythme | l'escalier introduit une pause et un point de vue, la rampe l'efface |
| Sightline trop longue en zone de combat | décaler un coin ou poser un couvert à mi-distance | casse la ligne sans fermer la route |
| Densité de detail | concentrer sur les repères et le niveau des yeux, simplifier hors champ courant | le joueur ne regarde presque jamais le plafond ni le sol nu |
| Largeur de couloir secondaire vs principal | 64 HU tient le « normal » moteur ; au-delà de 96-128 HU c'est un choix de croisement à double sens, pas une norme | un couloir sous 2× la largeur du hull (64 HU) empêche deux joueurs de se croiser |

## Échelle jouable contre échelle réaliste

Un intérieur RP dimensionné au plan réel se joue trop petit — cf. le piège d'échelle plus haut :
décor et joueur ne partagent pas la même base. **Grossir légèrement plutôt que copier** est un
réflexe de métier, pas un facteur unique publié par Valve : traiter tout coefficient précis comme
[contesté] tant qu'aucune source primaire ne le fixe, mais garder « légèrement plus grand que réel »
comme repère constant. [consensus]

## Le cas d'une ville de rôle-play

Une carte DarkRP n'a pas d'objectif de duel — mais elle hérite quand même des contraintes de
lisibilité et de flow d'une carte de combat, parce que le moteur ne fait pas de différence : les
mêmes hulls, le même step size, les mêmes sightlines pèsent sur la circulation de rue comme sur un
corridor CS. **Une avenue trop longue et rectiligne a le même effet qu'une sightline de sniping** —
elle invite au camping plutôt qu'à la présence de rue. Rompre les longues perspectives par un
décrochage de façade ou un mobilier urbain sert la même fonction qu'un hint en intérieur : casser
une ligne sans fermer une route.

« Rue », « lot », « quartier » ne sont pas des notions que le `.bsp` porte — `read_sightlines` mesure
des lignes de vue entre points praticables, pas « la plus longue avenue ». Nommer, c'est `LORE.md`,
pas cette page.

Vérifier : `read_sightlines` pour les perspectives de rue, `read_convars` (`gmod-mcp`) pour la
vitesse et le step size réels du serveur avant tout calcul de largeur de trottoir ou de hauteur de
bordure — jamais une valeur par défaut supposée.

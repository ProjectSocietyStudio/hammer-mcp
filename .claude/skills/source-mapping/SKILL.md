---
name: source-mapping
description: Le savoir-métier du mapping Source / Garry's Mod — penser une carte, pas piloter un outil. Brushwork et grille, visibilité et visleaves, éclairage et lightmaps, displacements, entités et système I/O, performances, dimensions et composition, matériaux et packing, ambiance, mythes et anti-patterns. Utiliser dès qu'il faut décider comment construire, optimiser ou juger une carte : func_detail, hint, areaportal, occluder, lightmap scale, cubemap, prop_static, sightline, leak, budget, échelle en unités Hammer.
---

# Penser une carte Source

Ce skill porte le **métier**. Le pilotage de l'outillage — quel outil pour quelle question, Wine,
le choix des compilateurs, le patch de lump — vit dans [`source-map`](../source-map/SKILL.md) et
n'est pas répété ici. Les deux se renvoient l'un à l'autre ; aucun ne recopie l'autre.

## La règle qui prime

**Le mapping Source charrie plus de dogme que de mesure.** Vingt ans de forums ont sédimenté des
règles qui étaient vraies sur du matériel de 2004, des chiffres recopiés sans source, et des
conseils justes appliqués hors de leur cas. Un agent qui récite ce folklore avec assurance fait
plus de dégâts qu'un agent qui dit ne pas savoir.

D'où la convention qui tient tout ce skill : **chaque chiffre porte sa provenance.**

| Marque | Ce que ça garantit |
|---|---|
| `[moteur]` | lu dans le code de Valve ou dans sa documentation. Ça ne se discute pas |
| `[consensus]` | pratique largement admise, jamais chiffrée. Utile, pas opposable |
| `[contesté]` | disputé, obsolète, ou faux tel qu'on l'entend. La clause qui suit dit ce qui est vrai |
| `[mesuré]` | relevé par nous sur une vraie carte, avec l'outillage. Le plus solide après `[moteur]` |

Un chiffre sans marque est un chiffre qu'on supprime. Si tu ajoutes une règle à ce skill, elle
arrive avec sa provenance ou elle n'arrive pas.

## Les trois choses qui décident d'une carte

Dans cet ordre, et l'ordre compte plus que le détail :

1. **La visibilité.** Ce qui n'est pas dessiné ne coûte rien. Le découpage en visleaves, les
   areaportals, les occluders décident des performances bien avant le nombre de triangles.
   → [visibilite.md](references/visibilite.md)
2. **Le scellement.** Une carte qui fuit n'a ni visibilité correcte ni éclairage correct, et elle
   compile quand même — c'est ce qui la rend traître. → [compile.md](references/compile.md)
3. **L'échelle.** Une carte mal dimensionnée ne se rattrape pas à l'habillage : elle se
   reconstruit. → [level-design.md](references/level-design.md)

Tout le reste — matériaux, ambiance, densité de détail — se corrige. Ces trois-là, non.

## Ce qu'aucun outil ne tranche

Le découpage structurel/`func_detail`, le placement d'un hint, le lightmap scale d'une surface, la
composition, la lisibilité d'une ville : **aucun outil ne répond**. Ce n'est pas une lacune de
l'outillage, c'est la nature du métier.

⚠️ **Maquiller un jugement en métrique est la faute la plus coûteuse qu'un agent puisse commettre
ici** : elle produit un chiffre faux et la confiance qui va avec. « Je ne peux pas trancher,
regarde » est une réponse valide, et souvent la bonne.

La carte complète de ce qui se vérifie et de ce qui ne se vérifie pas :
[couverture-outillage.md](references/couverture-outillage.md).

## Auditer une carte dont on n'a pas la source

Un `.bsp` n'est pas une carte, c'est le **résultat** d'une carte. La compilation détruit la
distinction structurel/détail, les hints, les visgroups. Face à une question qui porte dessus, la
réponse est « non déterminable depuis un `.bsp` compilé », pas une estimation.

## Fichier → Quand le lire

| Fichier | Quand |
|---|---|
| [brushwork.md](references/brushwork.md) | poser de la géométrie : grille, formes valides, textures d'outil, limites dures |
| [visibilite.md](references/visibilite.md) | **avant toute question de performance** : visleaves, `func_detail`, hints, areaportals, occluders, skybox |
| [lighting.md](references/lighting.md) | éclairer : lightmaps, entités de lumière, HDR, cubemaps, ombres |
| [displacements.md](references/displacements.md) | du terrain, un rocher, une surface irrégulière |
| [entites.md](references/entites.md) | faire fonctionner quelque chose : I/O, nommage, triggers, filtres, limites d'entités |
| [performance.md](references/performance.md) | ça rame, ou ça va ramer : draw calls, props, physique, charge serveur |
| [gmod.md](references/gmod.md) | la carte est pour Garry's Mod : SDK, montage, spawns, nav mesh, Workshop |
| [level-design.md](references/level-design.md) | dimensionner, bloquer, composer — la table des dimensions est ici |
| [assets.md](references/assets.md) | matériaux, modèles, et **le packing** : la table de ce qu'il faut embarquer |
| [ambiance.md](references/ambiance.md) | son, brouillard, eau, ciel, météo, couleur |
| [anti-patterns.md](references/anti-patterns.md) | **avant d'affirmer une règle apprise ailleurs**, et pour détecter une erreur dans un fichier |
| [corpus-mesure.md](references/corpus-mesure.md) | dimensionner une carte urbaine : repères relevés sur trois cartes de production |
| [couverture-outillage.md](references/couverture-outillage.md) | « comment je vérifie ça ? », et pour savoir ce qui n'est pas outillé |

## Le serveur est partagé

Toute vérification « en jeu » passe par `gmod-mcp`, donc par le `srcds` que d'autres sessions
utilisent. Ne le redémarre jamais unilatéralement, et ne charge pas une autre carte sans le dire.

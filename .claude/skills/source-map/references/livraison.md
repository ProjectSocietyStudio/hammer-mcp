# Livrer une carte

## Empaqueter les assets

Un asset personnalisé non empaqueté s'affiche en damier violet chez tous ceux qui ne l'ont pas.
`run_pack` empaquette des fichiers dans le `.bsp` via `bspzip`.

⚠️ **`bspzip` sort en 0 qu'il ait ajouté quelque chose ou non.** `run_pack` ne croit donc pas son
code de retour : il compte le pakfile avant et après, et ne rend `ok: true` que si le nombre de
fichiers a crû exactement de ce qui était demandé.

`run_pack` **ne devine pas** ce qu'une carte référence : il prend des paires explicites. La
détection automatique des assets référencés n'est pas écrite.

**Le test qui tranche** : retirer les dossiers d'assets personnalisés, charger la carte, et
chercher `ERROR` et `Missing` dans la console. C'est le seul contrôle qui prouve l'autonomie du
`.bsp` — un test d'isolement, pas une relecture de liste.

## Nav mesh

**Recompiler une carte invalide toujours son nav mesh.** Le moteur compare la taille de BSP inscrite
dans le `.nav` à celle de la carte qu'il charge et **ne dit rien** si elles diffèrent : en jeu, cela
se voit comme des Nextbots qui refusent de se déplacer, console muette.

`read_nav` rend le verdict `fresh` / `stale`. Le régénérer exige `nav_generate` en jeu — il n'existe
aucun générateur hors moteur, ni ici ni ailleurs dans le domaine public.

À ne pas confondre avec le **nodegraph** (`.ain`) : lui sert les NPC HL2 scriptés, le nav mesh sert
les Nextbots. `rp_nycity_day` embarque un `.ain` dans son pakfile.

## Le contrôle avant livraison

| Point | Comment | Qui décide |
|---|---|---|
| Aucune fuite | `run_compile` puis `read_leak` | l'outil |
| Cubemaps construits | `read_pakfile` compte les `c-*.vtf` | l'outil |
| Éclairage des props cuit | `read_pakfile` compte les `.vhv` | l'outil |
| Nav mesh à jour | `read_nav` | l'outil |
| Marge avant les plafonds | `read_map_geometry` | l'outil |
| Assets empaquetés | test d'isolement, console | l'outil produit le log, l'humain arbitre |
| Spawns, clips, exploits | playtest | **l'humain** |
| Rythme, lisibilité, beauté | playtest | **l'humain** |

## Workshop GMod

`gmad` puis `gmpublish`. Deux contraintes dures : l'icône doit être un **JPEG baseline 512×512**,
et seules certaines extensions passent — la liste blanche est dans `AddonWhiteList.h` de `gmad`
(`.dll`, `.exe`, `.js`, `.html` sont bannis).

Aucun outil de `hammer-mcp` ne pilote encore cette étape.

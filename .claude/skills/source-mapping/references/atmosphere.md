# Ambiance : son, brouillard, eau, ciel, météo, couleur

## Le modèle général

L'ambiance ne se calcule pas comme la géométrie ou l'éclairage : elle se **déclare**, zone par
zone, via des entités qui coûtent presque rien à poser et beaucoup à mal régler. Rien ici n'est cuit
par un compilateur — tout se pilote en jeu, donc tout se vérifie en jeu.

## Soundscapes

`env_soundscape` définit **seulement** le soundscape actif et l'origine des sons positionnés ; son
`radius` est le rayon de **déclenchement** (ligne de vue requise), pas la portée audio des sons
référencés — `-1` = déclenchement infini, pas portée sonore infinie. Un seul soundscape actif à la
fois : en activer un second **crossfade** l'ancien, il ne s'additionne pas, et le joueur garde le
dernier déclenché même hors ligne de vue. **`info_player_start` doit être couvert**, sinon le
joueur spawn sans ambiance. [moteur]

| Besoin | Entité | Pourquoi |
|---|---|---|
| Zone par proximité + ligne de vue | `env_soundscape` | Cas par défaut |
| Réglages partagés sur plusieurs entrées | `env_soundscape_proxy` | Référence un `env_soundscape` existant, ne le duplique pas |
| Déclenchement par volume plutôt que LOS | `env_soundscape_triggerable` + `trigger_soundscape` | Un `env_soundscape` simple ne répond pas à `trigger_soundscape` [moteur] |

Le fichier doit être listé dans `scripts/soundscapes_manifest.txt`, ou nommé
`soundscapes_<nomdelacarte>.txt` pour un montage automatique propre à cette carte. ⚠️ **La limite de
64 sons simultanés est partagée** entre tous les `ambient_generic` et sons de soundscape actifs —
la dépasser corrompt le moteur audio sur toute la carte. [moteur] **Vérification** :
`soundscape_debug 1` en jeu (cubes violets : vert déclenché, jaune actif non déclenché, rouge
inactif), `soundscape_flush` pour repartir à zéro — `run_console_command` (gmod-mcp), état runtime
qu'aucun outil `hammer-mcp` ne lit depuis le fichier.

## `ambient_generic`

Un son qui doit suivre une entité mobile passe par `SourceEntityName`, jamais par un parentage
classique. Deux conditions dures : l'entité cible doit **déjà exister** au spawn de
l'`ambient_generic`, et être **networkée au client** (`info_target` + flag *Transmit to client*).
Assigner `SourceEntityName` via `AddOutput` n'est **pas supporté** — violé, le son reste figé à la
position de spawn, sans erreur. [consensus] `radius` (défaut **1250** unités) n'est qu'un fondu
approximatif : le son continue de jouer en interne au-delà et alimente la même limite de 64 ;
préférer un `env_soundscape` dès que l'ambiance dépasse un effet ponctuel. [moteur] **Vérification** :
`read_fgd_class` pour les keyvalues exactes du jeu, `read_vmf` pour confirmer que `SourceEntityName`
pointe une entité présente dans le fichier — le résultat sonore reste un jugement humain, non outillé.

## Brouillard

⚠️ **Le brouillard ne fait gagner aucune performance en soi.** `fogstart`/`fogend`/`fogcolor`
produisent un simple fondu de couleur — ce qu'il masque continue d'être dessiné intégralement
derrière le voile. Seul **`farz`** coupe réellement le rendu au-delà d'une distance ; c'est le seul
des trois réglages qui pèse sur le GPU. [CONSENSUS/CONTESTÉ — `farz` a un comportement parfois cassé
en GMod, cf. `Facepunch/garrysmod-issues#6300`]

`farz` doit être **supérieur à `fogend`**. Défaut `-1`, résolu en interne à **28377,9204312** unités
Hammer. `fogmaxdensity` est un float **0,0–1,0** (0.45 = 45 %), pas 0–255 ni 0–100. Plusieurs
`env_fog_controller` peuvent coexister par zone (`SetFogController` envoyé au joueur, ou un
`Master`) ; le brouillard du `sky_camera` se règle à part et doit **correspondre à la main** à celui
du monde principal — il ne reçoit pas d'`Inputs` pour le suivre. [moteur] **Vérification** :
`read_vmf`/`read_vmf_lint` pour `farz > fogend` et l'unicité du `Master` ; en jeu, `mat_wireframe`
ou un compteur de draw calls (`run_console_command`) pour confirmer que `farz` coupe bien quelque
chose au loin.

## Eau

Deux règles structurelles, pas des conseils : **une même PVS ne peut contenir qu'une seule hauteur
d'eau *expensive*, et ne peut pas mélanger eau cheap et eau expensive** (violé : eau invisible ou
non rendue — séparer par hint ou areaportal pour forcer des PVS distincts) ; **un seul
`water_lod_control` par carte** (`cheapwaterstartdistance`/`cheapwaterenddistance` s'appliquent à
toute la carte, VBSP en ajoute un si absent, en avoir deux casse la compilation). [MOTEUR/CONSENSUS]

Eau cheap et eau expensive ne sont **pas le même shader** : cheap = `LightmappedGeneric` +
`%compilewater` + `$envmap`/cubemap statique ; expensive = réflexion/réfraction temps réel, rendue
en interne jusqu'à 3× la scène. La face du dessus seule porte le matériau Water ; côtés et dessous
en `tools/toolsnodraw`, surface rectangulaire sans pente en Z. [MOTEUR/CONSENSUS]

⚠️ **De l'eau qui bouge (marée, vagues) ne peut pas porter le shader Water** — il dépend d'un
découpage de visleaf statique, incompatible avec un brush mobile. Utiliser `func_water_analog` avec
`nature/water_movingplane` ou `nature/water_dx70`. [moteur] **Vérification** :
`read_vmf`/`read_vmf_lint` pour compter les `water_lod_control` (≤1), `read_compile_log` pour les
avertissements VBSP liés à l'eau — une même PVS franchissant deux hauteurs reste un jugement de
plan, à confronter avec `read_map_geometry`.

## Ciel : cohérence, pas visibilité

Le découpage `sky_camera`/échelle 1/16 et les contraintes de visibilité sont dans `visibilite.md` —
ici, seulement ce qui touche l'ambiance. `sky_name` référence 6 faces VTF sans suffixe ; version HDR
par le suffixe `_hdr` (sauf `sky_borealis01`, `sky_wasteland02`) — sans elle en carte HDR, retour
silencieux à la version LDR, sans erreur. [moteur]

Le 3D skybox n'est **jamais un remplacement** du ciel 2D, toujours rendu devant lui : sa géométrie
doit rester cohérente avec ce que la skybox 2D suggère, et son brouillard propre (sur `sky_camera`,
distinct de celui du monde principal) doit lui **correspondre à la main** — facile à désynchroniser
après une passe sur l'un des deux. [consensus] **Vérification** : `read_vmf` compare
`fogcolor`/`fogstart`/`fogend` entre `sky_camera` et l'`env_fog_controller` principal — silhouette et
teinte qui jurent restent un jugement humain, via `capture_screen`.

## Particules et météo

`info_particle_system` prend en `effect_name` le **nom du système**, pas le nom du fichier `.pcf` —
et ce système doit être précaché dans `particles_manifest.txt` (ou le manifeste par carte), sinon
rien ne joue, sans erreur. Packing, `.pcf` et manifestes en détail : `assets.md`.

`func_precipitation` (pluie/neige/cendre) **n'est pas accéléré GPU**. Au-delà d'environ **32000
sommets visibles** simultanément, elle crashe le moteur — pour une météo dense en multijoueur,
préférer un système de particules à zone limitée. [moteur] **Vérification** : `read_pakfile`
confirme qu'un `.pcf` custom est embarqué ; `read_vmf`/`read_fgd_class` comparent `effect_name` au
nom déclaré dans le `.pcf` — le volume de sommets visibles en jeu n'est observable qu'au crash, non
mesuré ici.

## Couleur et exposition

`color_correction`/`color_correction_volume` appliquent une table (`.raw`) non destructive,
activable par zone avec fondu, coût quasi nul. `env_tonemap_controller` lisse la transition
d'exposition entre deux ambiances de luminosité (`SetAutoExposureMin`/`Max`, défaut max **2.0**)
plutôt que de la laisser sauter brutalement. [consensus]

⚠️ **`env_sun` n'éclaire rien.** Il ne dessine que le halo visuel du soleil dans le skybox — la
lumière réelle vient de `light_environment` (déjà traité dans `lighting.md`), les ombres dynamiques
de `shadow_control`. Le régler en pensant corriger l'éclairage ne change rien à la scène. [moteur] **Vérification** :
aucune table `.raw` ni exposition ne se juge en outil — `capture_screen`/`read_view`. `read_vmf`
confirme au moins la couverture d'un `color_correction_volume` et la présence d'un
`env_tonemap_controller` côté fichier.

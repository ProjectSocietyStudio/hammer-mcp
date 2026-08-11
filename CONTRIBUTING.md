# Contribuer à hammer-mcp

Le dépôt a une discipline étroite et peu de règles. Elles tiennent en trois idées.

## 1. Un test qui passe ne prouve rien tant qu'on ne l'a pas vu échouer

C'est la règle qui prime sur toutes les autres. Un test vert peut l'être parce que le code marche,
ou parce que le test ne teste rien — et rien dans la sortie ne les distingue.

Donc, pour chaque test ajouté : **saboter le code qu'il couvre, le voir rougir, remettre.** Et le
dire dans le message de commit, avec ce qui a été cassé.

Cette suite rend le piège concret : elle pilote de vrais compilateurs, un vrai sidecar Python et de
vraies cartes, dont rien n'est livré avec le dépôt. Un test qui ne trouve pas ce qu'il lui faut se
**saute**, et un `it.skipIf` trop large est indiscernable d'un succès. D'où :

- les prédicats de disponibilité vivent **tous** dans `test/support/env.ts`, jamais réinventés
  dans un fichier de test ;
- la suite annonce en clair ce qu'elle n'a pas pu tester ;
- la CI **refuse** une exécution verte comptant trop peu de tests réellement exécutés.

## 2. Aucun chiffre qu'on n'a pas lu

Ce dépôt affirme beaucoup de nombres : plafonds de lumps, tailles, seuils, durées. Chacun vient
d'un fichier lu ou d'une mesure faite, et **le README dit lequel, avec sa date**.

Un plafond de lump copié depuis un article de wiki, une limite « probablement la même sur ce
jeu-là », une durée « de l'ordre de » : non. Si la valeur ne peut pas être vérifiée, elle est
absente, ou marquée non vérifiée, mais jamais présentée comme un fait. Un outil qui rend un
chiffre faux est pire qu'un outil qui n'existe pas — l'appelant n'a aucun moyen de s'en douter.

Corollaire pour les outils : **pas d'outil sans oracle.** Si l'on ne peut pas construire une
manière indépendante de vérifier ce que l'outil rend, il ne se livre pas. Plusieurs manques sont
documentés dans le README exactement pour cette raison, plutôt que comblés par de la devinette.

## 3. Le commit porte sa doc

Un commit atomique, un sujet, en anglais, au format conventionnel (`feat:`, `fix:`, `docs:`,
`chore:`, `test:`, `refactor:`). Le corps dit **pourquoi**, pas quoi — le diff dit déjà quoi.

La documentation que le changement rend fausse est corrigée **dans le même commit**. Un README qui
décrit un outil absent est un bug, pas un retard : quelqu'un le lit et compte dessus.

## Avant d'ouvrir une PR

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Le typecheck est distinct des tests, et pas par confort : un `dist/` de `@projectsociety/mcp-core`
non reconstruit rend les tests verts et le typecheck rouge sur le même arbre. Les deux, toujours.

`main` s'atteint par une PR mergée, jamais par un push.

## Ce qui n'est pas souhaité

- Un passe-plat d'arguments libres vers les compilateurs. Un flag qu'on ne sait pas vérifier n'a
  pas sa place dans un outil ; il a sa place dans la documentation, présenté comme un jugement.
- Un lecteur qui charge un fichier entier. Les cartes réelles pèsent le gigaoctet, et un
  `readFileSync` dessus tue le transport MCP — ce que l'appelant voit comme un blocage, pas comme
  une erreur. Tout se lit par offsets.
- Redistribuer du contenu Valve ou les binaires Hammer++. Ils s'installent, ils ne se versionnent
  pas. Aucun `.fgd`, `.bsp` ou `.exe` qui ne soit à nous n'entre dans ce dépôt.

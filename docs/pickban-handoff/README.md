# PraccHub — Pick & Ban : pack de passation pour Claude Code

Ce dossier contient tout ce qu'il faut pour intégrer le nouveau hub de pick & ban (Valorant, CS2, League of Legends, Dota 2) dans le projet PraccHub.

## Contenu

| Fichier | Rôle |
|---|---|
| `prototype/index.html` | Prototype fonctionnel du hub. Ouvrir directement dans un navigateur (aucun build). **C'est la référence visuelle et comportementale.** |
| `prototype/pickban-core.js` | Logique métier pure (config des jeux, séquences, machine à états, validation). Sans DOM, compatible navigateur et Node. |
| `prototype/app.js` | Couche UI du prototype (rendu, événements, chrono). À traduire dans le framework du projet. |
| `prototype/styles.css` | Tokens de design, composants et toutes les animations (keyframes). |
| `prototype/motion.html` | Spec visuelle des 8 transitions, en boucle, avec durées et courbes. |
| `tests/pickban-core.test.js` | Tests de la logique (`node --test tests/pickban-core.test.js`). |
| `SPEC.md` | Spécification fonctionnelle, données, animations, accessibilité, points ouverts. |

## Prompt à donner à Claude Code

Copier ce dossier à la racine du repo (ex. `docs/pickban-handoff/`), puis :

```text
Lis docs/pickban-handoff/README.md et docs/pickban-handoff/SPEC.md, puis ouvre
docs/pickban-handoff/prototype/index.html pour voir le comportement attendu.

Objectif : remplacer l'écran de veto actuel du hub par ce nouveau pick & ban,
en respectant la stack et les conventions existantes du projet.

1. Explore le code actuel du hub (écran "Match en cours", veto de cartes,
   historique, déclaration du vainqueur) et résume-moi l'architecture avant de coder.
2. Porte pickban-core.js tel quel (ou en TypeScript si le projet est en TS) dans
   un module partagé, utilisé à la fois côté serveur (validation de chaque action,
   source de vérité) et côté client (affichage). Garde les tests et branche-les
   sur la commande de test du projet.
3. Recrée l'UI dans le framework du projet à partir de app.js / styles.css :
   mêmes tokens, mêmes classes d'état (is-ban, is-pick, is-sel, is-dec), mêmes
   keyframes, et la règle « .fx » : seules les entrées neuves s'animent.
4. Synchronise le veto en temps réel entre les deux capitaines (mécanisme temps
   réel déjà présent dans le projet s'il existe, sinon propose-moi une option
   avant de l'ajouter). Seul le capitaine dont c'est le tour peut agir.
5. Échappe TOUS les noms (équipes, joueurs) : le hub actuel affiche
   « Les Faucons <b> », signe d'une injection HTML possible.
6. Ne touche pas aux autres écrans. Montre-moi le plan avant les gros changements.
```

## Vérifié

- Les 7 tests passent (`node --test tests/pickban-core.test.js`, Node 22).
- Prototype testé dans Chromium headless : veto complet Valorant BO3, CS2 BO1, draft LoL (20 étapes) et Dota 2 (24 étapes), annulation après carte décisive, recherche (le champ garde le focus), aucun débordement horizontal à 390 px.

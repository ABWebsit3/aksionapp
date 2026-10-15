# Spécification — Pick & Ban PraccHub

## 1. Périmètre

| Jeu | Type | Formats | Ce qui est banni / choisi |
|---|---|---|---|
| Valorant | Veto de cartes | BO1, BO3 | Cartes + côté de départ (Attaque / Défense) |
| CS2 | Veto de cartes | BO1, BO3 | Cartes + côté de départ (CT / T) |
| League of Legends | Draft | 1 partie | Champions (5 bans + 5 picks par équipe) |
| Dota 2 | Draft (Captains Mode) | 1 partie | Héros (7 bans + 5 picks par équipe) |

Convention : **équipe A** = équipe qui a gagné le pile ou face (first pick ; côté bleu sur LoL). **Équipe B** = l'autre.

## 2. Séquences

Définies dans `SEQS` (`pickban-core.js`). Types d'étapes : `ban`, `pick`, `side` (choix du côté), `decider` (carte restante, automatique).

- **Cartes BO3** (repris du hub actuel) : A ban, B ban, A pick, B côté, B pick, A côté, A ban, B ban, carte décisive, A côté.
- **Cartes BO1** : A/B ban × 3 (alternés), carte décisive, B côté.
- **LoL** (draft tournoi standard) : bans A B A B A B · picks A B B A A B · bans B A B A · picks B A A B.
- **Dota 2** (Captains Mode, format 7.34+) : bans A B B A B B A · picks A B · bans A A B · picks B A A B B A · bans A B B A · picks A B. **Les nombres (7 bans / 5 picks par équipe) sont confirmés ; l'ordre tour par tour reste à vérifier sur le patch en cours.**

Règles :
- La carte décisive est attribuée automatiquement dès que l'étape suivante est `decider`.
- Le choix de côté porte toujours sur la dernière carte choisie (pick ou décisive).
- « Annuler » retire la dernière action ; si c'était la carte décisive automatique, retire aussi le ban qui l'a déclenchée.
- `apply()` lève une erreur si : veto terminé, mauvaise équipe, élément inconnu ou déjà utilisé, côté invalide. **Le serveur doit appeler `apply()` sur chaque action reçue et rejeter en cas d'erreur.**

## 3. Données

- **Pools de cartes : à rendre configurables côté admin/serveur.** Les rotations changent à chaque act ou patch.
  - CS2 : Ancient, Anubis, Cache, Dust2, Inferno, Mirage, Nuke (Cache a remplacé Overpass en juin 2026).
  - Valorant : Abyss, Ascent, Haven, Lotus, Split, Summit, Sunset (d'après ProSettings, mis à jour le 30/09/2026). **D'autres sources donnent une liste différente — à confirmer.**
- **Champions / héros** : le prototype contient un échantillon (36 champions, 31 héros). En production, charger les listes complètes depuis une source officielle ou maintenue (ex. Data Dragon de Riot pour LoL, API OpenDota pour Dota 2), avec rôle/attribut pour les filtres.
- **Visuels** : le prototype utilise des emplacements (dégradé + initiales). Remplacer par les visuels officiels en respectant les conditions d'utilisation des éditeurs.
- Modèle d'une entrée d'historique : `{ t, team, id }` pour ban/pick/decider, `{ t: 'side', team, side, mapId }` pour un côté.

## 4. Écran

De haut en bas :
1. **En-tête** : logo, sélecteur de jeu, format BO1/BO3 (jeux à cartes), chips Scrim / niveau / statut.
2. **Bannière de tour** : étape `n/total` + nom de phase, « *Équipe* bannit / choisit … », chrono 30 s (texte + barre), boutons Annuler / Recommencer.
3. **Frise** : un segment par étape, à la couleur de l'équipe ; bans hachurés, étape courante pulsée.
4. **Arène** : équipe A | panneau central | équipe B. Sur mobile, les trois blocs s'empilent.
   - Jeux à cartes : roster (check-in, capitaine, remplaçant) + liste des actions de l'équipe.
   - Drafts : 5 slots de pick (un par joueur) + rangée de slots de ban. Pendant la sélection, le personnage clignote dans le prochain slot libre.
   - Centre : grille du pool → sélection (clic) → barre de confirmation « Bannir X » / « Choisir X » / « Verrouiller X ». Aux étapes de côté, le pool s'estompe et un panneau de choix s'ouvre.
   - Fin : récap (ordre des cartes avec côtés, ou les deux compositions) puis « Bon match ! GL HF » et les boutons de déclaration du vainqueur.
5. **Historique** : liste numérotée, couleur par type d'action.

Validation en deux temps (sélection puis confirmation) pour éviter les clics accidentels. Seul le capitaine de l'équipe dont c'est le tour peut agir ; les autres voient l'état en direct.

## 5. Design tokens

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0A0C11` | Fond |
| `--s1` / `--s2` / `--s3` | `#12151C` / `#181C25` / `#20252F` | Surfaces |
| `--line` | `#2A303C` | Bordures |
| `--tx` / `--mu` | `#ECEEF3` / `#A3ABBA` | Texte / texte secondaire |
| `--team-a` | `#4C9DFF` | Équipe A (bleu) |
| `--team-b` | `#F2A23A` | Équipe B (orange) — bleu/orange plutôt que rouge/vert pour les daltoniens |
| `--ban` | `#FF5A67` | Bans |
| `--brand` | `#E5484D` | Logo, statut live |
| Polices | Chakra Petch (titres), IBM Plex Sans (texte), JetBrains Mono (chiffres, labels) | Google Fonts |

Les classes `.ta` / `.tb` / `.tn` posent `--tc` (couleur d'équipe) et `--tcs` (version transparente) : tous les composants d'équipe lisent ces deux variables.

## 6. Animations

Courbe principale : `cubic-bezier(.2,.8,.2,1)`. Toutes les durées sont multipliées par `--m` (1 = normal, 2.6 = ralenti de démo).

| Événement | Effet | Durée |
|---|---|---|
| Nouveau tour | Balayage couleur d'équipe dans la bannière + titre qui remonte ; chrono relancé | 520 / 420 ms |
| Survol / sélection | Lift −4 px / −6 px + halo couleur d'équipe | 180 ms |
| Ban de carte | Tampon « Banni » (scale 2.2 → 0.94 → 1, rotation −8°) + désaturation | 400 / 300 ms |
| Ban de personnage | Croix rouge tracée en 2 traits (décalage 90 ms) + slot de ban qui se tamponne | 300 / 380 ms |
| Pick | Onde qui s'élargit (0 → 18 px) puis étiquette « Pick XX » | 720 / 320 ms |
| Slot de draft | Glissé depuis la gauche + flou 4 px → 0 + liseré | 420 ms |
| Choix du côté | Pool estompé et flouté + panneau qui monte | 300 / 360 ms |
| Carte décisive | Retournement (rotateY 90° → 0) | 620 ms |
| Fin du veto | Cartes / lignes en cascade (décalage 110 ms / 80 ms), puis bloc GL HF | 560 ms |
| Changement de jeu | Tuiles du pool en cascade (35 ms par tuile, max 24) | 460 ms |

**Règle importante** : les animations d'événement sont conditionnées à la classe `.fx`, posée uniquement sur les éléments issus des nouvelles entrées d'historique. Sinon, chaque re-rendu rejouerait tous les tampons et toutes les ondes. Dans un framework à composants, l'équivalent est d'animer au montage de l'élément ou au changement d'état, pas à chaque rendu.

`prefers-reduced-motion: reduce` coupe toutes les animations et transitions.

## 7. Accessibilité

- Vrais `<button>` partout, `aria-pressed` sur la sélection, `disabled` sur les éléments indisponibles.
- Bannière de tour en `aria-live="polite"` : le changement de tour est annoncé.
- Panneau de côté en `role="dialog"`. En production : y déplacer le focus à l'ouverture.
- Cibles tactiles ≥ 44 px ; contrastes texte ≥ 4.5:1 sur les surfaces.

## 8. Points ouverts

1. Que faire quand le chrono atteint 0 ? (ban/pick aléatoire, réserve de temps à la Dota, ou simple alerte). Le prototype s'arrête à 0:00.
2. Pool Valorant à confirmer (les sources divergent).
3. Ordre tour par tour du Captains Mode Dota 2 à vérifier sur le patch en cours.
4. Mode « fearless draft » (LoL, en série) : non inclus, à ajouter si besoin (exclure les champions déjà joués dans la série).
5. Qui choisit le côté de la carte décisive en BO3 : le prototype reprend le hub actuel (équipe A).
6. Bug actuel : « Les Faucons <b> » s'affiche littéralement → les noms ne sont pas échappés correctement (risque d'injection HTML / XSS). À corriger.

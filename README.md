# PraccHub

Bot Discord de matchmaking pour trouver des **matchs** ou des **scrims** entre équipes, avec un **hub web** par match pour le check-in et le pick & ban.

Jeux supportés : Valorant, Counter-Strike 2, League of Legends, Dota 2, Rocket League.

## Fonctionnement

1. Le capitaine crée son équipe : `/equipe creer nom:<nom> jeu:<jeu> [taille]`, puis ajoute ses joueurs avec `/equipe ajouter` (titulaires + 2 remplaçants max).
2. Il lance la recherche : `/match chercher equipe:<équipe> niveau:<niveau> [type] [format] [ecart]`.
   - `niveau` : rang de l'équipe (proposé selon le jeu de l'équipe).
   - `ecart` : écart de rang accepté (défaut 1). C'est l'écart le plus strict des deux équipes qui compte.
3. Dès qu'une équipe compatible est en file (même jeu, taille, format et type, aucun joueur en commun), le match est créé et les deux salons sont notifiés, quel que soit le serveur Discord.
4. Chaque joueur clique sur **Ouvrir mon hub** et reçoit un lien personnel (signé, valable 6 h).
5. **Check-in** : il faut que `taille` joueurs de chaque équipe soient présents avant la fin du délai (10 min par défaut), sinon le match est annulé.
6. **Pick & ban** (capitaines uniquement, sélection puis confirmation, chrono de 30 s par tour). Le gagnant du pile ou face devient l'équipe A :
   - Valorant / CS2, BO1 : 6 bans alternés, carte décisive, côté choisi par l'équipe B.
   - Valorant / CS2, BO3 : A ban, B ban, A pick (+ côté B), B pick (+ côté A), A ban, B ban, carte décisive (+ côté A).
   - League of Legends : draft tournoi, 5 bans + 5 picks par équipe (A = côté bleu, first pick).
   - Dota 2 : Captains Mode, 7 bans + 5 picks par équipe (A = first pick).
   - Rocket League : l'équipe A choisit son côté.
   - « Annuler » retire la dernière action, seulement pour le capitaine qui vient de la faire.
7. **Résultat** : chaque capitaine déclare le vainqueur. Si les deux déclarations concordent, le match est validé, sinon il passe en « contesté ».

### Salon des demandes de pracc

Pour que les équipes se trouvent même quand elles sont peu nombreuses, chaque serveur peut afficher les demandes de **tous** les serveurs PraccHub :

1. Un admin (permission « Gérer le serveur ») lance `/pracc salon salon:<forum ou salon textuel> [jeu]`. Un **forum** est recommandé : chaque demande devient un post, avec des tags par jeu et par type.
2. Chaque `/match chercher` sans adversaire immédiat est publié sur ces salons (désactivable avec `publier:false`). Les demandes déjà ouvertes sont publiées dès la configuration.
3. **Discussion entre serveurs** : chaque demande a un fil par serveur (le post du forum, ou un fil ouvert sur le message en salon textuel). L'équipe qui cherche a aussi un fil sous sa commande `/match chercher` quand son serveur n'a pas de salon pracc. Tout message écrit dans l'un de ces fils est **relayé dans tous les autres**, au nom de son auteur et avec le nom de son serveur. Les mentions sont neutralisées et les pièces jointes passent sous forme de lien. Les modifications et suppressions ne sont pas relayées.
4. Un capitaine clique sur **Accepter le pracc** et choisit son équipe (même jeu, même taille). Le match est créé aussitôt, aux conditions de la demande, sans contrôle de l'écart de niveau. Le check-in et le hub arrivent dans le salon de chaque équipe, et le relais reste actif 24 h pour s'organiser.
5. Quand la demande est annulée, expirée ou remplacée, les posts sont mis à jour et les fils archivés.

`/pracc voir` affiche la configuration, et `/pracc retirer` désactive le salon.

Permissions du bot dans le salon : voir le salon, envoyer des messages, intégrer des liens, envoyer des messages dans les fils, et en salon textuel créer des fils publics. Deux permissions sont optionnelles :
- « Gérer les webhooks » : les messages relayés apparaissent avec le nom et l'avatar de leur auteur, sinon le bot les reposte en citant l'auteur.
- « Gérer les salons » : elle sert à créer les tags du forum.

Le relais lit le contenu des messages : active **Message Content Intent** dans le Discord Developer Portal (onglet Bot). Au-delà de 100 serveurs, Discord exige une vérification du bot pour cet intent privilégié.

`/match annuler` retire l'équipe de la file. `/match hub` redonne les liens vers tes matchs en cours.

## Installation

```bash
npm install
cp .env.example .env    # remplir DISCORD_TOKEN, APP_ID, HUB_SECRET, PUBLIC_URL
npm run register        # déploie les commandes slash
npm start               # bot + hub web (port PORT)
npm test                # tests (pick & ban, catalogue, matchmaking, parcours complet du hub)
npm run catalog         # met à jour champions, héros et visuels de cartes (voir plus bas)
```

Le hub doit être joignable depuis Internet via `PUBLIC_URL` (reverse proxy, hébergeur, tunnel…).

## Map pools, personnages et visuels

- Map pools, côtés et rangs : `config/games.js`. **Ils changent régulièrement, vérifie-les à chaque patch.**
- Champions LoL et héros Dota 2 : `config/catalog/*.json`, mis à jour par `npm run catalog` et automatiquement au démarrage du bot quand le cache a plus de 3 jours.
  - LoL : [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) (CDN officielle de Riot). Les filtres utilisent les classes Riot (Combattant, Mage…), Data Dragon ne fournit pas les lanes.
  - Dota 2 : API OpenDota, images sur la CDN Steam.
- Visuels de cartes : téléchargés et réduits en 640×360 dans `web/public/img/maps/` par `npm run catalog`.
  - Valorant : valorant-api.com (API communautaire, non officielle).
  - CS2 : [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) (extrait des fichiers du jeu).
- Sans image disponible, le hub affiche un dégradé et les initiales.
- Les visuels appartiennent à Riot Games et à Valve. Leur utilisation doit respecter leurs conditions pour les projets de fans ([Riot](https://www.riotgames.com/en/legal), [Valve](https://store.steampowered.com/legal/)).

Le design du hub et sa spécification sont dans `docs/pickban-handoff/`.

## Structure

- `config/games.js` : jeux, maps, côtés, rangs
- `services/pickban-core.js` : moteur de pick & ban partagé serveur / navigateur (logique pure)
- `services/catalog.js`, `scripts/sync-catalog.js` : champions, héros, visuels
- `services/matchmaking.js` : file d'attente et appariement
- `services/matchService.js` : cycle de vie d'un match (check-in, veto, résultat)
- `services/hubToken.js` : liens personnels signés (HMAC)
- `web/` : serveur Express (API + temps réel SSE) et page du hub
- `controller/match.js` : notifications Discord
- `controller/praccBoard.js`, `commands/match/pracc.js` : salon des demandes de pracc
- `commands/match/` : commandes `/equipe` et `/match`
- `commands/tournois/`, `controller/tournois.js` : ancien module de tournois (conservé)

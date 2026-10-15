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
6. **Pick & ban** (capitaines uniquement), après un pile ou face :
   - Valorant / CS2, BO1 : bans alternés jusqu'à une map, puis choix du côté.
   - Valorant / CS2, BO3 : ban, ban, pick (+ côté par l'adversaire), pick (+ côté), ban, ban, map décisive (+ côté).
   - LoL / Rocket League : choix du côté. Dota 2 : côté, puis ordre de pick choisi par l'autre équipe. Le draft des champions et des héros se fait dans le client du jeu.
7. **Résultat** : chaque capitaine déclare le vainqueur. Si les deux déclarations concordent, le match est validé, sinon il passe en « contesté ».

`/match annuler` retire l'équipe de la file. `/match hub` redonne les liens vers tes matchs en cours.

## Installation

```bash
npm install
cp .env.example .env    # remplir DISCORD_TOKEN, APP_ID, HUB_SECRET, PUBLIC_URL
npm run register        # déploie les commandes slash
npm start               # bot + hub web (port PORT)
npm test                # tests (veto, matchmaking, parcours complet du hub)
```

Le hub doit être joignable depuis Internet via `PUBLIC_URL` (reverse proxy, hébergeur, tunnel…).

## Map pools

Les map pools et les rangs sont dans `config/games.js`. **Ils changent régulièrement, vérifie-les à chaque patch.**

## Structure

- `config/games.js` : jeux, maps, côtés, rangs
- `services/veto.js` : moteur de pick & ban (logique pure)
- `services/matchmaking.js` : file d'attente et appariement
- `services/matchService.js` : cycle de vie d'un match (check-in, veto, résultat)
- `services/hubToken.js` : liens personnels signés (HMAC)
- `web/` : serveur Express (API + temps réel SSE) et page du hub
- `controller/match.js` : notifications Discord
- `commands/match/` : commandes `/equipe` et `/match`
- `commands/tournois/`, `controller/tournois.js` : ancien module de tournois (conservé)

/**
 * Configuration des jeux supportés par le hub de match.
 *
 * ATTENTION : les map pools changent régulièrement (Valorant tourne presque à chaque acte,
 * Valve modifie l'Active Duty de CS2 plusieurs fois par an). Vérifier ces listes à chaque patch.
 * Dernière vérification : octobre 2026.
 *
 * veto :
 *  - 'maps'  : ban/pick de maps puis choix du côté (Valorant, CS2)
 *  - 'sides' : pas de veto de map, le gagnant du pile ou face choisit son côté
 *              (le draft des champions/héros se fait dans le client du jeu)
 */
const GAMES = {
	valorant: {
		id: 'valorant',
		name: 'Valorant',
		sizes: [5],
		veto: 'maps',
		formats: ['bo1', 'bo3'],
		maps: ['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset'],
		sides: ['Attaque', 'Défense'],
		levels: ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'],
	},
	cs2: {
		id: 'cs2',
		name: 'Counter-Strike 2',
		sizes: [5],
		veto: 'maps',
		formats: ['bo1', 'bo3'],
		maps: ['Ancient', 'Anubis', 'Cache', 'Dust II', 'Inferno', 'Mirage', 'Nuke'],
		sides: ['Terroriste (T)', 'Anti-terroriste (CT)'],
		levels: [
			'Premier 0 – 4 999',
			'Premier 5 000 – 9 999',
			'Premier 10 000 – 14 999',
			'Premier 15 000 – 19 999',
			'Premier 20 000 – 24 999',
			'Premier 25 000 – 29 999',
			'Premier 30 000+',
		],
	},
	lol: {
		id: 'lol',
		name: 'League of Legends',
		sizes: [5],
		veto: 'sides',
		formats: ['bo1', 'bo3'],
		sides: ['Côté bleu', 'Côté rouge'],
		levels: ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Maître', 'Grand Maître', 'Challenger'],
	},
	dota2: {
		id: 'dota2',
		name: 'Dota 2',
		sizes: [5],
		veto: 'sides',
		formats: ['bo1', 'bo3'],
		sides: ['Radiant', 'Dire'],
		extraChoice: { label: 'Ordre de pick', options: ['First pick', 'Second pick'] },
		levels: ['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'],
	},
	rocketleague: {
		id: 'rocketleague',
		name: 'Rocket League',
		sizes: [1, 2, 3],
		veto: 'sides',
		formats: ['bo1', 'bo3', 'bo5'],
		sides: ['Équipe bleue', 'Équipe orange'],
		levels: ['Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Champion', 'Grand Champion', 'Supersonic Legend'],
	},
};

const MATCH_TYPES = {
	scrim: 'Scrim (entraînement)',
	match: 'Match officiel',
};

function getGame(id) {
	const game = GAMES[id];
	if (!game) throw new Error(`Jeu inconnu : ${id}`);
	return game;
}

module.exports = { GAMES, MATCH_TYPES, getGame };

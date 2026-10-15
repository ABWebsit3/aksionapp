/**
 * Configuration des jeux supportés par le hub de match.
 *
 * ATTENTION : les map pools changent régulièrement (Valorant tourne presque à chaque acte,
 * Valve modifie l'Active Duty de CS2 plusieurs fois par an). Vérifier ces listes à chaque patch.
 * Dernière vérification : 15 octobre 2026 (Valorant : rotation de l'acte 6 du 13/10/2026).
 *
 * veto :
 *  - 'maps'  : ban/pick de cartes puis choix du côté (Valorant, CS2)
 *  - 'draft' : bans/picks de personnages (LoL, Dota 2), séquence `draft` de services/pickban-core.js
 *  - 'sides' : pas de veto, le gagnant du pile ou face choisit son côté (Rocket League)
 *
 * Cartes : `hue` sert de couleur de repli si l'image n'est pas disponible.
 * Les images et les listes de personnages viennent du catalogue (services/catalog.js).
 */
const map = (id, name, hue, extra = {}) => ({ id, name, hue, ...extra });

const GAMES = {
	valorant: {
		id: 'valorant',
		name: 'Valorant',
		short: 'VAL',
		sizes: [5],
		veto: 'maps',
		formats: ['bo1', 'bo3'],
		maps: [
			map('abyss', 'Abyss', 255),
			map('bind', 'Bind', 25),
			map('corrode', 'Corrode', 110),
			map('haven', 'Haven', 140),
			map('lotus', 'Lotus', 320),
			map('summit', 'Summit', 180),
			map('sunset', 'Sunset', 15),
		],
		sides: [['Attaque', 'Pose le spike'], ['Défense', 'Protège les sites']],
		levels: ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Ascendant', 'Immortel', 'Radiant'],
	},
	cs2: {
		id: 'cs2',
		name: 'Counter-Strike 2',
		short: 'CS2',
		sizes: [5],
		veto: 'maps',
		formats: ['bo1', 'bo3'],
		maps: [
			map('ancient', 'Ancient', 150, { file: 'de_ancient' }),
			map('anubis', 'Anubis', 40, { file: 'de_anubis' }),
			map('cache', 'Cache', 95, { file: 'de_cache' }),
			map('dust2', 'Dust II', 35, { file: 'de_dust2' }),
			map('inferno', 'Inferno', 10, { file: 'de_inferno' }),
			map('mirage', 'Mirage', 50, { file: 'de_mirage' }),
			map('nuke', 'Nuke', 210, { file: 'de_nuke' }),
		],
		sides: [['CT', 'Anti-terroristes'], ['T', 'Terroristes']],
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
		short: 'LOL',
		sizes: [5],
		veto: 'draft',
		draft: 'lol',
		noun: 'un champion',
		nounPl: 'Champions',
		// Le draft du hub couvre une partie (les parties suivantes se draftent dans le client)
		formats: ['bo1'],
		teamMeta: { A: 'Côté bleu · first pick', B: 'Côté rouge' },
		levels: ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Émeraude', 'Diamant', 'Maître', 'Grand Maître', 'Challenger'],
	},
	dota2: {
		id: 'dota2',
		name: 'Dota 2',
		short: 'DOTA',
		sizes: [5],
		veto: 'draft',
		draft: 'dota',
		noun: 'un héros',
		nounPl: 'Héros',
		formats: ['bo1'],
		teamMeta: { A: 'First pick', B: 'Second pick' },
		levels: ['Herald', 'Guardian', 'Crusader', 'Archon', 'Legend', 'Ancient', 'Divine', 'Immortal'],
	},
	rocketleague: {
		id: 'rocketleague',
		name: 'Rocket League',
		short: 'RL',
		sizes: [1, 2, 3],
		veto: 'sides',
		formats: ['bo1', 'bo3', 'bo5'],
		sides: [['Équipe bleue', 'Côté bleu'], ['Équipe orange', 'Côté orange']],
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

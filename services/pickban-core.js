/* global window, globalThis */
/**
 * PraccHub — moteur de pick & ban, partagé entre le serveur (source de vérité,
 * validation de chaque action) et le navigateur (affichage). Logique pure, sans DOM.
 * Porté depuis docs/pickban-handoff/prototype/pickban-core.js : mêmes séquences et
 * mêmes règles, mais le pool et les côtés sont fournis par le serveur (config/catalogue)
 * au lieu d'être codés en dur.
 *
 * Convention : équipe A = gagnant du pile ou face (first pick, côté bleu sur LoL).
 * Entrées du log : { t, team, id } pour ban/pick/decider, { t: 'side', team, side, mapId }.
 */
(function(root) {
	'use strict';

	const r = (t, s) => s.split('').map(team => ({ t, team }));

	const SEQS = {
		// Veto de cartes BO3 : A ban, B ban, A pick, B côté, B pick, A côté, A ban, B ban, décisive, A côté
		bo3: [].concat(r('ban', 'AB'), r('pick', 'A'), [{ t: 'side', team: 'B' }], r('pick', 'B'), [{ t: 'side', team: 'A' }], r('ban', 'AB'), [{ t: 'decider', team: null }], [{ t: 'side', team: 'A' }]),
		// Veto de cartes BO1 : 6 bans alternés, carte restante, côté à l'équipe B
		bo1: [].concat(r('ban', 'ABABAB'), [{ t: 'decider', team: null }], [{ t: 'side', team: 'B' }]),
		// League of Legends : draft tournoi standard (5 bans + 5 picks par équipe)
		lol: [].concat(r('ban', 'ABABAB'), r('pick', 'ABBAAB'), r('ban', 'BABA'), r('pick', 'BAAB')),
		// Dota 2 : Captains Mode (7 bans + 5 picks par équipe). Ordre tour par tour à revérifier à chaque patch.
		dota: [].concat(r('ban', 'ABBABBA'), r('pick', 'AB'), r('ban', 'AAB'), r('pick', 'BAABBA'), r('ban', 'ABBA'), r('pick', 'AB')),
		// Jeux sans veto (Rocket League) : le gagnant du pile ou face choisit son côté
		sides: [{ t: 'side', team: 'A' }],
	};

	const TURN_SECONDS = 30;

	/**
	 * @param {object} opts
	 * @param {'maps'|'draft'|'sides'} opts.kind
	 * @param {string} opts.seq clé de SEQS (bo1, bo3, lol, dota, sides)
	 * @param {string[]} opts.pool identifiants autorisés (cartes, champions, héros)
	 * @param {string[]} opts.sides côtés possibles
	 */
	function createState(opts) {
		if (!SEQS[opts.seq]) throw new Error('Séquence inconnue : ' + opts.seq);
		return { kind: opts.kind, seq: opts.seq, pool: (opts.pool || []).slice(), sides: (opts.sides || []).slice(), log: [] };
	}

	function sequenceOf(state) {
		return SEQS[state.seq];
	}

	function currentStep(state) {
		const seq = sequenceOf(state);
		return state.log.length < seq.length ? Object.assign({ index: state.log.length }, seq[state.log.length]) : null;
	}

	function isDone(state) {
		return currentStep(state) === null;
	}

	/** id -> entrée de log (ban / pick / decider) */
	function statusMap(state) {
		const out = {};
		state.log.forEach(e => {
			if (e.id && e.t !== 'side') out[e.id] = e;
		});
		return out;
	}

	function lastMapId(state) {
		for (let i = state.log.length - 1; i >= 0; i--) {
			const e = state.log[i];
			if (e.t === 'pick' || e.t === 'decider') return e.id;
		}
		return null;
	}

	/**
	 * Applique une action et renvoie un NOUVEL état. Lève une erreur si l'action est invalide.
	 * action : { team, id } pour ban/pick, { team, side } pour side.
	 */
	function apply(state, action) {
		const step = currentStep(state);
		if (!step) throw new Error('Veto terminé');
		if (step.team !== action.team) throw new Error('Ce n\'est pas le tour de ton équipe');
		let entry;
		if (step.t === 'ban' || step.t === 'pick') {
			if (!state.pool.includes(action.id)) throw new Error('Élément inconnu : ' + action.id);
			if (statusMap(state)[action.id]) throw new Error('Élément déjà utilisé : ' + action.id);
			entry = { t: step.t, team: step.team, id: action.id };
		}
		else if (step.t === 'side') {
			if (!state.sides.includes(action.side)) throw new Error('Côté invalide : ' + action.side);
			entry = { t: 'side', team: step.team, side: action.side, mapId: lastMapId(state) };
		}
		else {
			throw new Error('Étape automatique');
		}
		const log = state.log.concat([entry]);
		const next = sequenceOf(state)[log.length];
		// Carte décisive automatique : la seule carte restante
		if (next && next.t === 'decider') {
			const used = {};
			log.forEach(e => {
				if (e.id && e.t !== 'side') used[e.id] = 1;
			});
			const remaining = state.pool.find(id => !used[id]);
			if (remaining) log.push({ t: 'decider', team: null, id: remaining });
		}
		return Object.assign({}, state, { log });
	}

	/** Retire la dernière action ; si c'était la décisive automatique, retire aussi le ban qui l'a déclenchée. */
	function undo(state) {
		const log = state.log.slice();
		const removed = log.pop();
		if (removed && removed.t === 'decider') log.pop();
		return Object.assign({}, state, { log });
	}

	/** Équipe qui a fait la dernière action humaine (ignore la décisive automatique). */
	function lastActor(state) {
		for (let i = state.log.length - 1; i >= 0; i--) {
			if (state.log[i].team) return state.log[i].team;
		}
		return null;
	}

	/** Nom de phase lisible : "Bans 1", "Picks 2", "Choix du côté"… */
	function phaseName(seq, i) {
		const t = seq[i].t;
		if (t === 'side') return 'Choix du côté';
		if (t === 'decider') return 'Carte décisive';
		let n = 0;
		let prev = null;
		for (let k = 0; k <= i; k++) {
			const tk = seq[k].t;
			if (tk !== 'ban' && tk !== 'pick') continue;
			if (tk === t && prev !== t) n++;
			prev = tk;
		}
		return (t === 'ban' ? 'Bans ' : 'Picks ') + n;
	}

	const api = { SEQS, TURN_SECONDS, createState, sequenceOf, currentStep, isDone, statusMap, lastMapId, apply, undo, lastActor, phaseName };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.PickBan = api;
})(typeof window !== 'undefined' ? window : globalThis);

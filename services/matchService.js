const { EventEmitter } = require('node:events');
const { models } = require('../models');
const { getGame } = require('../config/games');
const PickBan = require('./pickban-core');
const { poolIds } = require('./catalog');

/**
 * Cycle de vie d'un match :
 *   checkin -> veto -> live -> finished
 *                \-> cancelled (check-in expiré ou annulation)
 *   live -> disputed (résultats contradictoires) -> finished
 */

const CHECKIN_TTL_MS = (parseInt(process.env.CHECKIN_MINUTES) || 10) * 60 * 1000;

// 'update' (match) à chaque modification, 'status' ({ match, previous }) à chaque changement de statut
const matchEvents = new EventEmitter();
matchEvents.setMaxListeners(0);

const locks = new Map();
function withMatchLock(id, fn) {
	const previous = locks.get(id) || Promise.resolve();
	const run = previous.then(fn, fn);
	const tail = run.catch(() => undefined);
	locks.set(id, tail);
	tail.then(() => {
		if (locks.get(id) === tail) locks.delete(id);
	});
	return run;
}

function toMatch(row) {
	return { id: row.id, status: row.status, ...JSON.parse(row.data) };
}

function snapshotTeam({ team, channelId, guildId }) {
	return {
		teamId: team.id,
		name: team.name,
		captainId: team.captainId,
		members: JSON.parse(team.members),
		channelId,
		guildId,
	};
}

async function createMatch({ game, format, type, level, teams }) {
	const data = {
		game,
		format,
		type,
		level,
		size: teams[0].team.size,
		teams: { A: snapshotTeam(teams[0]), B: snapshotTeam(teams[1]) },
		checkin: {},
		checkinDeadline: Date.now() + CHECKIN_TTL_MS,
		veto: null,
		result: { reports: {}, winner: null },
		createdAt: Date.now(),
	};
	const row = await models.Matches.create({ game, status: 'checkin', data: JSON.stringify(data) });
	const match = toMatch(row);
	matchEvents.emit('status', { match, previous: null });
	return match;
}

async function getMatch(id) {
	const row = await models.Matches.findByPk(id);
	return row ? toMatch(row) : null;
}

/**
 * Applique `mutator(match)` sous verrou et persiste le résultat.
 * Le mutator modifie l'objet en place et peut lever une erreur pour refuser l'action.
 * S'il renvoie `false`, rien n'a changé : pas d'écriture ni de notification.
 */
function mutate(id, mutator) {
	return withMatchLock(id, async () => {
		const row = await models.Matches.findByPk(id);
		if (!row) throw new Error('Match introuvable');
		const match = toMatch(row);
		const previous = match.status;
		if (await mutator(match) === false) return match;
		const data = { ...match };
		delete data.id;
		delete data.status;
		await row.update({ status: match.status, data: JSON.stringify(data) });
		matchEvents.emit('update', match);
		if (match.status !== previous) matchEvents.emit('status', { match, previous });
		return match;
	});
}

function teamOf(match, userId) {
	for (const key of ['A', 'B']) {
		if (match.teams[key].members.some(m => m.id === userId)) return key;
	}
	return null;
}

function isCaptain(match, userId) {
	const team = teamOf(match, userId);
	return team !== null && match.teams[team].captainId === userId;
}

/** Crée l'état de pick & ban adapté au jeu (cartes, draft ou simple choix de côté). */
function createVetoState(match) {
	const game = getGame(match.game);
	const sides = (game.sides || []).map(([name]) => name);
	if (game.veto === 'maps') {
		const seed = Math.floor(Math.random() * 1000);
		return PickBan.createState({ kind: 'maps', seq: match.format, pool: game.maps.map(m => m.id), sides, seed });
	}
	if (game.veto === 'draft') return PickBan.createState({ kind: 'draft', seq: game.draft, pool: poolIds(game.id), sides: [] });
	return PickBan.createState({ kind: 'sides', seq: 'sides', pool: [], sides });
}

/** Pile ou face : le gagnant devient l'équipe A (first pick, côté bleu sur LoL). */
function coinToss(match) {
	const swapped = Math.random() < 0.5;
	if (swapped) match.teams = { A: match.teams.B, B: match.teams.A };
	match.coinToss = { winner: 'A', swapped };
}

function checkedInCount(match, key) {
	return match.teams[key].members.filter(m => match.checkin[m.id]).length;
}

function checkIn(id, userId) {
	return mutate(id, match => {
		if (match.status !== 'checkin') throw new Error('Le check-in est terminé');
		if (!teamOf(match, userId)) throw new Error('Tu ne fais pas partie de ce match');
		if (match.checkin[userId]) return;
		match.checkin[userId] = Date.now();

		if (checkedInCount(match, 'A') >= match.size && checkedInCount(match, 'B') >= match.size) {
			match.status = 'veto';
			coinToss(match);
			match.veto = { ...createVetoState(match), turnStartedAt: Date.now() };
		}
	});
}

/** action : { id } pour un ban/pick, { side } pour un choix de côté. Validée par le moteur partagé. */
function vetoAction(id, userId, action = {}) {
	return mutate(id, match => {
		if (match.status !== 'veto') throw new Error('Le pick & ban n\'est pas en cours');
		if (!isCaptain(match, userId)) throw new Error('Seul le capitaine peut faire le pick & ban');
		const team = teamOf(match, userId);
		const next = PickBan.apply(match.veto, { team, id: action.id, side: action.side });
		match.veto = { ...next, turnStartedAt: Date.now() };
		if (PickBan.isDone(match.veto)) match.status = 'live';
	});
}

/** Annule la dernière action, uniquement par le capitaine qui l'a faite, tant que le veto est en cours. */
function undoVeto(id, userId) {
	return mutate(id, match => {
		if (match.status !== 'veto') throw new Error('Le pick & ban n\'est pas en cours');
		if (!isCaptain(match, userId)) throw new Error('Seul le capitaine peut annuler');
		if (PickBan.lastActor(match.veto) !== teamOf(match, userId)) {
			throw new Error('Tu ne peux annuler que la dernière action de ton équipe');
		}
		match.veto = { ...PickBan.undo(match.veto), turnStartedAt: Date.now() };
	});
}

function reportResult(id, userId, winner) {
	return mutate(id, match => {
		if (!['live', 'disputed'].includes(match.status)) throw new Error('Le match n\'est pas en cours');
		if (!isCaptain(match, userId)) throw new Error('Seul le capitaine peut déclarer le résultat');
		if (!['A', 'B'].includes(winner)) throw new Error('Vainqueur invalide');
		match.result.reports[teamOf(match, userId)] = winner;

		const { A, B } = match.result.reports;
		if (A && B) {
			if (A === B) {
				match.result.winner = A;
				match.status = 'finished';
			}
			else {
				match.status = 'disputed';
			}
		}
	});
}

function cancelMatch(id, reason, userId = null) {
	return mutate(id, match => {
		if (!['checkin', 'veto'].includes(match.status)) throw new Error('Ce match ne peut plus être annulé');
		if (userId && !isCaptain(match, userId)) throw new Error('Seul un capitaine peut annuler le match');
		match.status = 'cancelled';
		match.cancelReason = reason;
	});
}

/**
 * Chrono écoulé (30 s) sur un ban : le tour passe sans ban. Les picks et les choix de côté attendent.
 * @param {number} expectedIndex étape visée (ignore un timer devenu obsolète), facultatif
 */
function skipExpiredTurn(id, now = Date.now(), expectedIndex = null) {
	return mutate(id, match => {
		if (match.status !== 'veto') return false;
		const step = PickBan.currentStep(match.veto);
		if (!step || step.t !== 'ban') return false;
		if (expectedIndex !== null && step.index !== expectedIndex) return false;
		if (now < match.veto.turnStartedAt + PickBan.TURN_SECONDS * 1000) return false;
		match.veto = { ...PickBan.skip(match.veto, step.team), turnStartedAt: now };
		if (PickBan.isDone(match.veto)) match.status = 'live';
	});
}

// Un timer par match en veto, recalé à chaque modification ; le balayage périodique sert de filet (redémarrage)
const turnTimers = new Map();
function scheduleTurnTimer(match) {
	clearTimeout(turnTimers.get(match.id));
	turnTimers.delete(match.id);
	if (match.status !== 'veto') return;
	const step = PickBan.currentStep(match.veto);
	if (!step || step.t !== 'ban') return;
	const delay = Math.max(0, match.veto.turnStartedAt + PickBan.TURN_SECONDS * 1000 - Date.now()) + 250;
	const timer = setTimeout(() => {
		turnTimers.delete(match.id);
		skipExpiredTurn(match.id, Date.now(), step.index).catch(console.error);
	}, delay);
	timer.unref();
	turnTimers.set(match.id, timer);
}

function startTurnTimers() {
	matchEvents.on('update', scheduleTurnTimer);
	matchEvents.on('status', ({ match }) => scheduleTurnTimer(match));
}

async function expireVetoTurns() {
	const rows = await models.Matches.findAll({ where: { status: 'veto' } });
	for (const row of rows) await skipExpiredTurn(row.id).catch(console.error);
}

async function expireCheckins() {
	const rows = await models.Matches.findAll({ where: { status: 'checkin' } });
	const expired = rows.map(toMatch).filter(m => m.checkinDeadline < Date.now());
	for (const match of expired) {
		await cancelMatch(match.id, 'Check-in expiré : toutes les équipes n\'étaient pas présentes à temps.').catch(() => undefined);
	}
	return expired.length;
}

/** Vue envoyée au navigateur, contextualisée pour le joueur connecté. */
function publicView(match, userId) {
	const game = getGame(match.game);
	const team = teamOf(match, userId);
	const teams = {};
	for (const key of ['A', 'B']) {
		const t = match.teams[key];
		teams[key] = {
			name: t.name,
			captainId: t.captainId,
			checkedIn: checkedInCount(match, key),
			members: t.members.map(m => ({ id: m.id, name: m.name, captain: m.id === t.captainId, checkedIn: Boolean(match.checkin[m.id]) })),
		};
	}
	return {
		id: match.id,
		status: match.status,
		game: { id: game.id, name: game.name, short: game.short, veto: game.veto, noun: game.noun || 'une carte', nounPl: game.nounPl || 'Cartes', sides: game.sides || [], teamMeta: game.teamMeta || null },
		format: match.format,
		type: match.type,
		level: game.levels[match.level] || null,
		size: match.size,
		checkinDeadline: match.checkinDeadline,
		teams,
		veto: match.veto ? {
			...match.veto,
			current: PickBan.currentStep(match.veto),
			lastActor: PickBan.lastActor(match.veto),
			turnSeconds: PickBan.TURN_SECONDS,
		} : null,
		coinToss: match.coinToss || null,
		serverNow: Date.now(),
		result: match.result,
		cancelReason: match.cancelReason || null,
		viewer: { userId, team, captain: isCaptain(match, userId), checkedIn: Boolean(match.checkin[userId]) },
	};
}

module.exports = {
	matchEvents,
	createMatch,
	getMatch,
	checkIn,
	vetoAction,
	undoVeto,
	skipExpiredTurn,
	startTurnTimers,
	expireVetoTurns,
	reportResult,
	cancelMatch,
	expireCheckins,
	publicView,
	teamOf,
	isCaptain,
	CHECKIN_TTL_MS,
};

const { EventEmitter } = require('node:events');
const { models } = require('../models');
const { getGame } = require('../config/games');
const { createVeto, applyAction, currentStep } = require('./veto');

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
 */
function mutate(id, mutator) {
	return withMatchLock(id, async () => {
		const row = await models.Matches.findByPk(id);
		if (!row) throw new Error('Match introuvable');
		const match = toMatch(row);
		const previous = match.status;
		await mutator(match);
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
			match.veto = createVeto(getGame(match.game), match.format, Math.random() < 0.5 ? 'A' : 'B');
		}
	});
}

function vetoAction(id, userId, value) {
	return mutate(id, match => {
		if (match.status !== 'veto') throw new Error('Le pick & ban n\'est pas en cours');
		if (!isCaptain(match, userId)) throw new Error('Seul le capitaine peut faire le pick & ban');
		match.veto = applyAction(match.veto, teamOf(match, userId), value);
		if (match.veto.done) match.status = 'live';
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
		game: { id: game.id, name: game.name },
		format: match.format,
		type: match.type,
		level: game.levels[match.level] || null,
		size: match.size,
		checkinDeadline: match.checkinDeadline,
		teams,
		veto: match.veto ? { ...match.veto, current: currentStep(match.veto) } : null,
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
	reportResult,
	cancelMatch,
	expireCheckins,
	publicView,
	teamOf,
	isCaptain,
	CHECKIN_TTL_MS,
};

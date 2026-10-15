const { EventEmitter } = require('node:events');
const { Op } = require('sequelize');
const { models } = require('../models');
const { getGame } = require('../config/games');
const { createMatch } = require('./matchService');

const QUEUE_TTL_MS = (parseInt(process.env.QUEUE_TTL_MINUTES) || 30) * 60 * 1000;

/**
 * Événements de la file, écoutés par le tableau des demandes de pracc (controller/praccBoard.js) :
 *  - 'queued' ({ entry, team })                       une demande est en attente
 *  - 'closed' ({ entryId, reason, match? })           reason : matched | cancelled | expired | replaced
 */
const queueEvents = new EventEmitter();

/** Supprime des demandes et prévient le tableau des pracc. */
async function removeEntries(where, reason, match = null) {
	const entries = await models.QueueEntries.findAll({ where });
	if (!entries.length) return 0;
	await models.QueueEntries.destroy({ where: { id: entries.map(e => e.id) } });
	for (const entry of entries) queueEvents.emit('closed', { entryId: entry.id, reason, match });
	return entries.length;
}

/**
 * Deux demandes sont compatibles si elles portent sur le même jeu, format, taille et type,
 * que l'écart de niveau respecte la tolérance des DEUX équipes, et qu'aucun joueur n'est
 * dans les deux équipes.
 * @returns l'entrée adverse la plus ancienne compatible, ou null
 */
function findOpponent(entry, candidates) {
	const playerIds = new Set(entry.memberIds);
	const compatible = candidates
		.filter(c => c.teamId !== entry.teamId)
		.filter(c => c.game === entry.game && c.size === entry.size && c.format === entry.format && c.type === entry.type)
		.filter(c => Math.abs(c.level - entry.level) <= Math.min(c.tolerance, entry.tolerance))
		.filter(c => !c.memberIds.some(id => playerIds.has(id)))
		.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
	return compatible[0] || null;
}

function parseMembers(team) {
	return JSON.parse(team.members);
}

// Sérialise les recherches pour éviter qu'une équipe soit appariée deux fois en parallèle
let queueLock = Promise.resolve();
function withQueueLock(fn) {
	const run = queueLock.then(fn, fn);
	queueLock = run.catch(() => undefined);
	return run;
}

/**
 * Inscrit une équipe en file d'attente, ou crée immédiatement le match si un adversaire est trouvé.
 * @returns {{ status: 'matched', match } | { status: 'queued', entry }}
 */
function search({ team, format, type, level, tolerance, channelId, guildId, requestedBy, announce = true }) {
	return withQueueLock(async () => {
		const game = getGame(team.game);
		if (!game.formats.includes(format)) throw new Error(`Format ${format} indisponible pour ${game.name}`);
		const members = parseMembers(team);
		if (members.length < team.size) {
			throw new Error(`Ton équipe n'a que ${members.length} joueur(s), il en faut ${team.size}. Utilise /equipe ajouter.`);
		}

		const activeMatch = await findActiveMatchForTeam(team.id);
		if (activeMatch) throw new Error('Ton équipe a déjà un match en cours.');

		await removeEntries({ teamId: team.id }, 'replaced');
		await purgeExpired();

		const others = await models.QueueEntries.findAll({ where: { game: team.game } });
		const teams = await models.MatchTeams.findAll({ where: { id: others.map(o => o.teamId) } });
		const teamsById = new Map(teams.map(t => [t.id, t]));
		const candidates = others
			.filter(o => teamsById.has(o.teamId))
			.map(o => ({ ...o.get({ plain: true }), memberIds: parseMembers(teamsById.get(o.teamId)).map(m => m.id) }));

		const request = { teamId: team.id, game: team.game, size: team.size, format, type, level, tolerance, memberIds: members.map(m => m.id) };
		const opponent = findOpponent(request, candidates);

		if (opponent) {
			await models.QueueEntries.destroy({ where: { id: opponent.id } });
			const match = await createMatch({
				game: team.game,
				format,
				type,
				level: Math.round((level + opponent.level) / 2),
				teams: [
					{ team: teamsById.get(opponent.teamId), channelId: opponent.channelId, guildId: opponent.guildId },
					{ team, channelId, guildId },
				],
			});
			queueEvents.emit('closed', { entryId: opponent.id, reason: 'matched', match });
			return { status: 'matched', match };
		}

		const entry = await models.QueueEntries.create({
			teamId: team.id,
			game: team.game,
			size: team.size,
			format,
			type,
			level,
			tolerance,
			channelId,
			guildId,
			requestedBy,
			expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
		});
		if (announce) queueEvents.emit('queued', { entry, team });
		return { status: 'queued', entry };
	});
}

/** Équipes de l'utilisateur pouvant répondre à une demande : capitaine, même jeu et même taille. */
async function eligibleTeams(userId, entry) {
	const teams = await models.MatchTeams.findAll({ where: { captainId: userId, game: entry.game, size: entry.size } });
	return teams.filter(t => t.id !== entry.teamId);
}

/**
 * Une équipe accepte une demande publiée sur le tableau des pracc : le match est créé directement,
 * aux conditions de la demande (format, type, niveau), sans contrôle de l'écart de niveau.
 */
function acceptRequest({ entryId, team, channelId, guildId }) {
	return withQueueLock(async () => {
		const entry = await models.QueueEntries.findByPk(entryId);
		if (!entry || entry.expiresAt < new Date()) throw new Error('Cette demande n\'est plus disponible.');
		if (entry.teamId === team.id) throw new Error('C\'est la demande de ton équipe.');
		if (team.game !== entry.game || team.size !== entry.size) {
			throw new Error(`${team.name} ne correspond pas à la demande (${getGame(entry.game).name} ${entry.size}v${entry.size}).`);
		}
		const requester = await models.MatchTeams.findByPk(entry.teamId);
		if (!requester) throw new Error('L\'équipe qui a publié la demande n\'existe plus.');

		const members = parseMembers(team);
		if (members.length < team.size) throw new Error(`${team.name} n'a que ${members.length} joueur(s), il en faut ${team.size}.`);
		const requesterIds = new Set(parseMembers(requester).map(m => m.id));
		if (members.some(m => requesterIds.has(m.id))) throw new Error('Un de tes joueurs est aussi dans l\'équipe adverse.');
		if (await findActiveMatchForTeam(team.id)) throw new Error(`${team.name} a déjà un match en cours.`);
		if (await findActiveMatchForTeam(requester.id)) throw new Error('L\'équipe adverse a déjà un match en cours.');

		await models.QueueEntries.destroy({ where: { id: entry.id } });
		const match = await createMatch({
			game: entry.game,
			format: entry.format,
			type: entry.type,
			level: entry.level,
			teams: [
				{ team: requester, channelId: entry.channelId, guildId: entry.guildId },
				{ team, channelId, guildId },
			],
		});
		queueEvents.emit('closed', { entryId: entry.id, reason: 'matched', match });
		// Si l'équipe qui accepte cherchait aussi de son côté, sa propre demande est retirée
		await removeEntries({ teamId: team.id }, 'matched', match);
		return match;
	});
}

function cancelSearch(teamId) {
	return withQueueLock(() => removeEntries({ teamId }, 'cancelled'));
}

function purgeExpired() {
	return removeEntries({ expiresAt: { [Op.lt]: new Date() } }, 'expired');
}

async function findActiveMatchForTeam(teamId) {
	const matches = await models.Matches.findAll({ where: { status: ['checkin', 'veto', 'live', 'disputed'] } });
	return matches.find(m => {
		const data = JSON.parse(m.data);
		return data.teams.A.teamId === teamId || data.teams.B.teamId === teamId;
	}) || null;
}

module.exports = { findOpponent, search, acceptRequest, eligibleTeams, cancelSearch, purgeExpired, queueEvents, QUEUE_TTL_MS };

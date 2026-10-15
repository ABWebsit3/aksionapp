const { Op } = require('sequelize');
const { models } = require('../models');
const { getGame } = require('../config/games');
const { createMatch } = require('./matchService');

const QUEUE_TTL_MS = (parseInt(process.env.QUEUE_TTL_MINUTES) || 30) * 60 * 1000;

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
function search({ team, format, type, level, tolerance, channelId, guildId, requestedBy }) {
	return withQueueLock(async () => {
		const game = getGame(team.game);
		if (!game.formats.includes(format)) throw new Error(`Format ${format} indisponible pour ${game.name}`);
		const members = parseMembers(team);
		if (members.length < team.size) {
			throw new Error(`Ton équipe n'a que ${members.length} joueur(s), il en faut ${team.size}. Utilise /equipe ajouter.`);
		}

		const activeMatch = await findActiveMatchForTeam(team.id);
		if (activeMatch) throw new Error('Ton équipe a déjà un match en cours.');

		await models.QueueEntries.destroy({ where: { teamId: team.id } });
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
		return { status: 'queued', entry };
	});
}

function cancelSearch(teamId) {
	return withQueueLock(() => models.QueueEntries.destroy({ where: { teamId } }));
}

function purgeExpired() {
	return models.QueueEntries.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
}

async function findActiveMatchForTeam(teamId) {
	const matches = await models.Matches.findAll({ where: { status: ['checkin', 'veto', 'live', 'disputed'] } });
	return matches.find(m => {
		const data = JSON.parse(m.data);
		return data.teams.A.teamId === teamId || data.teams.B.teamId === teamId;
	}) || null;
}

module.exports = { findOpponent, search, cancelSearch, purgeExpired, QUEUE_TTL_MS };

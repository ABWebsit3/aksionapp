const { models } = require('./../../models');

async function getTournaments() {
	const result = await models.Tournaments.findAll();
	return result.map(r => {return { name : r.name, value: r.guildId };});
}

module.export = { getTournaments }
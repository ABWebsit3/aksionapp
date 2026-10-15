const { Events } = require('discord.js');
const { init } = require('./../models');
const { startWebServer } = require('../web/server');
const { registerMatchNotifications } = require('../controller/match');
const { expireCheckins } = require('../services/matchService');
const { purgeExpired } = require('../services/matchmaking');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		await init();
		registerMatchNotifications(client);
		startWebServer();
		// Nettoyage périodique : check-in expirés et recherches périmées
		setInterval(() => {
			expireCheckins().catch(console.error);
			purgeExpired().catch(console.error);
		}, 30_000);
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};

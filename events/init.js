const { Events } = require('discord.js');
const { init } = require('./../models');
const { startWebServer } = require('../web/server');
const { registerMatchNotifications } = require('../controller/match');
const { expireCheckins, expireVetoTurns, startTurnTimers } = require('../services/matchService');
const { purgeExpired } = require('../services/matchmaking');
const { refreshStale } = require('../services/catalog');

module.exports = {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		await init();
		registerMatchNotifications(client);
		startTurnTimers();
		// Après un redémarrage : les tours de ban déjà expirés sont sautés tout de suite
		expireVetoTurns().catch(console.error);
		startWebServer();
		// Listes de champions / héros à jour (Data Dragon, OpenDota), sans bloquer le démarrage
		refreshStale().catch(console.error);
		// Nettoyage périodique : check-in expirés et recherches périmées
		setInterval(() => {
			expireCheckins().catch(console.error);
			expireVetoTurns().catch(console.error);
			purgeExpired().catch(console.error);
		}, 30_000);
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};

const { Events } = require('discord.js');
const { init } = require('./../models');

module.exports = {
	name: Events.ClientReady,
	once: true,
	execute(client) {
    init();
		console.log(`Ready! Logged in as ${client.user.tag}`);
	},
};
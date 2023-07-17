const { Events } = require('discord.js');
const { userRegistrationforTournament, Tournaments } = require('../controller/tournois');

module.exports = {
	name: Events.MessageCreate,
	async execute(message) {
		console.log(message)
		if (message) {
			
		}
		
	},
};
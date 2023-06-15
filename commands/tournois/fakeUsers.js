const { SlashCommandBuilder } = require('discord.js');
const { models } = require('./../../models');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fakeusers')
		.setDescription('Ajoute des faux participant (Test)')
		.addIntegerOption(option => option.setName('number').setDescription('nombre').setRequired(true)),
	async execute(interaction) {
		if (interaction.commandName === 'fakeusers') {
			const maxValue = interaction.options._hoistedOptions[0].value;
			for (let i = 0; maxValue > i ; i++) {
				await models.Participants.create({
					name: `Player ${i + 1}`,
					team_id: null,
				});
			}
			await interaction.reply('Faux participants créés, Nombre de participant: ' + maxValue);
		}

	},
};
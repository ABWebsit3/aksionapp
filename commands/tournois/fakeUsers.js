const { SlashCommandBuilder } = require('discord.js');
const { models } = require('./../../models');
const { addParticipant, showRegisteredUsers } = require('./../../controller/tournois.js')

module.exports = {
	data: new SlashCommandBuilder()
		.setName('fakeusers')
		.setDescription('Ajoute des faux participant (Test)')
    .addStringOption(option => {
        return option.setName('tournoi')
          .setDescription('The channel to echo into')
          .setRequired(true).setAutocomplete(true);
      })
    .addIntegerOption(option => option.setName('number').setDescription('nombre').setRequired(true)),
	async execute(interaction) {
		if (interaction.commandName === 'fakeusers') {
      const [tournamentId, numberOfUsers] = interaction.options._hoistedOptions;
			const maxValue = numberOfUsers.value;
			for (let i = 0; maxValue > i ; i++) {
        addParticipant('' , `Player ${i + 1}`, tournamentId.value)
			}
      showRegisteredUsers(interaction, tournamentId.value)
			await interaction.reply({ content: `Faux participants créés, Nombre de participant: ${maxValue}` , ephemeral: true });
		}

	},
  async autocomplete (interaction) {

    if (interaction.commandName === 'fakeusers') {
      console.log('Witch the tournament');
      const result = await models.Tournaments.findAll();
      const choices = result.map(r => { return { name: r.name, value: r.id.toString() }; });
      if (interaction.isAutocomplete()) {
        interaction.respond(choices)
          .catch(console.error);
      }
    }
  
  },

};


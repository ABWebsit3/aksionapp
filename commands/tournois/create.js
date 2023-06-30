const { SlashCommandBuilder, ModalBuilder, TextInputStyle, ActionRowBuilder, TextInputBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, EmbedBuilder, WebhookClient, ChannelType } = require('discord.js');
const { models } = require('./../../models');

const { Tournaments } = require('./../../controller/tournois');

const data = new SlashCommandBuilder()
  .setName('tournoi')
  .setDescription('Commandes "Tournoi"')
  .addSubcommand(subcommand =>
    subcommand.setName('create')
      .setDescription('Créer un tournoi'))
  .addSubcommand(subcommand =>
    subcommand
      .setName('delete')
      .setDescription('Supprime un tournoi')
      .addStringOption(option => {
        return option.setName('tournoi')
          .setDescription('The channel to echo into')
          .setRequired(true).setAutocomplete(true);
      }),
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('join')
      .setDescription('Rejoindre un tournois en cours')
      .addStringOption(option => {
        return option.setName('tournoi')
          .setDescription('The channel to echo into')
          .setRequired(true).setAutocomplete(true);
      }),
  );


const execute = async function(interaction) {
  if (interaction.options._subcommand === 'create') {
    console.log('Tournament created');

    // Chargement du modal pour la configuration du tournoi
    loadTournamentSettings(interaction);
    const filter = (_interaction) => _interaction.customId === 'tournamentSettings';
    interaction.awaitModalSubmit({ filter, time: 15_000 })
      .then(_interaction => initTournament(_interaction))
      .catch(console.error);

  }
  else if (interaction.options._subcommand === 'delete') {

    console.log('delete tournament');
    const tournamentId = interaction.options._hoistedOptions[0].value;
    const tournament = await models.Tournaments.findOne({ where: { id: tournamentId } });
    const tournamentChannels = JSON.parse(tournament.channels);
    console.log(tournamentChannels);
    tournamentChannels.map(async channel => {
      console.log(channel);
      await interaction.member.guild.channels.delete(channel.id, 'Delete tournaments channels');
    });
    Tournaments.stopTournament(tournamentId);
    await models.Tournaments.destroy({ where: { id: tournamentId } });

  }

  // interaction.user is the object representing the User who ran the command
  // interaction.member is the GuildMember object, which represents the user in the specific guild

};
const autocomplete = async function(interaction) {

  if (interaction.options._subcommand === 'delete') {
    console.log('Witch the tournament');
    const result = await models.Tournaments.findAll();
    const choices = result.map(r => { return { name: r.name, value: r.id.toString() }; });
    if (interaction.isAutocomplete()) {
      interaction.respond(choices)
        .catch(console.error);
    }
  }

};


/** ******************************************** */

const initTournament = async function(interaction) {

  if (interaction.customId === 'tournamentSettings') {
    await interaction.deferReply({ ephemeral: true });
    const tournamentName = interaction.fields.getTextInputValue('tournamentName');
    const tournamentTeamSize = interaction.fields.getTextInputValue('tournamentTeamsize')

    const result = await models.Tournaments.create({
      name: tournamentName,
      teamsSize: tournamentTeamSize,
    });

    const role = await interaction.member.guild.roles.create({ name: tournamentName });
    console.log(role);

    const groupChannel = await interaction.member.guild.channels.create({ type: ChannelType.GuildCategory, name: tournamentName });
    const registeredChannel = await interaction.member.guild.channels.create({ name: 'Participants', parent: groupChannel.id });
    const lobbyChannel = await interaction.member.guild.channels.create({ name: 'Lobby', reason: 'Lobby for players', parent: groupChannel.id });
    const signChannel = await interaction.member.guild.channels.create({ name: 'Inscription', reason: 'Inscription des joueurs', parent: groupChannel.id });

    const scoreChannel = await interaction.member.guild.channels.create({
      name: 'Score',
      reason: 'Lobby for players',
      parent: groupChannel.id,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: role.id,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    scoreChannel.createWebhook({
      name: 'Some-username',
      avatar: 'https://i.imgur.com/AfFp7pu.png',
    })
      .then(webhook => console.log(`Created webhook ${webhook}`))
      .catch(console.error);

    const adminChannel = await interaction.member.guild.channels.create({ name: 'Administration', reason: 'Lobby for players', parent: groupChannel.id });

    const channelGroup = [
      {
        name: 'lobbyChannel',
        id: lobbyChannel.id,
      },
      {
        name: 'registeredChannel',
        id: registeredChannel.id,
      },
      {
        name: 'signChannel',
        id: signChannel.id,
      },
      {
        name: 'scoreChannel',
        id: scoreChannel.id,
      },
      {
        name: 'adminChannel',
        id: adminChannel.id,
      },
      {
        name: 'groupChannel',
        id: groupChannel.id,
      },

    ];

    const buttonContent = `Inscription au tournoi "${tournamentName}"`
    registerButtons(interaction, signChannel, buttonContent, result.id)

    const shuffleButtonContent = `Cliquez pour mélanger les joueurs et créer les équipes`
    shuffleButton(interaction, adminChannel, shuffleButtonContent, result.id)

    await models.Tournaments.update({
      guildId: groupChannel.guildId,
      channels: JSON.stringify(channelGroup),
    }, {
      where: {
        id: result.id,
      },
    });
    await interaction.editReply({ content: 'Tournoi créé', ephemeral: true });
  }

};


module.exports = {
  data: data,
  execute,
  autocomplete,
};


async function loadTournamentSettings(interaction) {

  const tournamentSettingsModal = new ModalBuilder()
    .setCustomId('tournamentSettings')
    .setTitle('Paramètres du tournoi');
  // Add components to modal
  // Create the text input components
  const tournamentName = new TextInputBuilder()
    .setCustomId('tournamentName')
    .setLabel('Nom du tournoi')
    .setValue('Nouveau tournoi')
    .setStyle(TextInputStyle.Short);

  const tournamentTeamsize = new TextInputBuilder()
    .setCustomId('tournamentTeamsize')
    .setLabel('Taille des équipes')
    .setValue('5')
    .setStyle(TextInputStyle.Short);

  // An action row only holds one text input,
  // so you need one action row per text input.
  const firstActionRow = new ActionRowBuilder().addComponents(tournamentName);
  const secondActionRow = new ActionRowBuilder().addComponents(tournamentTeamsize);

  // Add inputs to the modal
  tournamentSettingsModal.addComponents(firstActionRow, secondActionRow);
  await interaction.showModal(tournamentSettingsModal);
}

async function registerButtons(interaction, signChannel, content, tournament_id, ...buttons) {
  const signChannelObject = interaction.client.channels.cache.get(signChannel.id);

  const confirmInscriptionButton = new ButtonBuilder()
    .setCustomId('inscription_confirm_' + tournament_id)
    .setLabel('✅')
    .setStyle(ButtonStyle.Success);

  const cancelInscriptionButton = new ButtonBuilder()
    .setCustomId('inscription_cancel_' + tournament_id)
    .setLabel('Annuler')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(true);

  const row = new ActionRowBuilder()
    .addComponents([confirmInscriptionButton, cancelInscriptionButton]);

  const messageInscription = await signChannelObject.send({
    content: content,
    components: [row],
  });
}

async function shuffleButton(interaction, adminChannel, content, tournament_id, ...buttons) {
  const adminChannelObject = interaction.client.channels.cache.get(adminChannel.id);

  const shuffleButton = new ButtonBuilder()
    .setCustomId('shuffle_teams_' + tournament_id)
    .setLabel('♻')
    .setStyle(ButtonStyle.Success);

  const startTournamentButton = new ButtonBuilder()
    .setCustomId('start_' + tournament_id)
    .setLabel('Go !')
    .setStyle(ButtonStyle.Success);


  const row = new ActionRowBuilder()
    .addComponents([shuffleButton, startTournamentButton]);

  const messageInscription = await adminChannelObject.send({
    content: content,
    components: [row],
  });
}


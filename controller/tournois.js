const { JsonDatabase } = require('brackets-json-db');
const { BracketsManager } = require('brackets-manager');
const { EmbedBuilder } = require('discord.js');
const { models } = require('../models');

const fs = require('fs');

const storage = new JsonDatabase();
const manager = new BracketsManager(storage);

// Create an elimination stage for tournament `3`.


async function updateTournament() {
  await manager.update.match({
    id: 0, // First match of winner bracket (round 1)
    opponent1: { score: 16, result: 'win' },
    opponent2: { score: 12 },
  });
}

async function addParticipant(user_id, name, tournament) {
  await models.Participants.create({ user_id: user_id, name: name, tournamentId: parseInt(tournament) })
}

async function removeParticipant(user_id, tournament) {
  await models.Participants.destroy({ where: { user_id: user_id } })
}

async function userRegistrationforTournament(interaction) {
  const command = interaction.customId.replace('inscription_', '');
  if (command.startsWith('confirm_')) {
    const tournament_id = command.replace('confirm_', '');
    addParticipant(interaction.user.id, interaction.user.username, tournament_id).then(
      showRegisteredUsers(interaction, tournament_id)
    );

    await interaction.reply({ content: `Joueur ${interaction.user.username} : Enregistré`, ephemeral: true });
  } else if (command.startsWith('cancel_')) {
    const tournament_id = command.replace('cancel_', '');
    removeParticipant(interaction.user.id, tournament_id);
    await interaction.reply({ content: `Joueur ${interaction.user.username} : inscription annulé`, ephemeral: true });
  }
}

async function showRegisteredUsers(interaction, tournament_id) {

  const Tournament = await models.Tournaments.findOne({ where: { id: tournament_id } });
  let Channels = JSON.parse(Tournament.channels)
  let registeredChannel = Channels.filter(data => data.name === 'registeredChannel')[0];
  let categoryChannel = Channels.filter(data => data.name === 'groupChannel');

  const participants = await models.Participants.findAll({ where: { tournamentId: tournament_id } })
  console.log(participants)

  const registeredChannelObject = interaction.client.channels.cache.get(registeredChannel.id);

  const messages = await registeredChannelObject.messages.fetch()
  registeredChannelObject.bulkDelete(messages)

  const ParticipantsEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle('Liste des participants')

  participants.map(data => ParticipantsEmbed.addFields({ name: data.dataValues.name, value: data.dataValues.name, inline: true }))

  //Charger la liste des participants pour afficher/Mettre à jour
  const messageInscription = await registeredChannelObject.send({ embeds: [ParticipantsEmbed] });

}



const Tournaments = {

  randomizeTeams: async function(interaction) {
    const tournament_id = interaction.customId.replace('shuffle_teams_', '');

    const tournament = await models.Participants.findOne({ where: { tournamentId: tournament_id } })[0]
    const participants = await models.Participants.findAll({ where: { tournamentId: tournament_id } })
    if (participants.length % tournament.teamSize) { // 5 = teamSize
      console.log(`Il reste : ${participants.length % 5}`)
    } else {
      console.log('Good')
      const shuffledParticipants = participants.map(value => ({ value: value.dataValues.name, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value)


      for (let i = 0; i < shuffledParticipants.length; i += 5) {// 5 = teamSize
        const teamData = shuffledParticipants.slice(i, i + 5);// 5 = teamSize
        const team = await models.Teams.create({
          name: `Équipe ${i + 1}`,
          tournamentId: tournament_id
        })
        teamData.forEach(async player => {

          await models.Participants.update({
            teamId: team.id,
          }, {
            where: {
              name: player,
            },
          });
        })

      }
      console.log(interaction)
      await interaction.reply({ content: 'Équipes créées, Mise à jour du tableau des participants', ephemeral: true });
    }
  },
  startTournament: async function(interaction) {
    const tournament_id = interaction.customId.replace('start_', '');
    const Tournament = await models.Tournaments.findOne({ where: { id: tournament_id } })
    const Channels = JSON.parse(Tournament.channels)
    const scoreChannel = Channels.filter(data => data.name === 'scoreChannel')[0];
    const scoreChannelObject = interaction.client.channels.cache.get(scoreChannel.id);

    const webhooks = await scoreChannelObject.fetchWebhooks();
    console.log(webhooks)
    const teams = await models.Teams.findAll({
      where: {
        tournamentId: tournament_id
      }
    })
    // console.log(teams.map(team => team.name))
    /*await manager.create({
      tournamentId: 20,
      name: 'Elimination stage',
      type: 'single_elimination',
      seeding: teams.map(team => team.name),
      settings: { consolationFinal: true },
    });*/
    const bracket = await manager.get.tournamentData(tournament_id)
    const currentStage = await manager.get.currentStage(tournament_id);
    const currentRound = await manager.get.currentRound(currentStage.id);

    const rawData = fs.readFileSync('db.json');
    const managerDB = JSON.parse(rawData);
    const current_match = managerDB.match.filter(match => match.round_id == currentRound.id)

    current_match.forEach(async match => {
      const opponent1 = bracket.participant.filter(participant => participant.id == match.opponent1.id)
      const opponent2 = bracket.participant.filter(participant => participant.id == match.opponent2.id)
      const thread = await scoreChannelObject.threads.create({
        name: `${opponent1[0].name} vs ${opponent2[0].name}`,
        autoArchiveDuration: 60,
        reason: 'Needed a separate thread for food',
      });
      if (thread.joinable) await thread.join();
      //console.log(thread);
    })
    //console.log(current_match)
  },
  stopTournament: async function(interaction, tournamentId) {
    await manager.delete.tournament(tournamentId)
  }
}


module.exports = { userRegistrationforTournament, showRegisteredUsers, addParticipant, Tournaments }
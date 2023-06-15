import {
    InteractionType,
    InteractionResponseType,
    InteractionResponseFlags,
    MessageComponentTypes,
    ButtonStyleTypes,
  } from 'discord-interactions';

import { DiscordRequest, BotAnswer } from './utils.js';  
  
export async function InitTournament(res, guild_id){
      
      const globalEndpoint = `guilds/${guild_id}/channels`;
      
      const channelGroupParams = {
          name : 'Nouveau tournoi',
          type : 4,
          position: 999
      }
      const channelParams = [{
          name : 'Lobby',
          type : 0,
          position : 0
      },{
          name : 'Participants / Équipe',
          type : 0,
          position : 1
      },{
          name : 'Score',
          type : 0,
          position : 2
      },{
          name : 'Administration',
          type : 0,
          position : 3
      }]
  
      try {
          
          // Send HTTP request with bot token
          const result = await DiscordRequest(globalEndpoint, {
            method: 'POST',
            body: channelGroupParams,
          });
          let groupResult = await result.json()
          channelParams.map( async params => {
              params.parent_id = groupResult.id;
              const channelsResult = await DiscordRequest(globalEndpoint, {
                  method: 'POST',
                  body: params,
              });
  
              let channel = await channelsResult.json()
              
              
              if(params.name == 'Administration'){
                  createAdministrationMessage(channel.id)
              }else if(params.name == 'Participants / Équipe'){
                  createUsersTeamsMessage(channel.id)
              }
             
          }) 
          
          const message = [
              {
                  title: `Bravo ! Le tournoi est créé`,
                  description: `Tu peux te rendre dans la section administration pour gérer le tournoi
                  Lorsque tu seras prêt, tu peux lancer le check-in pourque les joueurs puissent s'inscrire`,
              }
          ]
  
          BotAnswer(res, message)
          
        } catch (err) {
          console.error('Error installing commands: ', err);
        }
}
  

export async function createAdministrationMessage(channel_id){
    const messageEndpoint = `/channels/${channel_id}/messages`;
    const message = await DiscordRequest(messageEndpoint, {
        method: 'POST',
        body: {
            content : `
                Ceci est un est avec 
                plusieur ligne de code 
                et des retour à la ligne 
                `,
            components:[{
                type : 1,
                components:[   
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 2,
                        label : 'Démarrer le check-in',
                        custom_id: "check_in-button"
                    },
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 1,
                        label : 'Démarrer le Tournoi',
                        disabled: true,
                        custom_id: "start-button"
                    },
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 3,
                        label : 'Ajouter un score',
                        disabled: true,
                        custom_id: "score-button"
                    },
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 4,
                        label : 'Supprimer le tournoi',
                        custom_id: "delete-button"
                        //emoji : '🗑️'
                    },
                ] 
            }]
        },
    });
}

export async function createUsersTeamsMessage(channel_id){
    const messageEndpoint = `/channels/${channel_id}/messages`;
    const message = await DiscordRequest(messageEndpoint, {
        method: 'POST',
        body: {
            content : `
                Cliquez sur le bouton "s'inscrire" pour participer au tournoi
                `,
            components:[{
                type : 1,
                components:[   
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 3,
                        label : 'S\'inscrire',
                        custom_id: "participate-register"
                    },
                    {
                        type : MessageComponentTypes.BUTTON,
                        style : 4,
                        label : 'Se désinscrire',
                        disabled: true,
                        custom_id: "participate-unregister"
                    },
                ] 
            }]
        },
    });
}

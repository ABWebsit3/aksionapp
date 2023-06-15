import { DiscordRequest, BotAnswer } from './utils.js';
import {createUsersTeamsMessage, createAdministrationMessage} from './controller/tournois.js'


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

/*export async function getChannelList(appId, guild_id){
    const globalEndpoint = `guilds/${guild_id}/channels`;
    try {
        // Send HTTP request with bot token
        
        const res = await DiscordRequest(globalEndpoint, {
          method: 'GET',
        });
        let result = await res.json()
        console.log(result)
        return result
        
      } catch (err) {
        console.error('Error installing commands: ', err);
      }
}*/
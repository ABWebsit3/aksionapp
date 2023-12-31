import 'dotenv/config';
import express from 'express';
import { InteractionType, InteractionResponseType } from 'discord-interactions';
import { VerifyDiscordRequest, DiscordRequest, ResetGlobalCommands } from './utils.js';

// Create and configure express app
const app = express();
app.use(express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) }));

app.post('/interactions', function (req, res) {
  // Interaction type and data
  const { type, data } = req.body;
  /**
   * Handle slash command requests
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    // Slash command with name of "test"
    if (data.name === 'test') {
      // Send a message as response
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'A wild message appeared' },
      });
    }
    if (data.name === 'create') {
      // Send a message as response
      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: 'A wild message appeared' },
      });
    }
  }
});

async function createCommand() {
  const appId = process.env.APP_ID;
  await ResetGlobalCommands(appId)
  /**
   * Globally-scoped slash commands (generally only recommended for production)
   * See https://discord.com/developers/docs/interactions/application-commands#create-global-application-command
   */
  const globalEndpoint = `applications/${appId}/commands`;

  /**
   * Guild-scoped slash commands
   * See https://discord.com/developers/docs/interactions/application-commands#create-guild-application-command
   */
  // const guildEndpoint = `applications/${appId}/guilds/<your guild id>/commands`;
  const commandBody = {
    name: 'tournoi',
    description: 'Options pour tournois',
    // chat command (see https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-types)
    type: 1,
    options: [
      {
        "name": "créer",
        "description": "Créer un tournoi",
        "type": 1, // 2 is type SUB_COMMAND_GROUP
      },
      {
        "name": "fake",
        "description": "Ajoute des faux participants (Test)",
        "type": 4, // 2 is type SUB_COMMAND_GROUP
      }
    ]
    
  };

  try {
    // Send HTTP request with bot token
    const res = await DiscordRequest(globalEndpoint, {
      method: 'POST',
      body: commandBody,
    });
    console.log(await res.json());
  } catch (err) {
    console.error('Error installing commands: ', err);
  }
}

app.listen(3000, () => {
  console.log('Listening on port 3000');

  createCommand();
});

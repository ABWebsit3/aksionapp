const Sequelize = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB, process.env.DB_USER, process.env.DB_PASS, {
  host: process.env.DB_HOST,
  dialect: 'mysql',
  port: '3306',
  logging: false,
  // SQLite only
  storage: 'database.sqlite',
});

const Tournaments = sequelize.define('tournaments', {
  name: {
    type: Sequelize.STRING,
    defaultValue: 'Nouveau tournoi',
  },
  size: {
    type: Sequelize.INTEGER,
    defaultValue: 4,
  },
  teamsSize: {
    type: Sequelize.INTEGER,
    defaultValue: 5,
  },
  status: {
    type: Sequelize.STRING,
    defaultValue: 'waiting',
  },
  guildId: {
    type: Sequelize.INTEGER,
  },
  channels: {
    type: Sequelize.TEXT,
  },
  settings: {
    type: Sequelize.TEXT,
  },
  roleId: {
    type: Sequelize.BIGINT,
  }
});

const Teams = sequelize.define('teams', {
  name: {
    type: Sequelize.STRING,
  },
  team_id: {
    type: Sequelize.INTEGER,
  },
});

const Participants = sequelize.define('participant', {
  name: {
    type: Sequelize.STRING,
  },
  user_id: {
    type: Sequelize.BIGINT,
  }
});

Tournaments.hasMany(Teams, { onDelete: 'CASCADE' });
Tournaments.hasMany(Participants, { onDelete: 'CASCADE' });
Teams.hasMany(Participants);
Participants.hasOne(Teams);

const models = {
  Tournaments,
  Participants,
  Teams,
};

async function init() {
  await sequelize.sync({ alter: true });
  console.log('All models were synchronized successfully.');
}



module.exports = { init, models };
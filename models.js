const Sequelize = require('sequelize');
require('dotenv').config();

// MySQL si DB_HOST est défini, sinon SQLite local (pratique en développement)
const dialect = process.env.DB_DIALECT || (process.env.DB_HOST ? 'mysql' : 'sqlite');
const sequelize = dialect === 'sqlite'
	? new Sequelize({ dialect: 'sqlite', storage: process.env.DB_STORAGE || 'database.sqlite', logging: false })
	: new Sequelize(process.env.DB, process.env.DB_USER, process.env.DB_PASS, {
		host: process.env.DB_HOST,
		dialect,
		port: process.env.DB_PORT || '3306',
		logging: false,
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
	},
});

const Teams = sequelize.define('teams', {
	name: {
		type: Sequelize.STRING,
	},
	teamStatus: {
		type: Sequelize.STRING,
		defaultValues: 'unlock',
	},
});

const Participants = sequelize.define('participant', {
	name: {
		type: Sequelize.STRING,
	},
	user_id: {
		type: Sequelize.BIGINT,
	},
	checkin: {
		type: Sequelize.BOOLEAN,
	},
});

const Guilds = sequelize.define('guilds', {
	name:{
		type: Sequelize.STRING,
	},
	guild_id:{
		type: Sequelize.BIGINT,
	},
});

/* ---------- Hub de match ---------- */
// Les identifiants Discord (snowflakes) dépassent Number.MAX_SAFE_INTEGER : on les stocke en STRING

const MatchTeams = sequelize.define('match_teams', {
	name: { type: Sequelize.STRING, allowNull: false },
	game: { type: Sequelize.STRING, allowNull: false },
	size: { type: Sequelize.INTEGER, allowNull: false },
	captainId: { type: Sequelize.STRING, allowNull: false },
	guildId: { type: Sequelize.STRING },
	// [{ id, name }]
	members: { type: Sequelize.TEXT, allowNull: false, defaultValue: '[]' },
});

const QueueEntries = sequelize.define('queue_entries', {
	teamId: { type: Sequelize.INTEGER, allowNull: false, unique: true },
	game: { type: Sequelize.STRING, allowNull: false },
	size: { type: Sequelize.INTEGER, allowNull: false },
	format: { type: Sequelize.STRING, allowNull: false },
	type: { type: Sequelize.STRING, allowNull: false },
	level: { type: Sequelize.INTEGER, allowNull: false },
	tolerance: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
	channelId: { type: Sequelize.STRING },
	guildId: { type: Sequelize.STRING },
	requestedBy: { type: Sequelize.STRING },
	expiresAt: { type: Sequelize.DATE, allowNull: false },
});

const Matches = sequelize.define('matches', {
	id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
	game: { type: Sequelize.STRING, allowNull: false },
	status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'checkin' },
	// État complet du match (équipes, check-in, veto, résultat) en JSON
	data: { type: dialect === 'sqlite' ? Sequelize.TEXT : Sequelize.TEXT('long'), allowNull: false },
});

Guilds.hasMany(Tournaments, { onDelete: 'CASCADE' });
Tournaments.belongsTo(Guilds);
Tournaments.hasMany(Teams, { onDelete: 'CASCADE' });
Tournaments.hasMany(Participants, { onDelete: 'CASCADE' });
Teams.hasMany(Participants);
Participants.belongsTo(Teams);

const models = {
	Tournaments,
	Participants,
	Teams,
	Guilds,
	MatchTeams,
	QueueEntries,
	Matches,
};

async function init() {
	await sequelize.sync({ alter: true });
	console.log('All models were synchronized successfully.');
}


module.exports = { init, models, sequelize };
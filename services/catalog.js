const fs = require('node:fs');
const path = require('node:path');
const { getGame } = require('../config/games');

/**
 * Catalogue des éléments de pick & ban (cartes, champions, héros) et de leurs visuels.
 *
 * Sources (mises à jour par `npm run catalog`, et au démarrage si le cache a plus de 3 jours) :
 *  - LoL      : Data Dragon, la CDN officielle de Riot pour les développeurs
 *  - Dota 2   : API OpenDota (constantes héros), images servies par la CDN Steam
 *  - Valorant : valorant-api.com (API communautaire, non officielle) pour les visuels des cartes
 *  - CS2      : github.com/MurkyYT/cs2-map-icons (visuels extraits des fichiers du jeu)
 * Les images de cartes sont téléchargées et réduites dans web/public/img/maps/ (voir scripts/sync-catalog.js).
 * Les visuels restent la propriété de Riot Games et de Valve.
 */

const CATALOG_DIR = path.join(__dirname, '..', 'config', 'catalog');
const MAP_IMG_DIR = path.join(__dirname, '..', 'web', 'public', 'img', 'maps');
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

const LOL_TAGS = { Assassin: 'Assassin', Fighter: 'Combattant', Mage: 'Mage', Marksman: 'Tireur', Support: 'Support', Tank: 'Tank' };
const DOTA_ATTRS = { str: 'Force', agi: 'Agilité', int: 'Intelligence', all: 'Universel' };
const FILTER_ORDER = {
	lol: ['Top', 'Jungle', 'Mid', 'ADC', 'Support', 'Assassin', 'Combattant', 'Mage', 'Tireur', 'Tank'],
	dota2: ['Force', 'Agilité', 'Intelligence', 'Universel'],
};

// Échantillon du prototype, utilisé uniquement si le catalogue LoL n'a jamais pu être téléchargé
const C = (name, role) => ({ id: name.toLowerCase().replace(/[^a-z]/g, ''), name, role, img: null });
const FALLBACK = {
	lol: [C('Aatrox', 'Top'), C('Gnar', 'Top'), C('Jax', 'Top'), C('Jayce', 'Top'), C('K\'Sante', 'Top'), C('Renekton', 'Top'), C('Rumble', 'Top'),
		C('Lee Sin', 'Jungle'), C('Maokai', 'Jungle'), C('Sejuani', 'Jungle'), C('Taliyah', 'Jungle'), C('Vi', 'Jungle'), C('Viego', 'Jungle'), C('Gragas', 'Jungle'),
		C('Ahri', 'Mid'), C('Akali', 'Mid'), C('Azir', 'Mid'), C('Corki', 'Mid'), C('Orianna', 'Mid'), C('Syndra', 'Mid'), C('Yone', 'Mid'),
		C('Ashe', 'ADC'), C('Caitlyn', 'ADC'), C('Ezreal', 'ADC'), C('Jinx', 'ADC'), C('Kai\'Sa', 'ADC'), C('Varus', 'ADC'), C('Xayah', 'ADC'), C('Zeri', 'ADC'),
		C('Alistar', 'Support'), C('Braum', 'Support'), C('Leona', 'Support'), C('Lulu', 'Support'), C('Nautilus', 'Support'), C('Rakan', 'Support'), C('Rell', 'Support')],
	dota2: [],
};

/* ---------- transformations des sources (pures, testables) ---------- */

function lolFromDataDragon(version, championJson) {
	const items = Object.values(championJson.data).map(ch => ({
		id: ch.id.toLowerCase(),
		name: ch.name,
		role: LOL_TAGS[ch.tags[0]] || ch.tags[0] || 'Autre',
		img: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${ch.image.full}`,
	}));
	return { source: 'Riot Data Dragon', version, items: sortByName(items) };
}

function dotaFromOpenDota(heroes) {
	const items = Object.values(heroes).map(h => ({
		id: h.name.replace('npc_dota_hero_', ''),
		name: h.localized_name,
		role: DOTA_ATTRS[h.primary_attr] || 'Universel',
		img: h.img ? `https://cdn.cloudflare.steamstatic.com${h.img.replace(/\?$/, '')}` : null,
	}));
	return { source: 'OpenDota', items: sortByName(items) };
}

function sortByName(items) {
	return items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/* ---------- lecture ---------- */

const memory = {};

function catalogFile(gameId) {
	return path.join(CATALOG_DIR, `${gameId}.json`);
}

function readCatalog(gameId) {
	if (memory[gameId]) return memory[gameId];
	try {
		memory[gameId] = JSON.parse(fs.readFileSync(catalogFile(gameId), 'utf8'));
	}
	catch {
		memory[gameId] = null;
	}
	return memory[gameId];
}

function writeCatalog(gameId, catalog) {
	fs.mkdirSync(CATALOG_DIR, { recursive: true });
	const data = { ...catalog, updatedAt: new Date().toISOString() };
	fs.writeFileSync(catalogFile(gameId), JSON.stringify(data, null, '\t') + '\n');
	memory[gameId] = data;
	return data;
}

function mapImage(gameId, mapId) {
	const file = path.join(MAP_IMG_DIR, gameId, `${mapId}.jpg`);
	return fs.existsSync(file) ? `/static/img/maps/${gameId}/${mapId}.jpg` : null;
}

function filtersOf(gameId, items) {
	const roles = [...new Set(items.map(i => i.role))];
	const order = FILTER_ORDER[gameId] || [];
	return ['Tous', ...roles.sort((a, b) => order.indexOf(a) - order.indexOf(b))];
}

/** Catalogue prêt à afficher : { kind, items: [{ id, name, role?, img, hue? }], filters, source } */
function getCatalog(gameId) {
	const game = getGame(gameId);
	if (game.veto === 'maps') {
		return {
			kind: 'maps',
			items: game.maps.map(m => ({ id: m.id, name: m.name, hue: m.hue, img: mapImage(gameId, m.id) })),
			filters: [],
		};
	}
	if (game.veto === 'draft') {
		const stored = readCatalog(gameId);
		const items = stored && stored.items.length ? stored.items : FALLBACK[gameId];
		return {
			kind: 'draft',
			items,
			filters: filtersOf(gameId, items),
			source: stored ? stored.source : 'Échantillon hors ligne',
			updatedAt: stored ? stored.updatedAt : null,
		};
	}
	return { kind: 'sides', items: [], filters: [] };
}

function poolIds(gameId) {
	return getCatalog(gameId).items.map(i => i.id);
}

/* ---------- mise à jour depuis les sources ---------- */

async function getJson(url, fetchImpl) {
	const res = await fetchImpl(url);
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	return res.json();
}

async function refreshLol(fetchImpl = fetch) {
	const [version] = await getJson('https://ddragon.leagueoflegends.com/api/versions.json', fetchImpl);
	const champions = await getJson(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`, fetchImpl);
	return writeCatalog('lol', lolFromDataDragon(version, champions));
}

async function refreshDota(fetchImpl = fetch) {
	const heroes = await getJson('https://api.opendota.com/api/constants/heroes', fetchImpl);
	return writeCatalog('dota2', dotaFromOpenDota(heroes));
}

/** Rafraîchit les catalogues LoL / Dota trop anciens, sans bloquer le démarrage. */
async function refreshStale(fetchImpl = fetch) {
	const jobs = { lol: refreshLol, dota2: refreshDota };
	for (const [gameId, job] of Object.entries(jobs)) {
		const stored = readCatalog(gameId);
		if (stored && Date.now() - new Date(stored.updatedAt).getTime() < STALE_MS) continue;
		try {
			const data = await job(fetchImpl);
			console.log(`Catalogue ${gameId} mis à jour : ${data.items.length} éléments (${data.source})`);
		}
		catch (error) {
			console.warn(`Catalogue ${gameId} non mis à jour (${error.message}), utilisation du cache.`);
		}
	}
}

module.exports = {
	getCatalog,
	poolIds,
	refreshLol,
	refreshDota,
	refreshStale,
	lolFromDataDragon,
	dotaFromOpenDota,
	writeCatalog,
	MAP_IMG_DIR,
};

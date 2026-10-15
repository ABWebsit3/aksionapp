/**
 * Met à jour le catalogue de pick & ban : `npm run catalog`
 *  - config/catalog/lol.json, config/catalog/dota2.json (listes complètes + URL des visuels)
 *  - web/public/img/maps/<jeu>/<carte>.jpg (visuels de cartes téléchargés puis réduits en 640×360)
 *
 * Options : --only=lol,dota2,valorant,cs2   --dota-file=<heroes.json local>
 * Chaque source est indépendante : l'échec de l'une n'empêche pas les autres.
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { GAMES } = require('../config/games');
const { refreshLol, refreshDota, writeCatalog, dotaFromOpenDota, MAP_IMG_DIR } = require('../services/catalog');

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const only = args.only ? args.only.split(',') : ['lol', 'dota2', 'valorant', 'cs2'];

async function getJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	return res.json();
}

async function saveMapImage(gameId, mapId, url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	const input = Buffer.from(await res.arrayBuffer());
	const dir = path.join(MAP_IMG_DIR, gameId);
	fs.mkdirSync(dir, { recursive: true });
	await sharp(input).resize(640, 360, { fit: 'cover' }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(dir, `${mapId}.jpg`));
}

async function syncValorantMaps() {
	const { data } = await getJson('https://valorant-api.com/v1/maps');
	const byName = new Map(data.map(m => [m.displayName.toLowerCase(), m]));
	const missing = [];
	for (const m of GAMES.valorant.maps) {
		const entry = byName.get(m.name.toLowerCase());
		if (!entry || !entry.splash) {
			missing.push(m.name);
			continue;
		}
		await saveMapImage('valorant', m.id, entry.splash);
	}
	return { count: GAMES.valorant.maps.length - missing.length, missing };
}

async function syncCs2Maps() {
	const { maps } = await getJson('https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json');
	const missing = [];
	for (const m of GAMES.cs2.maps) {
		const entry = maps[m.file];
		const thumbs = (entry && entry.thumb_paths) || [];
		const url = thumbs.find(t => t.endsWith(`/${m.file}_png.png`)) || thumbs[0];
		if (!url) {
			missing.push(m.name);
			continue;
		}
		await saveMapImage('cs2', m.id, url);
	}
	return { count: GAMES.cs2.maps.length - missing.length, missing };
}

const jobs = {
	lol: async () => ({ count: (await refreshLol()).items.length }),
	dota2: async () => {
		const data = args['dota-file']
			? writeCatalog('dota2', dotaFromOpenDota(JSON.parse(fs.readFileSync(args['dota-file'], 'utf8'))))
			: await refreshDota();
		return { count: data.items.length };
	},
	valorant: syncValorantMaps,
	cs2: syncCs2Maps,
};

(async () => {
	let failed = 0;
	for (const name of only) {
		try {
			const result = await jobs[name]();
			const warn = result.missing && result.missing.length ? ` (introuvables : ${result.missing.join(', ')})` : '';
			console.log(`✔ ${name} : ${result.count} élément(s)${warn}`);
		}
		catch (error) {
			failed++;
			console.error(`✘ ${name} : ${error.message}`);
		}
	}
	process.exit(failed ? 1 : 0);
})();

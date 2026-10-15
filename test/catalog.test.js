const test = require('node:test');
const assert = require('node:assert');
const { lolFromDataDragon, dotaFromOpenDota, getCatalog, poolIds } = require('../services/catalog');

test('Data Dragon : id en minuscules, rôle traduit, URL de l\'image versionnée', () => {
	const data = { data: { MonkeyKing: { id: 'MonkeyKing', name: 'Wukong', tags: ['Fighter', 'Tank'], image: { full: 'MonkeyKing.png' } } } };
	const { items, version } = lolFromDataDragon('16.20.1', data);
	assert.strictEqual(version, '16.20.1');
	assert.deepStrictEqual(items[0], { id: 'monkeyking', name: 'Wukong', role: 'Combattant', img: 'https://ddragon.leagueoflegends.com/cdn/16.20.1/img/champion/MonkeyKing.png' });
});

test('OpenDota : id sans préfixe, attribut traduit, image sur la CDN Steam', () => {
	const heroes = { 1: { name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage', primary_attr: 'agi', img: '/apps/dota2/images/dota_react/heroes/antimage.png?' } };
	assert.deepStrictEqual(dotaFromOpenDota(heroes).items[0], {
		id: 'antimage', name: 'Anti-Mage', role: 'Agilité', img: 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/antimage.png',
	});
});

test('catalogue Dota 2 complet et cartes CS2 avec visuels locaux', () => {
	const dota = getCatalog('dota2');
	assert.ok(dota.items.length >= 120, `seulement ${dota.items.length} héros`);
	assert.deepStrictEqual(dota.filters, ['Tous', 'Force', 'Agilité', 'Intelligence', 'Universel']);
	assert.strictEqual(new Set(poolIds('dota2')).size, dota.items.length);
	const cs2 = getCatalog('cs2');
	assert.ok(cs2.items.every(m => m.img && m.img.startsWith('/static/img/maps/cs2/')));
});

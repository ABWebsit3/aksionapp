/**
 * PraccHub — Pick & Ban core
 * Logique pure, sans DOM : configuration des jeux, séquences de veto/draft,
 * et machine à états. Utilisable dans le navigateur (window.PickBan) et sous
 * Node (module.exports) — à réutiliser côté serveur pour valider les actions.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- config
  const M = (name, hue) => ({ id: name.toLowerCase(), name, hue });
  const C = (name, role) => ({ id: name.toLowerCase().replace(/[^a-z]/g, ''), name, role });
  const r = (t, s) => s.split('').map((team) => ({ t, team }));

  /**
   * Pools : À FAIRE VIVRE CÔTÉ SERVEUR (les rotations changent à chaque act/patch).
   * Valorant : pool d'après ProSettings (maj 30/09/2026) — d'autres sources divergent, à confirmer.
   * CS2 : Active Duty après le retour de Cache (juin 2026).
   */
  const GAMES = {
    valorant: {
      key: 'VAL', label: 'Valorant', kind: 'maps',
      sides: [['Attaque', 'Pose le spike'], ['Défense', 'Protège les sites']],
      pool: [M('Abyss', 255), M('Ascent', 30), M('Haven', 140), M('Lotus', 320), M('Split', 200), M('Summit', 180), M('Sunset', 15)]
    },
    cs2: {
      key: 'CS2', label: 'CS2', kind: 'maps',
      sides: [['CT', 'Anti-terroristes'], ['T', 'Terroristes']],
      pool: [M('Ancient', 150), M('Anubis', 40), M('Cache', 95), M('Dust2', 35), M('Inferno', 10), M('Mirage', 50), M('Nuke', 210)]
    },
    lol: {
      key: 'LOL', label: 'League of Legends', kind: 'draft', noun: 'un champion', nounPl: 'Champions',
      filters: ['Tous', 'Top', 'Jungle', 'Mid', 'ADC', 'Support'],
      // Échantillon de démo : en prod, charger la liste complète (ex. Data Dragon de Riot).
      pool: [C('Aatrox', 'Top'), C('Gnar', 'Top'), C('Jax', 'Top'), C('Jayce', 'Top'), C("K'Sante", 'Top'), C('Renekton', 'Top'), C('Rumble', 'Top'),
        C('Lee Sin', 'Jungle'), C('Maokai', 'Jungle'), C('Sejuani', 'Jungle'), C('Taliyah', 'Jungle'), C('Vi', 'Jungle'), C('Viego', 'Jungle'), C('Gragas', 'Jungle'),
        C('Ahri', 'Mid'), C('Akali', 'Mid'), C('Azir', 'Mid'), C('Corki', 'Mid'), C('Orianna', 'Mid'), C('Syndra', 'Mid'), C('Yone', 'Mid'),
        C('Ashe', 'ADC'), C('Caitlyn', 'ADC'), C('Ezreal', 'ADC'), C('Jinx', 'ADC'), C("Kai'Sa", 'ADC'), C('Varus', 'ADC'), C('Xayah', 'ADC'), C('Zeri', 'ADC'),
        C('Alistar', 'Support'), C('Braum', 'Support'), C('Leona', 'Support'), C('Lulu', 'Support'), C('Nautilus', 'Support'), C('Rakan', 'Support'), C('Rell', 'Support')]
    },
    dota: {
      key: 'DOTA', label: 'Dota 2', kind: 'draft', noun: 'un héros', nounPl: 'Héros',
      filters: ['Tous', 'Force', 'Agilité', 'Intelligence', 'Universel'],
      // Échantillon de démo : en prod, charger la liste complète (ex. API OpenDota).
      pool: [C('Axe', 'Force'), C('Earthshaker', 'Force'), C('Legion Commander', 'Force'), C('Mars', 'Force'), C('Pudge', 'Force'), C('Sven', 'Force'), C('Tidehunter', 'Force'), C('Tiny', 'Force'),
        C('Anti-Mage', 'Agilité'), C('Ember Spirit', 'Agilité'), C('Faceless Void', 'Agilité'), C('Juggernaut', 'Agilité'), C('Morphling', 'Agilité'), C('Phantom Assassin', 'Agilité'), C('Slark', 'Agilité'), C('Spectre', 'Agilité'), C('Terrorblade', 'Agilité'),
        C('Crystal Maiden', 'Intelligence'), C('Lina', 'Intelligence'), C('Lion', 'Intelligence'), C('Puck', 'Intelligence'), C('Rubick', 'Intelligence'), C('Shadow Shaman', 'Intelligence'), C('Storm Spirit', 'Intelligence'), C('Zeus', 'Intelligence'),
        C('Magnus', 'Universel'), C('Mirana', 'Universel'), C('Pangolier', 'Universel'), C('Snapfire', 'Universel'), C('Void Spirit', 'Universel'), C('Windranger', 'Universel')]
    }
  };

  /**
   * Séquences. A = équipe qui a gagné le pile ou face (first pick / côté bleu LoL).
   * t : 'ban' | 'pick' | 'side' | 'decider'
   */
  const SEQS = {
    // Veto cartes BO3 (identique au hub actuel)
    bo3: [].concat(r('ban', 'AB'), r('pick', 'A'), [{ t: 'side', team: 'B' }], r('pick', 'B'), [{ t: 'side', team: 'A' }], r('ban', 'AB'), [{ t: 'decider', team: null }], [{ t: 'side', team: 'A' }]),
    // Veto cartes BO1 : 6 bans alternés, carte restante, côté à l'équipe B
    bo1: [].concat(r('ban', 'ABABAB'), [{ t: 'decider', team: null }], [{ t: 'side', team: 'B' }]),
    // LoL — draft tournoi standard (10 bans, 10 picks)
    lol: [].concat(r('ban', 'ABABAB'), r('pick', 'ABBAAB'), r('ban', 'BABA'), r('pick', 'BAAB')),
    // Dota 2 — Captains Mode (7 bans / 5 picks par équipe, format 7.34+). Ordre tour par tour À VÉRIFIER sur le patch en cours.
    dota: [].concat(r('ban', 'ABBABBA'), r('pick', 'AB'), r('ban', 'AAB'), r('pick', 'BAABBA'), r('ban', 'ABBA'), r('pick', 'AB'))
  };

  const TURN_SECONDS = 30;

  // ---------------------------------------------------------------- engine
  function sequenceFor(game, format) {
    const g = GAMES[game];
    if (!g) throw new Error('Jeu inconnu : ' + game);
    return g.kind === 'maps' ? SEQS[format || 'bo3'] : SEQS[game];
  }

  function createMatch(game, format) {
    return { game, format: format || 'bo3', log: [] };
  }

  function currentStep(match) {
    const seq = sequenceFor(match.game, match.format);
    return match.log.length < seq.length ? Object.assign({ index: match.log.length }, seq[match.log.length]) : null;
  }

  function isDone(match) { return currentStep(match) === null; }

  /** id -> entrée de log (ban / pick / decider) */
  function statusMap(match) {
    const out = {};
    match.log.forEach((e) => { if (e.id && e.t !== 'side') out[e.id] = e; });
    return out;
  }

  function lastMapId(match) {
    for (let i = match.log.length - 1; i >= 0; i--) {
      const e = match.log[i];
      if (e.t === 'pick' || e.t === 'decider') return e.id;
    }
    return null;
  }

  /**
   * Applique une action et renvoie un NOUVEAU match (immutabilité).
   * action : { team, id } pour ban/pick, { team, side } pour side.
   * Lève une erreur si l'action est invalide — à utiliser tel quel côté serveur.
   */
  function apply(match, action) {
    const step = currentStep(match);
    if (!step) throw new Error('Veto terminé');
    if (step.team !== action.team) throw new Error("Ce n'est pas le tour de l'équipe " + action.team);
    const g = GAMES[match.game];
    const seq = sequenceFor(match.game, match.format);
    let entry;
    if (step.t === 'ban' || step.t === 'pick') {
      if (!g.pool.some((p) => p.id === action.id)) throw new Error('Élément inconnu : ' + action.id);
      if (statusMap(match)[action.id]) throw new Error('Élément déjà utilisé : ' + action.id);
      entry = { t: step.t, team: step.team, id: action.id };
    } else if (step.t === 'side') {
      if (!g.sides || !g.sides.some((s) => s[0] === action.side)) throw new Error('Côté invalide : ' + action.side);
      entry = { t: 'side', team: step.team, side: action.side, mapId: lastMapId(match) };
    } else {
      throw new Error('Étape automatique');
    }
    const log = match.log.concat([entry]);
    // Carte décisive automatique
    const next = seq[log.length];
    if (next && next.t === 'decider') {
      const used = {};
      log.forEach((e) => { if (e.id && e.t !== 'side') used[e.id] = 1; });
      const rem = g.pool.find((p) => !used[p.id]);
      if (rem) log.push({ t: 'decider', team: null, id: rem.id });
    }
    return Object.assign({}, match, { log });
  }

  function undo(match) {
    const log = match.log.slice();
    // La carte décisive est automatique : on retire aussi l'action humaine qui l'a déclenchée.
    const removed = log.pop();
    if (removed && removed.t === 'decider') log.pop();
    return Object.assign({}, match, { log });
  }

  /** Nom de phase lisible : "Bans 1", "Picks 2", "Choix du côté"… */
  function phaseName(seq, i) {
    const t = seq[i].t;
    if (t === 'side') return 'Choix du côté';
    if (t === 'decider') return 'Carte décisive';
    let n = 0, prev = null;
    for (let k = 0; k <= i; k++) {
      const tk = seq[k].t;
      if (tk !== 'ban' && tk !== 'pick') continue;
      if (tk === t && prev !== t) n++;
      prev = tk;
    }
    return (t === 'ban' ? 'Bans ' : 'Picks ') + n;
  }

  const api = { GAMES, SEQS, TURN_SECONDS, sequenceFor, createMatch, currentStep, isDone, statusMap, lastMapId, apply, undo, phaseName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PickBan = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* PraccHub — Pick & Ban : couche UI du prototype (vanilla JS, sans dépendance).
 * Toute la logique métier est dans pickban-core.js. Ici : état d'interface,
 * rendu HTML (toujours échappé), délégation d'événements, chrono.
 */
(function () {
  'use strict';
  const PB = window.PickBan;
  const TEAMS = {
    A: { name: 'Night Owls', short: 'NO', prefix: 'Night_', you: true },
    B: { name: 'Les Faucons', short: 'LF', prefix: 'Les_', you: false }
  };

  // ---------------------------------------------------------------- état UI
  const ui = {
    match: PB.createMatch('valorant', 'bo3'),
    sel: null,          // élément sélectionné, pas encore validé
    filter: 'Tous',
    query: '',
    time: PB.TURN_SECONDS,
    fxFrom: Infinity,   // index de log à partir duquel les entrées sont « neuves » (animées)
    enter: true,        // animation d'entrée du pool (changement de jeu / format)
    stepChanged: true   // anime bannière + badge « À vous »
  };

  // ---------------------------------------------------------------- helpers
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hue = (n) => { let h = 0; for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; };
  const ini = (n) => {
    const w = n.replace(/[^A-Za-zÀ-ÿ \-]/g, '').split(/[ \-]+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  };
  const bgOf = (p, kind) => kind === 'maps' ? `hsl(${p.hue} 32% 24%)` : `hsl(${hue(p.name)} 42% 30%)`;
  const tcls = (team) => team === 'A' ? 'ta' : team === 'B' ? 'tb' : 'tn';
  const $ = (sel) => document.querySelector(sel);

  function ctx() {
    const m = ui.match;
    const g = PB.GAMES[m.game];
    const seq = PB.sequenceFor(m.game, m.format);
    const cur = PB.currentStep(m);
    const byId = {};
    g.pool.forEach((p) => { byId[p.id] = p; });
    return {
      m, g, seq, cur, byId,
      isMaps: g.kind === 'maps',
      done: !cur,
      canAct: !!cur && (cur.t === 'ban' || cur.t === 'pick'),
      status: PB.statusMap(m),
      lastMap: PB.lastMapId(m),
      noun: g.kind === 'maps' ? 'une carte' : g.noun
    };
  }
  const isNew = (logIndex) => logIndex >= ui.fxFrom;

  // ---------------------------------------------------------------- rendu
  function renderHeader(c) {
    const games = Object.keys(PB.GAMES).map((k) => {
      const on = k === c.m.game;
      return `<button class="gbtn ${on ? 'on' : ''}" data-action="game" data-value="${k}" aria-pressed="${on}"><span class="gk">${esc(PB.GAMES[k].key)}</span>${esc(PB.GAMES[k].label)}</button>`;
    }).join('');
    const fmt = c.isMaps ? `<div class="row" style="gap:4px" role="group" aria-label="Format">
        <button class="fmt ${c.m.format === 'bo1' ? 'on' : ''}" data-action="format" data-value="bo1">BO1</button>
        <button class="fmt ${c.m.format === 'bo3' ? 'on' : ''}" data-action="format" data-value="bo3">BO3</button></div>` : '';
    const live = c.done ? 'Match en cours' : (c.isMaps ? 'Veto en cours' : 'Draft en cours');
    $('#games').innerHTML = games;
    $('#top-right').innerHTML = `${fmt}
      <label class="sr" for="motion">Animations</label>
      <select id="motion" class="motion-sel" data-action="motion">
        <option value="normale">Animations : normales</option><option value="lente">Animations : ralenties</option><option value="off">Animations : coupées</option>
      </select>
      <span class="chip">Scrim</span><span class="chip">Platine</span>
      <span class="chip live"><i></i>${esc(live)}</span>`;
    $('#motion').value = document.body.dataset.motion || 'normale';
  }

  function renderTurn(c) {
    const step = c.m.log.length;
    let kicker, em, post, pre = '';
    if (c.done) {
      kicker = `${c.isMaps ? 'Veto terminé' : 'Draft terminé'} · ${c.seq.length} étapes`;
      pre = 'Tout est prêt.'; em = 'Bon match'; post = '— GL HF';
    } else {
      kicker = `Étape ${step + 1}/${c.seq.length} · ${PB.phaseName(c.seq, step)}`;
      em = TEAMS[c.cur.team].name;
      post = c.cur.t === 'ban' ? `bannit ${c.noun}` : c.cur.t === 'pick' ? `choisit ${c.noun}` : `choisit son côté sur ${c.lastMap ? c.byId[c.lastMap].name : ''}`;
    }
    const timer = c.done ? '' : `<div class="timer-box"><span id="timer" class="timer">0:30</span><div class="tbar"><i></i></div></div>`;
    const el = $('#turn');
    el.className = `turn ${c.done ? 'tn' : tcls(c.cur.team)} ${ui.stepChanged ? 'fx' : ''}`;
    el.innerHTML = `<div class="sweep"></div><div class="bar"></div>
      <div class="turn-in">
        <div class="ttl"><span class="kick">${esc(kicker)}</span><h1>${esc(pre)} <em>${esc(em)}</em> ${esc(post)}</h1></div>
        ${timer}
        <div class="row" style="gap:8px">
          <button class="ghost" data-action="undo" ${step === 0 ? 'disabled' : ''}>Annuler</button>
          <button class="ghost" data-action="reset">Recommencer</button>
        </div>
      </div>`;
    updateTimer();
  }

  function renderRail(c) {
    const step = c.m.log.length;
    $('#rail').innerHTML = c.seq.map((x, i) => {
      const code = x.t === 'ban' ? 'Ban' : x.t === 'pick' ? 'Pick' : x.t === 'side' ? 'Côté' : 'Déc.';
      const st = i < step ? 'done' : i === step ? 'cur' : '';
      const title = `${i + 1}. ${x.team ? TEAMS[x.team].name + ' — ' : ''}${PB.phaseName(c.seq, i)}`;
      return `<span class="seg ${tcls(x.team)} k-${x.t} ${st}" title="${esc(title)}">${code}</span>`;
    }).join('');
  }

  function renderTeam(c, k) {
    const T = TEAMS[k];
    const active = !!c.cur && c.cur.team === k;
    const entries = c.m.log.map((e, i) => Object.assign({ i }, e)).filter((e) => e.team === k);
    let meta = '5/5 joueurs check-in';
    if (c.m.game === 'lol') meta = k === 'A' ? 'Côté bleu · first pick' : 'Côté rouge';
    if (c.m.game === 'dota') meta = k === 'A' ? 'First pick' : 'Second pick';

    let body = '';
    if (c.isMaps) {
      const roster = [1, 2, 3, 4, 5].map((n) => `<div class="prow"><span class="ck" aria-hidden="true">✓</span>${esc(T.prefix + n)}${n === 1 ? '<span class="cap">Capitaine</span>' : ''}</div>`).join('');
      const acts = entries.map((e) => {
        const verb = e.t === 'ban' ? 'Ban' : e.t === 'pick' ? 'Pick' : 'Côté';
        const name = e.t === 'side' ? `${e.side} · ${c.byId[e.mapId].name}` : c.byId[e.id].name;
        return `<div class="act k-${e.t} ${isNew(e.i) ? 'fx' : ''}"><span class="v">${verb}</span><b>${esc(name)}</b></div>`;
      }).join('');
      body = `<div class="list"><span class="sub">Roster · 5/5 check-in</span>${roster}<div class="prow bench">${esc(T.prefix + 6)} · remplaçant</div></div>
        <div class="list"><span class="sub">Actions</span>${acts || '<div class="empty">Aucune action pour l\'instant</div>'}</div>`;
    } else {
      const picks = entries.filter((e) => e.t === 'pick');
      const bans = entries.filter((e) => e.t === 'ban');
      const pendPick = active && c.cur.t === 'pick' && ui.sel ? c.byId[ui.sel] : null;
      const slots = [0, 1, 2, 3, 4].map((i) => {
        const e = picks[i];
        const p = e ? c.byId[e.id] : (i === picks.length ? pendPick : null);
        const next = !e && i === picks.length && active && c.cur.t === 'pick';
        const inner = e
          ? `<div class="sfill"><span class="av" style="background-color:${bgOf(p, 'draft')}">${esc(ini(p.name))}</span><b>${esc(p.name)}</b></div>`
          : p ? `<div class="pend"><span class="av" style="background-color:${bgOf(p, 'draft')}">${esc(ini(p.name))}</span><b>${esc(p.name)}</b></div>` : '';
        return `<div class="slot ${e ? 'filled' : ''} ${next ? 'next' : ''} ${e && isNew(e.i) ? 'fx' : ''}"><span class="pl">${esc(T.prefix + (i + 1))}</span>${inner}</div>`;
      }).join('');
      const total = c.seq.filter((x) => x.t === 'ban' && x.team === k).length;
      const pendBan = active && c.cur.t === 'ban';
      let bs = '';
      for (let i = 0; i < total; i++) {
        const e = bans[i];
        const p = e ? c.byId[e.id] : null;
        const next = !e && i === bans.length && pendBan;
        const label = p ? ini(p.name) : (next && ui.sel ? ini(c.byId[ui.sel].name) : '');
        bs += `<span class="bs ${p ? 'full' : ''} ${next ? 'next' : ''} ${e && isNew(e.i) ? 'fx' : ''}" title="${esc(p ? p.name : 'Ban ' + (i + 1))}">${esc(label)}</span>`;
      }
      body = `<div class="list"><span class="sub">Picks</span>${slots}</div>
        <div class="list"><span class="sub">Bans</span><div class="bans">${bs}</div></div>`;
    }
    const el = $('#team-' + k);
    el.className = `team ${tcls(k)} ${active ? 'active' : ''} ${ui.stepChanged ? 'fx' : ''}`;
    el.innerHTML = `<div class="team-head"><span class="tlogo">${esc(T.short)}</span>
        <div><h2>${esc(T.name)}${T.you ? '<small>ton équipe</small>' : ''}</h2><p class="meta">${esc(meta)}</p></div>
        ${active ? `<span class="yt">${T.you ? 'À vous' : 'Leur tour'}</span>` : ''}</div>${body}`;
  }

  function poolHTML(c) {
    let src = c.g.pool;
    if (!c.isMaps) {
      const q = ui.query.trim().toLowerCase();
      src = src.filter((p) => (ui.filter === 'Tous' || p.role === ui.filter) && (!q || p.name.toLowerCase().includes(q)));
    }
    const logIndex = {};
    c.m.log.forEach((e, i) => { if (e.id && e.t !== 'side') logIndex[e.id] = i; });
    return src.map((p, i) => {
      const st = c.status[p.id];
      const can = c.canAct && !st;
      const sel = c.canAct && ui.sel === p.id;
      const fresh = st && isNew(logIndex[p.id]);
      const cls = [
        can ? 'can' : '',
        st && st.t === 'ban' ? 'is-ban ' + tcls(st.team) : '',
        st && st.t === 'pick' ? 'is-pick ' + tcls(st.team) : '',
        st && st.t === 'decider' ? 'is-dec tn' : '',
        sel ? 'is-sel ' + tcls(c.cur.team) : '',
        fresh ? 'fx' : ''
      ].join(' ');
      const delay = `animation-delay:${Math.min(i, 24) * 35}ms`;
      const by = st && st.team ? TEAMS[st.team].short : '';
      const attrs = `class="${c.isMaps ? 'mapc' : 'hero'} ${cls}" data-action="select" data-value="${esc(p.id)}" aria-pressed="${sel}" ${can ? '' : 'disabled'} style="${ui.enter ? delay : ''}"`;
      if (c.isMaps) {
        return `<button ${attrs}><span class="art" style="background-color:${bgOf(p, 'maps')}"></span>
          <span class="ml">${String(i + 1).padStart(2, '0')} / MAP</span><span class="mn">${esc(p.name)}</span>
          ${st && st.t === 'ban' ? `<span class="stamp">Banni · ${esc(by)}</span>` : ''}
          ${st && st.t === 'pick' ? `<span class="ptag">Pick ${esc(by)}</span>` : ''}
          ${st && st.t === 'decider' ? '<span class="ptag dec">Décisive</span>' : ''}</button>`;
      }
      return `<button ${attrs}><span class="av" style="background-color:${bgOf(p, 'draft')}">${esc(ini(p.name))}</span>
        <span class="hn">${esc(p.name)}</span><span class="hr">${esc(p.role)}</span>
        ${st && st.t === 'ban' ? '<span class="hx" aria-hidden="true"></span>' : ''}
        ${st && st.t === 'pick' ? `<span class="hp">${esc(by)}</span>` : ''}</button>`;
    }).join('') || '<div class="empty">Aucun résultat</div>';
  }

  function renderCenter(c) {
    const el = $('#center');
    if (c.done) {
      let block;
      if (c.isMaps) {
        const maps = c.m.log.filter((e) => e.t === 'pick' || e.t === 'decider');
        block = `<div class="sum">${maps.map((e, i) => {
          const sd = c.m.log.find((x) => x.t === 'side' && x.mapId === e.id);
          const label = (maps.length > 1 ? `Map ${i + 1} — ` : 'Map unique — ') + (e.t === 'decider' ? 'Décisive' : 'Pick ' + TEAMS[e.team].name);
          return `<div class="scard ${tcls(e.team)}" style="animation-delay:${i * 110}ms"><span class="art" style="background-color:${bgOf(c.byId[e.id], 'maps')}"></span>
            <span class="k">${esc(label)}</span><b>${esc(c.byId[e.id].name)}</b><span class="s">${sd ? esc(TEAMS[sd.team].name + ' : ' + sd.side) : ''}</span></div>`;
        }).join('')}</div>`;
      } else {
        const line = (k) => c.m.log.filter((e) => e.t === 'pick' && e.team === k).map((e, i) => {
          const p = c.byId[e.id];
          return `<div class="lrow" style="animation-delay:${i * 80}ms"><span class="av" style="background-color:${bgOf(p, 'draft')}">${esc(ini(p.name))}</span><b>${esc(p.name)}</b><span>${esc(TEAMS[k].prefix + (i + 1))}</span></div>`;
        }).join('');
        block = `<div class="lineups"><div class="lineup ta"><span class="sub">${esc(TEAMS.A.name)}</span>${line('A')}</div><div class="lineup tb"><span class="sub">${esc(TEAMS.B.name)}</span>${line('B')}</div></div>`;
      }
      el.innerHTML = `<div class="stack" style="gap:2px"><span class="sub">${c.isMaps ? 'Série ' + c.m.format.toUpperCase() : 'Compositions'}</span>
          <span class="disp" style="font-size:20px;font-weight:600">${c.isMaps ? 'Ordre des cartes' : 'Draft verrouillé'}</span></div>
        ${block}
        <div class="gg"><h2>Bon match ! GL HF</h2><p class="meta" style="margin:0">À la fin du match, chaque capitaine déclare le vainqueur.</p>
          <div class="row" style="gap:10px;justify-content:center">
            <button class="vbtn ta" data-action="win" data-value="A">Victoire : ${esc(TEAMS.A.name)}</button>
            <button class="vbtn tb" data-action="win" data-value="B">Victoire : ${esc(TEAMS.B.name)}</button></div></div>`;
      return;
    }
    const head = `<div class="pool-head"><div class="stack" style="gap:2px">
        <span class="sub">${esc(c.isMaps ? c.g.label + ' · pool compétitif' : c.g.label + ' · ' + c.g.pool.length + ' ' + c.g.nounPl.toLowerCase())}</span>
        <span class="disp" style="font-size:20px;font-weight:600">${esc(c.isMaps ? 'Cartes' : c.g.nounPl)}</span></div>
        ${c.isMaps ? '' : `<div><label class="sr" for="q">Rechercher</label><input id="q" class="search" type="search" placeholder="Rechercher…" value="${esc(ui.query)}" data-action="query"></div>`}
      </div>`;
    const filters = c.isMaps ? '' : `<div class="filters" role="group" aria-label="Filtrer">${c.g.filters.map((f) =>
      `<button class="fbtn ${f === ui.filter ? 'on' : ''}" data-action="filter" data-value="${esc(f)}">${esc(f)}</button>`).join('')}</div>`;
    const sideStep = c.cur.t === 'side';
    let footer = '';
    if (c.canAct) {
      const p = ui.sel ? c.byId[ui.sel] : null;
      const label = c.cur.t === 'ban' ? 'Bannir' : (c.isMaps ? 'Choisir' : 'Verrouiller');
      footer = `<div class="cbar ${tcls(c.cur.team)}"><div class="stack" style="gap:2px"><span class="sub">Sélection</span>
          <span class="disp" style="font-size:18px;font-weight:600">${esc(p ? p.name : 'Clique sur ' + c.noun)}</span></div>
          <button class="cta ${c.cur.t === 'ban' ? 'ban' : ''}" data-action="confirm" ${p ? '' : 'disabled'}>${esc(label + (p ? ' ' + p.name : ''))}</button></div>`;
    }
    if (sideStep) {
      footer = `<div class="sidepick ${tcls(c.cur.team)}" role="dialog" aria-label="Choix du côté"><span class="kick">Choix du côté</span>
        <h3><em>${esc(TEAMS[c.cur.team].name)}</em> choisit son côté de départ sur ${esc(c.byId[c.lastMap].name)}</h3>
        <div class="row" style="gap:10px">${c.g.sides.map((s) =>
          `<button class="sbtn" data-action="side" data-value="${esc(s[0])}"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></button>`).join('')}</div></div>`;
    }
    el.innerHTML = `<div class="stack ${sideStep ? 'dim' : ''}" style="gap:16px">${head}${filters}
        <div id="pool" class="${c.isMaps ? 'maps' : 'heroes'} ${ui.enter ? 'enter' : ''}">${poolHTML(c)}</div></div>${footer}`;
  }

  function renderLog(c) {
    const items = c.m.log.map((e, i) => {
      let t;
      if (e.t === 'ban') t = `${TEAMS[e.team].name} bannit ${c.byId[e.id].name}`;
      else if (e.t === 'pick') t = `${TEAMS[e.team].name} choisit ${c.byId[e.id].name}`;
      else if (e.t === 'decider') t = `Carte décisive : ${c.byId[e.id].name}`;
      else t = `${TEAMS[e.team].name} prend le côté ${e.side} sur ${c.byId[e.mapId].name}`;
      return `<li class="k-${e.t} ${tcls(e.team)} ${isNew(i) ? 'fx' : ''}">${esc(t)}</li>`;
    }).join('');
    $('#log').innerHTML = `<span class="disp" style="font-size:17px;font-weight:600">Historique
        <span style="font-family:var(--f-body);font-weight:400;font-size:14px;color:var(--mu)">· pile ou face gagné par ${esc(TEAMS.A.name)}</span></span>
      ${items ? `<ol>${items}</ol>` : '<div class="empty">Le veto n\'a pas encore commencé.</div>'}`;
  }

  function render() {
    const c = ctx();
    renderHeader(c); renderTurn(c); renderRail(c);
    renderTeam(c, 'A'); renderCenter(c); renderTeam(c, 'B'); renderLog(c);
    // Les marqueurs d'animation ne valent que pour ce rendu.
    ui.fxFrom = Infinity; ui.enter = false; ui.stepChanged = false;
  }

  // ---------------------------------------------------------------- actions
  function commit(nextMatch) {
    ui.fxFrom = ui.match.log.length;
    ui.match = nextMatch;
    ui.sel = null;
    ui.time = PB.TURN_SECONDS;
    ui.stepChanged = true;
    render();
  }
  function restart(game, format) {
    ui.match = PB.createMatch(game, format);
    Object.assign(ui, { sel: null, filter: 'Tous', query: '', time: PB.TURN_SECONDS, enter: true, stepChanged: true });
    render();
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const c = ctx();
    const v = btn.dataset.value;
    switch (btn.dataset.action) {
      case 'game': if (v !== c.m.game) restart(v, c.m.format); break;
      case 'format': if (v !== c.m.format) restart(c.m.game, v); break;
      case 'reset': restart(c.m.game, c.m.format); break;
      case 'undo': ui.match = PB.undo(c.m); ui.sel = null; ui.time = PB.TURN_SECONDS; ui.stepChanged = true; render(); break;
      case 'select': if (c.canAct) { ui.sel = v; render(); } break;
      case 'confirm': if (c.canAct && ui.sel) commit(PB.apply(c.m, { team: c.cur.team, id: ui.sel })); break;
      case 'side': commit(PB.apply(c.m, { team: c.cur.team, side: v })); break;
      case 'filter': ui.filter = v; render(); break;
      case 'win': btn.textContent = 'Déclaration envoyée'; break;
    }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.dataset.action === 'query') {
      ui.query = ev.target.value;
      $('#pool').innerHTML = poolHTML(ctx()); // ne re-rend que la grille : le champ garde le focus
    }
  });
  document.addEventListener('change', (ev) => {
    if (ev.target.dataset.action === 'motion') {
      document.body.dataset.motion = ev.target.value;
      document.body.className = 'motion-' + ev.target.value;
    }
  });

  // ---------------------------------------------------------------- chrono
  function updateTimer() {
    const t = $('#timer');
    if (!t) return;
    t.textContent = '0:' + String(ui.time).padStart(2, '0');
    t.classList.toggle('low', ui.time <= 5);
  }
  setInterval(() => {
    if (PB.isDone(ui.match) || ui.time <= 0) return;
    ui.time -= 1;
    updateTimer();
  }, 1000);

  render();
})();

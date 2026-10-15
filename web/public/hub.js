/* eslint-env browser */
/* PraccHub — hub de match : check-in, pick & ban, déclaration du résultat.
 * Porté depuis docs/pickban-handoff/prototype/app.js. Le serveur est la source de vérité :
 * chaque action est envoyée à l'API, validée par le moteur partagé (pickban-core.js),
 * puis l'état revient ici (réponse HTTP + flux temps réel SSE).
 * Tous les textes venant des données (équipes, joueurs, personnages) passent par esc().
 */
(function() {
	'use strict';
	const PB = window.PickBan;
	const matchId = location.pathname.split('/').filter(Boolean).pop();
	const token = new URLSearchParams(location.search).get('t') || '';
	const api = `/api/matches/${encodeURIComponent(matchId)}`;

	const ui = {
		state: null,
		byId: {},
		catalog: null,
		sel: null,
		filter: 'Tous',
		query: '',
		// index de log à partir duquel les entrées sont « neuves » (animées)
		fxFrom: Infinity,
		// animation d'entrée du pool
		enter: true,
		// anime bannière + badge « À vous »
		stepChanged: true,
		prevLen: null,
		prevStep: null,
		prevStatus: null,
		clockOffset: 0,
		busy: false,
	};

	/* ---------------------------------------------------------------- helpers */
	const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
	const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ENTITIES[c]);
	const hue = n => {
		let h = 0;
		for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
		return h;
	};
	const ini = n => {
		const w = String(n).replace(/[^A-Za-zÀ-ÿ0-9 -]/g, '').split(/[ -]+/).filter(Boolean);
		if (!w.length) return '?';
		return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
	};
	const bgOf = (p, kind) => kind === 'maps' ? `hsl(${p.hue == null ? hue(p.name) : p.hue} 32% 24%)` : `hsl(${hue(p.name)} 42% 30%)`;
	const tcls = team => team === 'A' ? 'ta' : team === 'B' ? 'tb' : 'tn';
	const $ = sel => document.querySelector(sel);
	// Seules les URL d'images sûres (https ou locales, sans guillemets ni parenthèses) sont acceptées
	const safeUrl = url => typeof url === 'string' && /^(https:\/\/|\/static\/)[^\s'"()\\<>]+$/.test(url) ? url : null;
	const now = () => Date.now() + ui.clockOffset;
	const item = id => ui.byId[id] || { id, name: id, hue: hue(id) };
	const teamName = k => ui.state.teams[k].name;
	const teamShort = k => ini(teamName(k));

	function avatar(p) {
		const img = safeUrl(p.img);
		return `<span class="av" style="${esc(`background-color:${bgOf(p, 'draft')}`)}">${esc(ini(p.name))}${img ? `<img src="${esc(img)}" alt="" loading="lazy" data-fallback>` : ''}</span>`;
	}
	function art(p) {
		const img = safeUrl(p.img);
		return `<span class="art" style="${esc(`background-color:${bgOf(p, 'maps')}${img ? `;background-image:url(${img})` : ''}`)}"></span>`;
	}

	function ctx() {
		const s = ui.state;
		const veto = s.veto;
		const kind = s.game.veto;
		const cur = veto && s.status === 'veto' ? PB.currentStep(veto) : null;
		const myTurn = Boolean(cur) && s.viewer.captain && s.viewer.team === cur.team;
		return {
			s,
			veto,
			kind,
			isMaps: kind === 'maps',
			seq: veto ? PB.sequenceOf(veto) : [],
			cur,
			myTurn,
			canAct: myTurn && (cur.t === 'ban' || cur.t === 'pick'),
			status: veto ? PB.statusMap(veto) : {},
			lastMap: veto ? PB.lastMapId(veto) : null,
			log: veto ? veto.log : [],
			noun: s.game.noun,
		};
	}
	const isNew = logIndex => logIndex >= ui.fxFrom;

	function poolItems(c) {
		if (!c.veto) return [];
		return c.veto.pool.map(item);
	}

	/* ---------------------------------------------------------------- rendu */
	function liveLabel(c) {
		switch (c.s.status) {
		case 'checkin': return { text: 'Check-in', cls: 'live' };
		case 'veto': return { text: c.kind === 'draft' ? 'Draft en cours' : 'Veto en cours', cls: 'live' };
		case 'live': return { text: 'Match en cours', cls: 'live' };
		case 'disputed': return { text: 'Résultat contesté', cls: 'live' };
		case 'finished': return { text: 'Terminé', cls: 'ok' };
		default: return { text: 'Annulé', cls: 'off' };
		}
	}

	function renderHeader(c) {
		const g = c.s.game;
		$('#games').innerHTML = `<span class="gbtn on"><span class="gk">${esc(g.short)}</span>${esc(g.name)}</span>`;
		const live = liveLabel(c);
		const motion = document.body.dataset.motion || 'normale';
		$('#top-right').innerHTML = `${c.isMaps ? `<span class="fmt on">${esc(c.s.format.toUpperCase())}</span>` : ''}
			<label class="sr" for="motion">Animations</label>
			<select id="motion" class="motion-sel" data-action="motion">
				<option value="normale">Animations : normales</option><option value="lente">Animations : ralenties</option><option value="off">Animations : coupées</option>
			</select>
			<span class="chip">${c.s.type === 'match' ? 'Match' : 'Scrim'}</span>
			${c.s.level ? `<span class="chip">${esc(c.s.level)}</span>` : ''}
			<span class="chip ${live.cls}"><i></i>${esc(live.text)}</span>`;
		$('#motion').value = motion;
	}

	function turnText(c) {
		const s = c.s;
		const { A, B } = s.teams;
		if (s.status === 'checkin') {
			return { cls: 'tn', kicker: `Check-in · ${A.checkedIn}/${s.size} — ${B.checkedIn}/${s.size}`, pre: 'Confirmez votre', em: 'présence', post: '', timer: true };
		}
		if (s.status === 'cancelled') {
			return { cls: 'tn', kicker: 'Match annulé', pre: '', em: '', post: s.cancelReason || 'Ce match a été annulé.' };
		}
		if (s.status === 'finished') {
			const w = s.result.winner;
			return { cls: tcls(w), kicker: 'Résultat validé par les deux capitaines', pre: 'Victoire de', em: teamName(w), post: '— GG' };
		}
		if (!c.cur) {
			const steps = c.seq.length;
			const label = c.kind === 'draft' ? 'Draft terminé' : 'Veto terminé';
			return { cls: 'tn', kicker: `${label} · ${steps} étape${steps > 1 ? 's' : ''}`, pre: 'Tout est prêt.', em: 'Bon match', post: '— GL HF' };
		}
		const step = c.log.length;
		let post;
		if (c.cur.t === 'ban') post = `bannit ${c.noun}`;
		else if (c.cur.t === 'pick') post = `choisit ${c.noun}`;
		else post = c.lastMap ? `choisit son côté sur ${item(c.lastMap).name}` : 'choisit son côté';
		return { cls: tcls(c.cur.team), kicker: `Étape ${step + 1}/${c.seq.length} · ${PB.phaseName(c.seq, step)}`, pre: '', em: teamName(c.cur.team), post, timer: true, undo: true };
	}

	function renderTurn(c) {
		const t = turnText(c);
		const v = c.s.viewer;
		const canUndo = c.s.status === 'veto' && v.captain && c.veto && c.veto.lastActor === v.team;
		const el = $('#turn');
		el.className = `turn ${t.cls} ${ui.stepChanged ? 'fx' : ''}`;
		el.innerHTML = `<div class="sweep"></div><div class="bar"></div>
			<div class="turn-in">
				<div class="ttl"><span class="kick">${esc(t.kicker)}</span><h1>${esc(t.pre)} <em>${esc(t.em)}</em> ${esc(t.post)}</h1></div>
				${t.timer ? `<div class="timer-box"><span id="timer" class="timer">0:00</span>${c.s.status === 'veto' ? '<div class="tbar"><i id="tbar"></i></div>' : ''}</div>` : ''}
				${t.undo && v.captain ? `<div class="row" style="gap:8px"><button class="ghost" data-action="undo" ${canUndo ? '' : 'disabled'} title="Annule la dernière action de ton équipe">Annuler</button></div>` : ''}
			</div>`;
		updateTimer();
	}

	function renderRail(c) {
		const step = c.log.length;
		$('#rail').hidden = !c.veto;
		$('#rail').innerHTML = c.seq.map((x, i) => {
			const code = x.t === 'ban' ? 'Ban' : x.t === 'pick' ? 'Pick' : x.t === 'side' ? 'Côté' : 'Déc.';
			const st = i < step ? 'done' : i === step && c.s.status === 'veto' ? 'cur' : '';
			const title = `${i + 1}. ${x.team ? teamName(x.team) + ' — ' : ''}${PB.phaseName(c.seq, i)}`;
			return `<span class="seg ${tcls(x.team)} k-${x.t} ${st}" title="${esc(title)}">${code}</span>`;
		}).join('');
	}

	function rosterHTML(c, k) {
		const T = c.s.teams[k];
		const started = c.s.status !== 'checkin';
		const rows = T.members.map(m => {
			const mine = m.id === c.s.viewer.userId;
			const tail = m.checkedIn ? '' : (started ? ' · remplaçant' : ' · en attente');
			return `<div class="prow ${m.checkedIn ? '' : 'out'} ${mine ? 'me' : ''}"><span class="ck" aria-hidden="true">${m.checkedIn ? '✓' : '○'}</span>${esc(m.name)}${esc(tail)}${m.captain ? '<span class="cap">Capitaine</span>' : ''}</div>`;
		}).join('');
		return `<div class="list"><span class="sub">Roster · ${T.checkedIn}/${c.s.size} check-in</span>${rows}</div>`;
	}

	function draftHTML(c, k, entries, active) {
		const T = c.s.teams[k];
		const players = T.members.filter(m => m.checkedIn).concat(T.members.filter(m => !m.checkedIn)).slice(0, 5);
		const picks = entries.filter(e => e.t === 'pick');
		const bans = entries.filter(e => e.t === 'ban');
		const pendPick = active && c.cur.t === 'pick' && ui.sel ? item(ui.sel) : null;
		const slots = [0, 1, 2, 3, 4].map(i => {
			const e = picks[i];
			const p = e ? item(e.id) : (i === picks.length ? pendPick : null);
			const next = !e && i === picks.length && active && c.cur.t === 'pick';
			let inner = '';
			if (e) inner = `<div class="sfill">${avatar(p)}<b>${esc(p.name)}</b></div>`;
			else if (p) inner = `<div class="pend">${avatar(p)}<b>${esc(p.name)}</b></div>`;
			const label = players[i] ? players[i].name : `Joueur ${i + 1}`;
			return `<div class="slot ${e ? 'filled' : ''} ${next ? 'next' : ''} ${e && isNew(e.i) ? 'fx' : ''}"><span class="pl">${esc(label)}</span>${inner}</div>`;
		}).join('');
		const total = c.seq.filter(x => x.t === 'ban' && x.team === k).length;
		const pendBan = active && c.cur.t === 'ban';
		let bs = '';
		for (let i = 0; i < total; i++) {
			const e = bans[i];
			const p = e ? item(e.id) : null;
			const next = !e && i === bans.length && pendBan;
			const label = p ? ini(p.name) : (next && ui.sel ? ini(item(ui.sel).name) : '');
			bs += `<span class="bs ${p ? 'full' : ''} ${next ? 'next' : ''} ${e && isNew(e.i) ? 'fx' : ''}" title="${esc(p ? p.name : 'Ban ' + (i + 1))}">${esc(label)}</span>`;
		}
		return `<div class="list"><span class="sub">Picks</span>${slots}</div>
			<div class="list"><span class="sub">Bans</span><div class="bans">${bs}</div></div>`;
	}

	function actionsHTML(entries) {
		const acts = entries.map(e => {
			const verb = e.t === 'ban' ? 'Ban' : e.t === 'pick' ? 'Pick' : 'Côté';
			const name = e.t === 'side' ? (e.mapId ? `${e.side} · ${item(e.mapId).name}` : e.side) : item(e.id).name;
			return `<div class="act k-${e.t} ${isNew(e.i) ? 'fx' : ''}"><span class="v">${verb}</span><b>${esc(name)}</b></div>`;
		}).join('');
		return `<div class="list"><span class="sub">Actions</span>${acts || '<div class="empty">Aucune action pour l\'instant</div>'}</div>`;
	}

	function renderTeam(c, k) {
		const s = c.s;
		const T = s.teams[k];
		const you = s.viewer.team === k;
		const active = Boolean(c.cur) && c.cur.team === k;
		const entries = c.log.map((e, i) => Object.assign({ i }, e)).filter(e => e.team === k);
		let meta = `${T.checkedIn}/${s.size} joueurs check-in`;
		if (c.veto && s.game.teamMeta) meta = s.game.teamMeta[k];

		let body;
		if (c.veto && c.kind === 'draft') body = draftHTML(c, k, entries, active);
		else body = rosterHTML(c, k) + (c.veto ? actionsHTML(entries) : '');

		let badge = '';
		if (active) badge = `<span class="yt">${you ? 'À vous' : 'Leur tour'}</span>`;
		else if (s.status === 'checkin' && T.checkedIn >= s.size) badge = '<span class="yt">Prêt</span>';
		else if (s.status === 'finished' && s.result.winner === k) badge = '<span class="yt">Victoire</span>';

		const el = $('#team-' + k);
		el.className = `team ${tcls(k)} ${active ? 'active' : ''} ${ui.stepChanged ? 'fx' : ''}`;
		el.innerHTML = `<div class="team-head"><span class="tlogo">${esc(teamShort(k))}</span>
				<div><h2>${esc(T.name)}${you ? '<small>ton équipe</small>' : ''}</h2><p class="meta">${esc(meta)}</p></div>
				${badge}</div>${body}`;
	}

	function poolHTML(c) {
		let src = poolItems(c);
		if (!c.isMaps) {
			const q = ui.query.trim().toLowerCase();
			src = src.filter(p => (ui.filter === 'Tous' || p.role === ui.filter) && (!q || p.name.toLowerCase().includes(q)));
		}
		const logIndex = {};
		c.log.forEach((e, i) => {
			if (e.id && e.t !== 'side') logIndex[e.id] = i;
		});
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
				fresh ? 'fx' : '',
			].join(' ');
			const delay = `animation-delay:${Math.min(i, 24) * 35}ms`;
			const by = st && st.team ? teamShort(st.team) : '';
			const label = st ? `${p.name} — ${st.t === 'ban' ? 'banni' : st.t === 'pick' ? 'choisi' : 'décisive'}${by ? ' par ' + teamName(st.team) : ''}` : p.name;
			const attrs = `class="${c.isMaps ? 'mapc' : 'hero'} ${cls}" data-action="select" data-value="${esc(p.id)}" aria-pressed="${sel}" aria-label="${esc(label)}" ${can ? '' : 'disabled'} style="${ui.enter ? delay : ''}"`;
			if (c.isMaps) {
				return `<button ${attrs}>${art(p)}
					<span class="ml">${String(i + 1).padStart(2, '0')} / MAP</span><span class="mn">${esc(p.name)}</span>
					${st && st.t === 'ban' ? `<span class="stamp">Banni · ${esc(by)}</span>` : ''}
					${st && st.t === 'pick' ? `<span class="ptag">Pick ${esc(by)}</span>` : ''}
					${st && st.t === 'decider' ? '<span class="ptag dec">Décisive</span>' : ''}</button>`;
			}
			return `<button ${attrs}>${avatar(p)}
				<span class="hn">${esc(p.name)}</span><span class="hr">${esc(p.role || '')}</span>
				${st && st.t === 'ban' ? '<span class="hx" aria-hidden="true"></span>' : ''}
				${st && st.t === 'pick' ? `<span class="hp">${esc(by)}</span>` : ''}</button>`;
		}).join('') || '<div class="empty">Aucun résultat</div>';
	}

	function waitingHTML(c) {
		const v = c.s.viewer;
		let text = `En attente du capitaine de ${teamName(c.cur.team)}…`;
		if (v.team === c.cur.team && !v.captain) text = 'Ton capitaine est en train de choisir…';
		return `<div class="cbar waiting ${tcls(c.cur.team)}"><div class="stack" style="gap:2px"><span class="sub">${v.team === c.cur.team ? 'Votre tour' : 'Leur tour'}</span>
			<span class="disp" style="font-size:18px;font-weight:600">${esc(text)}</span></div></div>`;
	}

	function sidePanelHTML(c, inline) {
		const name = teamName(c.cur.team);
		const target = c.lastMap ? ` sur ${item(c.lastMap).name}` : '';
		const sides = c.s.game.sides;
		return `<div class="sidepick ${inline ? 'inline' : ''} ${tcls(c.cur.team)}" role="dialog" aria-label="Choix du côté"><span class="kick">Choix du côté</span>
			<h3><em>${esc(name)}</em> choisit son côté de départ${esc(target)}</h3>
			<div class="row" style="gap:10px">${sides.map(sd =>
		`<button class="sbtn" data-action="side" data-value="${esc(sd[0])}" ${c.myTurn ? '' : 'disabled'}><b>${esc(sd[0])}</b><span>${esc(sd[1])}</span></button>`).join('')}</div>
			${c.myTurn ? '' : `<p class="note">En attente du capitaine de ${esc(name)}…</p>`}</div>`;
	}

	function summaryHTML(c) {
		if (c.kind === 'maps') {
			const maps = c.log.filter(e => e.t === 'pick' || e.t === 'decider');
			return `<div class="sum">${maps.map((e, i) => {
				const sd = c.log.find(x => x.t === 'side' && x.mapId === e.id);
				const label = (maps.length > 1 ? `Map ${i + 1} — ` : 'Map unique — ') + (e.t === 'decider' ? 'Décisive' : 'Pick ' + teamName(e.team));
				return `<div class="scard ${tcls(e.team)}" style="animation-delay:${i * 110}ms">${art(item(e.id))}
					<span class="k">${esc(label)}</span><b>${esc(item(e.id).name)}</b><span class="s">${sd ? esc(teamName(sd.team) + ' : ' + sd.side) : ''}</span></div>`;
			}).join('')}</div>`;
		}
		if (c.kind === 'draft') {
			const line = k => {
				const players = c.s.teams[k].members.filter(m => m.checkedIn);
				return c.log.filter(e => e.t === 'pick' && e.team === k).map((e, i) => {
					const p = item(e.id);
					return `<div class="lrow" style="animation-delay:${i * 80}ms">${avatar(p)}<b>${esc(p.name)}</b><span>${esc(players[i] ? players[i].name : '')}</span></div>`;
				}).join('');
			};
			return `<div class="lineups"><div class="lineup ta"><span class="sub">${esc(teamName('A'))}</span>${line('A')}</div><div class="lineup tb"><span class="sub">${esc(teamName('B'))}</span>${line('B')}</div></div>`;
		}
		const sd = c.log.find(e => e.t === 'side');
		return sd ? `<div class="sum"><div class="scard ${tcls(sd.team)}"><span class="k">Côté</span><b>${esc(sd.side)}</b><span class="s">${esc(teamName(sd.team))}</span></div></div>` : '';
	}

	function resultHTML(c) {
		const s = c.s;
		if (s.status === 'finished') {
			return `<div class="winner ${tcls(s.result.winner)}"><span class="sub">Résultat validé</span><h2>Victoire de ${esc(teamName(s.result.winner))}</h2><p class="note">GG à tous !</p></div>`;
		}
		const v = s.viewer;
		const reported = v.team ? s.result.reports[v.team] : null;
		const disputed = s.status === 'disputed';
		const buttons = v.captain ? `<div class="row" style="gap:10px;justify-content:center">${['A', 'B'].map(k =>
			`<button class="vbtn ${tcls(k)} ${reported === k ? 'on' : ''}" data-action="win" data-value="${k}" aria-pressed="${reported === k}">Victoire : ${esc(teamName(k))}</button>`).join('')}</div>` : '';
		let note = v.captain ? '' : '<p class="note">Les capitaines déclareront le vainqueur à la fin du match.</p>';
		if (v.captain && reported) note = '<p class="note">Résultat envoyé. En attente du capitaine adverse.</p>';
		return `<div class="gg"><h2>${disputed ? 'Résultat contesté' : 'Bon match ! GL HF'}</h2>
			<p class="meta" style="margin:0">${disputed
		? 'Les capitaines ont déclaré des vainqueurs différents. Mettez-vous d\'accord et redéclarez, ou contactez un admin.'
		: 'À la fin du match, chaque capitaine déclare le vainqueur.'}</p>${buttons}${note}</div>`;
	}

	function renderCenter(c) {
		const el = $('#center');
		const s = c.s;
		const v = s.viewer;
		if (s.status === 'checkin') {
			el.innerHTML = `<div class="checkin"><span class="sub">Avant le pick &amp; ban</span><h2>Check-in</h2>
				<p>Chaque équipe doit avoir ${s.size} joueur${s.size > 1 ? 's' : ''} présent${s.size > 1 ? 's' : ''}. Le pile ou face et le ${c.kind === 'draft' ? 'draft' : 'veto'} démarrent automatiquement.</p>
				<div class="bigcount"><span class="ta">${s.teams.A.checkedIn}/${s.size}<small>${esc(teamName('A'))}</small></span><span class="sub">vs</span><span class="tb">${s.teams.B.checkedIn}/${s.size}<small>${esc(teamName('B'))}</small></span></div>
				<div class="row" style="gap:10px;justify-content:center">
					${v.team ? `<button class="cta ${tcls(v.team)}" data-action="checkin" ${v.checkedIn ? 'disabled' : ''}>${v.checkedIn ? 'Check-in confirmé ✓' : 'Je suis présent'}</button>` : '<p class="note">Tu ne fais pas partie de ce match.</p>'}
					${v.captain ? '<button class="ghost" data-action="cancel">Annuler le match</button>' : ''}
				</div></div>`;
			return;
		}
		if (s.status === 'cancelled') {
			el.innerHTML = `<div class="checkin"><span class="sub">Match annulé</span><h2>Rendez-vous au prochain match</h2><p>${esc(s.cancelReason || '')}</p><p>Relancez une recherche avec <b>/match chercher</b> sur Discord.</p></div>`;
			return;
		}
		if (!c.cur) {
			el.innerHTML = `<div class="stack" style="gap:2px"><span class="sub">${c.isMaps ? 'Série ' + esc(s.format.toUpperCase()) : (c.kind === 'draft' ? 'Compositions' : 'Choix du côté')}</span>
				<span class="disp" style="font-size:20px;font-weight:600">${c.isMaps ? 'Ordre des cartes' : (c.kind === 'draft' ? 'Draft verrouillé' : 'Côtés')}</span></div>
				${summaryHTML(c)}${resultHTML(c)}`;
			return;
		}
		if (c.kind === 'sides') {
			el.innerHTML = sidePanelHTML(c, true);
			return;
		}
		const g = s.game;
		const total = c.veto.pool.length;
		const head = `<div class="pool-head"><div class="stack" style="gap:2px">
				<span class="sub">${esc(c.isMaps ? g.name + ' · pool compétitif' : g.name + ' · ' + total + ' ' + g.nounPl.toLowerCase())}</span>
				<span class="disp" style="font-size:20px;font-weight:600">${esc(g.nounPl)}</span></div>
				${c.isMaps ? '' : `<div><label class="sr" for="q">Rechercher</label><input id="q" class="search" type="search" placeholder="Rechercher…" value="${esc(ui.query)}" data-action="query" autocomplete="off"></div>`}
			</div>`;
		const filterList = ui.catalog && ui.catalog.filters ? ui.catalog.filters : [];
		const filters = c.isMaps || !filterList.length ? '' : `<div class="filters" role="group" aria-label="Filtrer">${filterList.map(f =>
			`<button class="fbtn ${f === ui.filter ? 'on' : ''}" data-action="filter" data-value="${esc(f)}" aria-pressed="${f === ui.filter}">${esc(f)}</button>`).join('')}</div>`;
		const sideStep = c.cur.t === 'side';
		let footer = '';
		if (c.canAct) {
			const p = ui.sel ? item(ui.sel) : null;
			const label = c.cur.t === 'ban' ? 'Bannir' : (c.isMaps ? 'Choisir' : 'Verrouiller');
			footer = `<div class="cbar ${tcls(c.cur.team)}"><div class="stack" style="gap:2px"><span class="sub">Sélection</span>
					<span class="disp" style="font-size:18px;font-weight:600">${esc(p ? p.name : 'Clique sur ' + c.noun)}</span></div>
					<button class="cta ${c.cur.t === 'ban' ? 'ban' : ''}" data-action="confirm" ${p && !ui.busy ? '' : 'disabled'}>${esc(label + (p ? ' ' + p.name : ''))}</button></div>`;
		}
		else if (!sideStep) {
			footer = waitingHTML(c);
		}
		if (sideStep) footer = sidePanelHTML(c, false);
		el.innerHTML = `<div class="stack ${sideStep ? 'dim' : ''}" style="gap:16px">${head}${filters}
				<div id="pool" class="${c.isMaps ? 'maps' : 'heroes'} ${ui.enter ? 'enter' : ''}">${poolHTML(c)}</div></div>${footer}`;
	}

	function renderLog(c) {
		const items = c.log.map((e, i) => {
			let t;
			if (e.t === 'ban') t = `${teamName(e.team)} bannit ${item(e.id).name}`;
			else if (e.t === 'pick') t = `${teamName(e.team)} choisit ${item(e.id).name}`;
			else if (e.t === 'decider') t = `Carte décisive : ${item(e.id).name}`;
			else t = `${teamName(e.team)} prend le côté ${e.side}${e.mapId ? ' sur ' + item(e.mapId).name : ''}`;
			return `<li class="k-${e.t} ${tcls(e.team)} ${isNew(i) ? 'fx' : ''}">${esc(t)}</li>`;
		}).join('');
		const toss = c.s.coinToss ? `<span style="font-family:var(--f-body);font-weight:400;font-size:14px;color:var(--mu)">· pile ou face gagné par ${esc(teamName('A'))}</span>` : '';
		const empty = c.s.status === 'checkin' ? 'Le veto commencera dès que tout le monde sera présent.' : 'Aucune action.';
		$('#log').innerHTML = `<span class="disp" style="font-size:17px;font-weight:600">Historique ${toss}</span>
			${items ? `<ol>${items}</ol>` : `<div class="empty">${esc(empty)}</div>`}`;
	}

	function render() {
		if (!ui.state) return;
		const active = document.activeElement;
		const searchFocus = active && active.id === 'q' ? active.selectionStart : null;
		const c = ctx();
		renderHeader(c);
		renderTurn(c);
		renderRail(c);
		renderTeam(c, 'A');
		renderCenter(c);
		renderTeam(c, 'B');
		renderLog(c);
		if (searchFocus !== null && $('#q')) {
			$('#q').focus();
			$('#q').setSelectionRange(searchFocus, searchFocus);
		}
		else if (ui.stepChanged && c.cur && c.cur.t === 'side' && c.myTurn) {
			const first = document.querySelector('.sidepick .sbtn');
			if (first) first.focus();
		}
		// Les marqueurs d'animation ne valent que pour ce rendu.
		ui.fxFrom = Infinity;
		ui.enter = false;
		ui.stepChanged = false;
	}

	/* ---------------------------------------------------------------- état serveur */
	function applyState(data) {
		const len = data.veto ? data.veto.log.length : 0;
		const stepKey = `${data.status}:${len}`;
		ui.fxFrom = ui.prevLen !== null && len > ui.prevLen ? ui.prevLen : Infinity;
		ui.stepChanged = stepKey !== ui.prevStep;
		if (ui.stepChanged) ui.sel = null;
		if (data.status === 'veto' && ui.prevStatus !== 'veto') ui.enter = true;
		ui.clockOffset = data.serverNow - Date.now();
		ui.state = data;
		ui.prevLen = len;
		ui.prevStep = stepKey;
		ui.prevStatus = data.status;
		render();
	}

	function showError(message) {
		const box = $('#error');
		box.textContent = message || '';
		box.hidden = !message;
	}

	async function request(path, body) {
		const res = await fetch(api + path, {
			method: body ? 'POST' : 'GET',
			headers: { 'Content-Type': 'application/json', 'x-hub-token': token },
			body: body ? JSON.stringify(body) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
		return data;
	}

	async function send(path, body) {
		if (ui.busy) return;
		ui.busy = true;
		try {
			showError('');
			applyState(await request(path, body || {}));
		}
		catch (error) {
			showError(error.message);
		}
		finally {
			ui.busy = false;
		}
	}

	async function loadCatalog(gameId) {
		const res = await fetch(`/api/catalog/${encodeURIComponent(gameId)}`);
		if (!res.ok) return;
		ui.catalog = await res.json();
		ui.byId = {};
		ui.catalog.items.forEach(p => {
			ui.byId[p.id] = p;
		});
	}

	function listen() {
		const source = new EventSource(`${api}/stream?t=${encodeURIComponent(token)}`);
		source.onmessage = event => applyState(JSON.parse(event.data));
		source.onerror = () => {
			source.close();
			setTimeout(() => request('').then(applyState).catch(() => undefined).finally(listen), 3000);
		};
	}

	/* ---------------------------------------------------------------- événements */
	document.addEventListener('click', ev => {
		const btn = ev.target.closest('[data-action]');
		if (!btn || btn.disabled || !ui.state) return;
		const c = ctx();
		const v = btn.dataset.value;
		switch (btn.dataset.action) {
		case 'select':
			if (c.canAct) {
				ui.sel = v;
				render();
			}
			break;
		case 'confirm':
			if (c.canAct && ui.sel) send('/veto', { id: ui.sel });
			break;
		case 'side':
			send('/veto', { side: v });
			break;
		case 'undo':
			send('/undo');
			break;
		case 'filter':
			ui.filter = v;
			render();
			break;
		case 'win':
			send('/report', { winner: v });
			break;
		case 'checkin':
			send('/checkin');
			break;
		case 'cancel':
			if (confirm('Annuler le match pour les deux équipes ?')) send('/cancel');
			break;
		}
	});
	document.addEventListener('input', ev => {
		if (ev.target.dataset.action === 'query') {
			ui.query = ev.target.value;
			// ne re-rend que la grille : le champ garde le focus
			$('#pool').innerHTML = poolHTML(ctx());
		}
	});
	document.addEventListener('change', ev => {
		if (ev.target.dataset.action === 'motion') setMotion(ev.target.value, true);
	});
	// Image indisponible : on garde les initiales sur fond coloré
	document.addEventListener('error', ev => {
		if (ev.target.tagName === 'IMG' && ev.target.hasAttribute('data-fallback')) ev.target.remove();
	}, true);

	function setMotion(value, persist) {
		document.body.dataset.motion = value;
		document.body.className = 'motion-' + value;
		if (persist) {
			try {
				localStorage.setItem('pracchub-motion', value);
			}
			catch {
				// stockage indisponible (navigation privée) : réglage non mémorisé
			}
		}
	}

	/* ---------------------------------------------------------------- chrono */
	function updateTimer() {
		const t = $('#timer');
		if (!t || !ui.state) return;
		const s = ui.state;
		let left;
		let total = null;
		if (s.status === 'checkin') {
			left = s.checkinDeadline - now();
		}
		else if (s.status === 'veto' && s.veto) {
			total = s.veto.turnSeconds * 1000;
			left = s.veto.turnStartedAt + total - now();
		}
		else {
			return;
		}
		left = Math.max(0, left);
		const sec = Math.ceil(left / 1000);
		t.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
		t.classList.toggle('low', sec <= (total ? 5 : 60));
		const bar = $('#tbar');
		if (bar && total) bar.style.transform = `scaleX(${left / total})`;
	}
	setInterval(updateTimer, 1000);

	/* ---------------------------------------------------------------- démarrage */
	try {
		setMotion(localStorage.getItem('pracchub-motion') || 'normale', false);
	}
	catch {
		setMotion('normale', false);
	}

	request('')
		.then(async data => {
			await loadCatalog(data.game.id).catch(() => undefined);
			applyState(data);
			listen();
		})
		.catch(error => showError(error.message));
})();

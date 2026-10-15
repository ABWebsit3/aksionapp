/* eslint-env browser */
(function() {
	const matchId = location.pathname.split('/').filter(Boolean).pop();
	const token = new URLSearchParams(location.search).get('t');
	const api = `/api/matches/${matchId}`;

	const STATUS = {
		checkin: 'Check-in',
		veto: 'Pick & Ban',
		live: 'Match en cours',
		disputed: 'Résultat contesté',
		finished: 'Terminé',
		cancelled: 'Annulé',
	};
	const ACTIONS = {
		ban: 'Bannir une map',
		pick: 'Choisir une map',
		side: 'Choisir le côté',
		choice: 'Choisir',
	};

	let state = null;
	let countdownTimer = null;

	function el(tag, props, children) {
		const node = document.createElement(tag);
		Object.entries(props || {}).forEach(([key, value]) => {
			if (key === 'class') node.className = value;
			else if (key === 'text') node.textContent = value;
			else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
			else if (value !== false && value !== undefined) node.setAttribute(key, value === true ? '' : value);
		});
		(children || []).forEach(child => child && node.append(child));
		return node;
	}

	function showError(message) {
		const box = document.getElementById('error');
		box.textContent = message;
		box.hidden = !message;
	}

	async function request(path, body) {
		const res = await fetch(api + path, {
			method: body ? 'POST' : 'GET',
			headers: { 'Content-Type': 'application/json', 'x-hub-token': token || '' },
			body: body ? JSON.stringify(body) : undefined,
		});
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || 'Erreur inconnue');
		return data;
	}

	async function act(path, body) {
		try {
			showError('');
			render(await request(path, body || {}));
		}
		catch (error) {
			showError(error.message);
		}
	}

	const teamName = key => state.teams[key].name;

	function renderMeta() {
		const meta = document.getElementById('meta');
		meta.replaceChildren(
			el('span', { class: 'chip', text: state.game.name }),
			el('span', { class: 'chip', text: state.format.toUpperCase() }),
			el('span', { class: 'chip', text: state.type === 'scrim' ? 'Scrim' : 'Match' }),
			state.level ? el('span', { class: 'chip', text: state.level }) : null,
			el('span', { class: 'chip status', text: STATUS[state.status] || state.status }),
		);
	}

	function renderTeam(key) {
		const team = state.teams[key];
		const mine = state.viewer.team === key;
		return el('div', { class: `team ${key}${mine ? ' mine' : ''}` }, [
			el('h2', { text: team.name }),
			el('div', { class: 'count', text: `${team.checkedIn}/${state.size} joueurs check-in` }),
			el('ul', { class: 'players' }, team.members.map(m => el('li', { class: m.checkedIn ? 'in' : '' }, [
				el('span', { text: `${m.checkedIn ? '✔ ' : ''}${m.name}` }),
				m.captain ? el('span', { class: 'badge', text: 'Capitaine' }) : null,
			]))),
		]);
	}

	function renderVersus() {
		document.getElementById('versus').replaceChildren(renderTeam('A'), el('div', { class: 'vs', text: 'VS' }), renderTeam('B'));
	}

	function countdown(node) {
		clearInterval(countdownTimer);
		const tick = () => {
			const left = Math.max(0, state.checkinDeadline - Date.now());
			const min = Math.floor(left / 60000);
			const sec = Math.floor((left % 60000) / 1000).toString().padStart(2, '0');
			node.textContent = `Temps restant : ${min}:${sec}`;
		};
		tick();
		countdownTimer = setInterval(tick, 1000);
	}

	function stageCheckin() {
		const timer = el('p');
		countdown(timer);
		const v = state.viewer;
		return [
			el('h3', { text: 'Check-in' }),
			el('p', { text: `Chaque équipe doit avoir ${state.size} joueur(s) présent(s) pour lancer le pick & ban.` }),
			timer,
			el('div', { class: 'row' }, [
				v.team ? el('button', { class: 'primary', disabled: v.checkedIn, text: v.checkedIn ? 'Check-in confirmé ✔' : 'Je suis présent', onclick: () => act('/checkin') }) : null,
				v.captain ? el('button', { class: 'danger', text: 'Annuler le match', onclick: () => confirm('Annuler le match ?') && act('/cancel') }) : null,
			]),
		];
	}

	function stageVeto() {
		const step = state.veto.current;
		const myTurn = state.viewer.captain && state.viewer.team === step.team;
		const title = step.target ? `${ACTIONS[step.action]} sur ${step.target}` : (step.action === 'choice' ? state.veto.extraChoice.label : ACTIONS[step.action]);
		let hint = `En attente du capitaine de ${teamName(step.team)}…`;
		if (myTurn) hint = 'À toi de jouer, capitaine !';
		else if (state.viewer.team === step.team) hint = 'Ton capitaine est en train de choisir…';
		return [
			el('h3', {}, [el('span', { class: `turn-${step.team}`, text: teamName(step.team) }), document.createTextNode(` — ${title}`)]),
			el('p', { text: hint }),
			el('div', { class: 'options' }, step.options.map(option => el('button', {
				disabled: !myTurn,
				class: step.action === 'ban' ? 'danger' : '',
				text: option,
				onclick: () => act('/veto', { value: option }),
			}))),
		];
	}

	function stageLive() {
		const v = state.viewer;
		const reported = v.team && state.result.reports[v.team];
		const children = [
			el('h3', { text: state.status === 'disputed' ? 'Résultat contesté' : 'Bon match ! GL HF' }),
			el('p', { text: state.status === 'disputed'
				? 'Les capitaines ont déclaré des vainqueurs différents. Mettez-vous d\'accord et redéclarez, ou contactez un admin.'
				: 'À la fin du match, chaque capitaine déclare le vainqueur.' }),
		];
		if (v.captain) {
			children.push(el('div', { class: 'row' }, ['A', 'B'].map(key => el('button', {
				class: reported === key ? 'primary' : '',
				text: `Victoire : ${teamName(key)}`,
				onclick: () => act('/report', { winner: key }),
			}))));
			if (reported) children.push(el('p', { text: 'Résultat envoyé. En attente du capitaine adverse.' }));
		}
		return children;
	}

	function renderStage() {
		let children;
		switch (state.status) {
		case 'checkin': children = stageCheckin(); break;
		case 'veto': children = stageVeto(); break;
		case 'live':
		case 'disputed': children = stageLive(); break;
		case 'finished': children = [el('h3', { text: `🏆 Victoire de ${teamName(state.result.winner)}` }), el('p', { text: 'Résultat validé par les deux capitaines. GG !' })]; break;
		default: children = [el('h3', { text: 'Match annulé' }), el('p', { text: state.cancelReason || '' })];
		}
		if (state.status !== 'checkin') clearInterval(countdownTimer);
		document.getElementById('stage').replaceChildren(...children);
	}

	function renderMaps() {
		const container = document.getElementById('maps');
		const veto = state.veto;
		if (!veto) return container.replaceChildren();
		let cards;
		if (veto.mode === 'maps') {
			cards = veto.maps.map((m, i) => el('div', { class: 'map-card' }, [
				el('div', { class: 'label', text: `Map ${i + 1} — ${m.pickedBy ? `pick ${teamName(m.pickedBy)}` : 'décisive'}` }),
				el('div', { class: 'name', text: m.map }),
				el('div', { class: 'side', text: m.side ? `${teamName(m.side.team)} : ${m.side.value}` : 'Côté à choisir' }),
			]));
		}
		else {
			const { side, extra } = veto.choices;
			cards = [
				side ? el('div', { class: 'map-card' }, [el('div', { class: 'label', text: 'Côté' }), el('div', { class: 'name', text: side.value }), el('div', { class: 'side', text: teamName(side.team) })]) : null,
				extra ? el('div', { class: 'map-card' }, [el('div', { class: 'label', text: veto.extraChoice.label }), el('div', { class: 'name', text: extra.value }), el('div', { class: 'side', text: teamName(extra.team) })]) : null,
			];
		}
		container.replaceChildren(...cards.filter(Boolean));
	}

	function renderHistory() {
		const container = document.getElementById('history');
		const veto = state.veto;
		if (!veto || !veto.history.length) return container.replaceChildren();
		const verbs = { ban: 'bannit', pick: 'choisit', side: 'prend le côté', choice: 'choisit', decider: 'Map décisive :' };
		container.replaceChildren(
			el('h4', { text: `Historique (pile ou face gagné par ${teamName(veto.firstTeam)})` }),
			el('ol', {}, veto.history.map(h => el('li', {
				class: h.action,
				text: h.team ? `${teamName(h.team)} ${verbs[h.action]} ${h.value}` : `${verbs[h.action]} ${h.value}`,
			}))),
		);
	}

	function render(data) {
		state = data;
		renderMeta();
		renderVersus();
		renderStage();
		renderMaps();
		renderHistory();
	}

	function listen() {
		const source = new EventSource(`${api}/stream?t=${encodeURIComponent(token || '')}`);
		source.onmessage = event => render(JSON.parse(event.data));
		source.onerror = () => {
			source.close();
			setTimeout(() => request('').then(render).catch(() => undefined).finally(listen), 3000);
		};
	}

	request('')
		.then(data => {
			render(data);
			listen();
		})
		.catch(error => showError(error.message));
})();

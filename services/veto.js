/**
 * Moteur de pick & ban. Fonctions pures : l'état du veto est un objet JSON sérialisable.
 *
 * Les étapes référencent 'first' / 'second' (gagnant / perdant du pile ou face),
 * résolus en 'A' / 'B' via veto.firstTeam.
 */

function mapSteps(poolSize, format) {
	const steps = [];
	let remaining = poolSize;
	const pushBans = (count, startWith) => {
		let by = startWith;
		for (let i = 0; i < count; i++) {
			steps.push({ by, action: 'ban' });
			by = by === 'first' ? 'second' : 'first';
			remaining--;
		}
		return by === 'first' ? 'second' : 'first';
	};

	if (format === 'bo3') {
		if (poolSize < 3) throw new Error('Il faut au moins 3 maps pour un BO3');
		const initialBans = Math.min(2, poolSize - 3);
		pushBans(initialBans, 'first');
		steps.push({ by: 'first', action: 'pick' });
		steps.push({ by: 'second', action: 'side' });
		steps.push({ by: 'second', action: 'pick' });
		steps.push({ by: 'first', action: 'side' });
		remaining -= 2;
	}
	else if (format !== 'bo1') {
		throw new Error(`Format non supporté pour un veto de maps : ${format}`);
	}

	const lastBanner = pushBans(remaining - 1, 'first');
	steps.push({ by: null, action: 'decider' });
	// Le côté de la décisive revient à l'équipe qui n'a pas fait le dernier ban
	steps.push({ by: lastBanner === 'first' ? 'second' : 'first', action: 'side' });
	return steps;
}

function sideSteps(game) {
	const steps = [{ by: 'first', action: 'side' }];
	if (game.extraChoice) steps.push({ by: 'second', action: 'choice' });
	return steps;
}

function createVeto(game, format, firstTeam) {
	if (!['A', 'B'].includes(firstTeam)) throw new Error('firstTeam doit valoir A ou B');
	const isMaps = game.veto === 'maps';
	const veto = {
		mode: game.veto,
		format,
		firstTeam,
		steps: isMaps ? mapSteps(game.maps.length, format) : sideSteps(game),
		remaining: isMaps ? [...game.maps] : [],
		sides: game.sides,
		extraChoice: game.extraChoice || null,
		maps: [],
		history: [],
		choices: {},
		done: false,
	};
	return autoAdvance(veto);
}

function resolveTeam(veto, by) {
	if (!by) return null;
	if (by === 'first') return veto.firstTeam;
	return veto.firstTeam === 'A' ? 'B' : 'A';
}

function currentStep(veto) {
	if (veto.done) return null;
	const step = veto.steps[veto.history.length];
	const team = resolveTeam(veto, step.by);
	let options;
	switch (step.action) {
	case 'ban':
	case 'pick':
		options = [...veto.remaining];
		break;
	case 'side':
		options = [...veto.sides];
		break;
	case 'choice':
		options = [...veto.extraChoice.options];
		break;
	default:
		options = [];
	}
	const target = step.action === 'side' && veto.mode === 'maps' ? veto.maps[veto.maps.length - 1].map : null;
	return { index: veto.history.length, team, action: step.action, options, target };
}

function autoAdvance(veto) {
	while (!veto.done) {
		const step = veto.steps[veto.history.length];
		if (!step) {
			veto.done = true;
			break;
		}
		if (step.action !== 'decider') break;
		const map = veto.remaining.shift();
		veto.maps.push({ map, pickedBy: null, side: null });
		veto.history.push({ team: null, action: 'decider', value: map });
	}
	return veto;
}

/**
 * Applique l'action d'une équipe. Retourne un nouvel état (l'original n'est pas modifié).
 */
function applyAction(state, team, value) {
	const veto = JSON.parse(JSON.stringify(state));
	const step = currentStep(veto);
	if (!step) throw new Error('Le veto est terminé');
	if (step.team !== team) throw new Error('Ce n\'est pas au tour de ton équipe');
	if (!step.options.includes(value)) throw new Error(`Choix invalide : ${value}`);

	switch (step.action) {
	case 'ban':
		veto.remaining = veto.remaining.filter(m => m !== value);
		break;
	case 'pick':
		veto.remaining = veto.remaining.filter(m => m !== value);
		veto.maps.push({ map: value, pickedBy: team, side: null });
		break;
	case 'side':
		if (veto.mode === 'maps') {
			veto.maps[veto.maps.length - 1].side = { team, value };
		}
		else {
			veto.choices.side = { team, value };
		}
		break;
	case 'choice':
		veto.choices.extra = { team, value };
		break;
	}
	veto.history.push({ team, action: step.action, value });
	return autoAdvance(veto);
}

module.exports = { createVeto, currentStep, applyAction, mapSteps };

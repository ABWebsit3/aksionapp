const path = require('node:path');
const express = require('express');
const { verifyToken } = require('../services/hubToken');
const { matchEvents, getMatch, checkIn, vetoAction, undoVeto, reportResult, cancelMatch, publicView } = require('../services/matchService');
const { getCatalog } = require('../services/catalog');
const { GAMES } = require('../config/games');

function createApp() {
	const app = express();
	app.use(express.json());
	app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
	// Moteur de pick & ban partagé avec le navigateur
	app.get('/static/pickban-core.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'services', 'pickban-core.js')));

	app.get('/api/catalog/:game', (req, res) => {
		if (!GAMES[req.params.game]) return res.status(404).json({ error: 'Jeu inconnu' });
		res.set('Cache-Control', 'public, max-age=600').json(getCatalog(req.params.game));
	});

	app.get('/hub/:matchId', (req, res) => {
		res.sendFile(path.join(__dirname, 'public', 'hub.html'));
	});

	// Authentification : token signé passé en en-tête (fetch) ou en query (EventSource)
	const auth = async (req, res, next) => {
		const token = req.get('x-hub-token') || req.query.t;
		const viewer = verifyToken(token, req.params.matchId);
		if (!viewer) return res.status(401).json({ error: 'Lien invalide ou expiré. Redemande un lien depuis Discord.' });
		const match = await getMatch(req.params.matchId);
		if (!match) return res.status(404).json({ error: 'Match introuvable' });
		req.viewer = viewer;
		req.match = match;
		next();
	};

	const action = handler => async (req, res) => {
		try {
			const match = await handler(req);
			res.json(publicView(match, req.viewer.userId));
		}
		catch (error) {
			res.status(400).json({ error: error.message });
		}
	};

	app.get('/api/matches/:matchId', auth, (req, res) => {
		res.json(publicView(req.match, req.viewer.userId));
	});

	app.post('/api/matches/:matchId/checkin', auth, action(req => checkIn(req.match.id, req.viewer.userId)));
	app.post('/api/matches/:matchId/veto', auth, action(req => vetoAction(req.match.id, req.viewer.userId, { id: req.body.id, side: req.body.side })));
	app.post('/api/matches/:matchId/undo', auth, action(req => undoVeto(req.match.id, req.viewer.userId)));
	app.post('/api/matches/:matchId/report', auth, action(req => reportResult(req.match.id, req.viewer.userId, req.body.winner)));
	app.post('/api/matches/:matchId/cancel', auth, action(req => cancelMatch(req.match.id, 'Annulé par un capitaine depuis le hub.', req.viewer.userId)));

	// Mises à jour en temps réel (Server-Sent Events)
	app.get('/api/matches/:matchId/stream', auth, (req, res) => {
		res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
		res.flushHeaders();
		const send = match => {
			if (match.id === req.match.id) res.write(`data: ${JSON.stringify(publicView(match, req.viewer.userId))}\n\n`);
		};
		const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
		matchEvents.on('update', send);
		req.on('close', () => {
			clearInterval(keepAlive);
			matchEvents.off('update', send);
		});
	});

	return app;
}

function startWebServer(port = process.env.PORT || 3000) {
	const app = createApp();
	return app.listen(port, () => console.log(`Hub web disponible sur le port ${port}`));
}

module.exports = { createApp, startWebServer };

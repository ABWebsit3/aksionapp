const crypto = require('node:crypto');

/**
 * Lien personnel vers le hub : chaque joueur reçoit un token signé (HMAC) qui
 * l'identifie pour un match donné. Pas besoin d'OAuth Discord pour le MVP.
 */

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function secret() {
	const value = process.env.HUB_SECRET;
	if (!value) throw new Error('HUB_SECRET manquant dans le .env');
	return value;
}

function sign(payload) {
	return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function createToken(matchId, userId, ttlMs = DEFAULT_TTL_MS) {
	const payload = Buffer.from(JSON.stringify({ m: matchId, u: userId, e: Date.now() + ttlMs })).toString('base64url');
	return `${payload}.${sign(payload)}`;
}

function verifyToken(token, matchId) {
	if (typeof token !== 'string' || !token.includes('.')) return null;
	const [payload, signature] = token.split('.');
	const expected = sign(payload);
	const a = Buffer.from(signature);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
		if (data.m !== matchId || data.e < Date.now()) return null;
		return { matchId: data.m, userId: data.u };
	}
	catch {
		return null;
	}
}

function hubUrl(matchId, userId) {
	const base = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
	return `${base}/hub/${matchId}?t=${createToken(matchId, userId)}`;
}

module.exports = { createToken, verifyToken, hubUrl };

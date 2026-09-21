import rateLimit from 'express-rate-limit';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 100;
const workerHits = new Map();
let nodeRateLimit;

function cloudflareRateLimit(req, res, next) {
	const now = Date.now();
	const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
	const current = workerHits.get(key);
	const hit = !current || now - current.startedAt >= WINDOW_MS
		? { startedAt: now, count: 1 }
		: { ...current, count: current.count + 1 };
	workerHits.set(key, hit);

	// Bound memory without timers; expired entries are removed during requests.
	if (workerHits.size > 2000) {
		for (const [ip, entry] of workerHits) {
			if (now - entry.startedAt >= WINDOW_MS) workerHits.delete(ip);
		}
	}

	res.setHeader('RateLimit-Limit', String(MAX_REQUESTS));
	res.setHeader('RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - hit.count)));
	if (hit.count > MAX_REQUESTS) {
		res.setHeader('Retry-After', String(Math.ceil((WINDOW_MS - (now - hit.startedAt)) / 1000)));
		return res.status(429).json({ error: 'Too many requests, please try again later' });
	}
	return next();
}

export const globalRateLimit = (req, res, next) => {
	if (process.env.CLOUDFLARE_WORKERS === 'true') return cloudflareRateLimit(req, res, next);
	nodeRateLimit ||= rateLimit({
		windowMs: WINDOW_MS,
		max: MAX_REQUESTS,
		standardHeaders: true,
		legacyHeaders: false,
		message: { error: 'Too many requests, please try again later' },
		validate: { trustProxy: false },
	});
	return nodeRateLimit(req, res, next);
};

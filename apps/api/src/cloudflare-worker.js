import { httpServerHandler } from 'cloudflare:node';
import app from './app.js';

const port = 3001;
app.listen(port);
const expressHandler = httpServerHandler({ port });

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const apiPrefix = '/hcgi/api';
		if (!url.pathname.startsWith(`${apiPrefix}/`) && url.pathname !== apiPrefix) {
			return new Response('Not found', { status: 404 });
		}
		url.pathname = url.pathname.slice(apiPrefix.length) || '/';
		return expressHandler.fetch(new Request(url, request), env, ctx);
	},
};

import { env } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import createApp from '../app.js';
import { createDatabase } from './database.mjs';
import { createIcons } from './icons.mjs';
import { render } from '../dist/templates.mjs';

const app = createApp({
  db: createDatabase(env.DB), icons: createIcons(env.DB),
  adminPin: env.ADMIN_PIN, baseUrl: env.BASE_URL, render, hosted: true,
});
app.listen(3000);
const server = httpServerHandler({ port: 3000 });
export default {
  async fetch(request, bindings, ctx) {
    const url = new URL(request.url);
    const versionedIcon = request.method === 'GET' && /^\/uploads\/teams\/team-\d+$/.test(url.pathname) && url.searchParams.has('v');
    if (versionedIcon) {
      const cached = await caches.default.match(request);
      if (cached) return cached;
    }
    const response = await server.fetch(request, bindings, ctx);
    if (versionedIcon && response.ok) ctx.waitUntil(caches.default.put(request, response.clone()));
    return response;
  },
};

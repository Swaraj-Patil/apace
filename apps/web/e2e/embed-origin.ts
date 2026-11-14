// The origin seeded embeds point at, served on its own port so everything it sends is
// cross-origin to the app.
//
// Nothing here sends Cross-Origin-Resource-Policy or Cross-Origin-Embedder-Policy, which is the
// point: if the app ever asked for cross-origin isolation, the browser would refuse every
// picture and frame this server offers, and the end-to-end suite would fail.
import { createServer, type Server } from 'node:http';
import { parseArgs } from 'node:util';
import { EMBED_ORIGIN, EMBED_PAGES } from '@apace/seed';

/** A small picture, for an `<img>` that has to come from another origin. */
export const IMAGE_PATH = '/picture.svg';
/** Where the embed pages live. The seed writes exactly these paths into embed blocks. */
export const embedPath = (number: number): string => `/embed/${number}.html`;

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#2f6f4f"/><circle cx="160" cy="90" r="64" fill="#e8d9a0"/></svg>`;

function embedPage(number: number): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Embed ${number}</title></head>
<body><h1>Embed ${number}</h1><p>Served from ${EMBED_ORIGIN}.</p></body>
</html>
`;
}

/** What a path serves, or null when it names nothing. */
function bodyFor(path: string): { type: string; body: string } | null {
  if (path === IMAGE_PATH) return { type: 'image/svg+xml', body: PICTURE };
  const embed = /^\/embed\/(\d+)\.html$/.exec(path);
  const number = Number(embed?.[1]);
  if (embed === null || number < 1 || number > EMBED_PAGES) return null;
  return { type: 'text/html; charset=utf-8', body: embedPage(number) };
}

export function serveEmbedOrigin(port: number, host = '127.0.0.1'): Promise<Server> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', EMBED_ORIGIN).pathname;
    const found = bodyFor(path);
    if (found === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    response
      .writeHead(200, { 'content-type': found.type, 'cache-control': 'no-store' })
      .end(found.body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: 'string' } } });
  const port = Number(values.port ?? new URL(EMBED_ORIGIN).port);
  await serveEmbedOrigin(port);
  console.log(`Serving ${EMBED_PAGES} embed pages and ${IMAGE_PATH} at ${EMBED_ORIGIN}/`);
}

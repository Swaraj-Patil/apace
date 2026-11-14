// A static server for production and bench builds that serves them the way Vercel serves the
// deployed site: files first, then the rewrites and headers in vercel.json. It refuses any
// setting it doesn't implement, so serving locally can't quietly differ from the real host.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** What Vercel sends for a static file that no header rule overrides. */
const DEFAULT_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

/**
 * The web app's Vercel configuration. The Vercel project's Root Directory is apps/web, and
 * Vercel reads vercel.json from there.
 */
export const VERCEL_CONFIG = fileURLToPath(new URL('../apps/web/vercel.json', import.meta.url));

/** Settings that only shape the build, so a server can ignore them. */
const BUILD_SETTINGS = new Set([
  '$schema',
  'framework',
  'installCommand',
  'buildCommand',
  'outputDirectory',
]);

export interface HostRules {
  readonly rewrites: readonly { readonly source: URLPattern; readonly destination: string }[];
  readonly headers: readonly {
    readonly source: URLPattern;
    readonly headers: readonly (readonly [string, string])[];
  }[];
}

function unsupported(what: string): never {
  throw new Error(`bench/serve.ts doesn't implement ${what} from vercel.json`);
}

function onlyKeys(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) unsupported(`a ${what} that isn't an object`);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) unsupported(`"${key}" in a ${what}`);
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) unsupported(`${what} that aren't a list`);
  return value;
}

function pattern(source: unknown): URLPattern {
  if (typeof source !== 'string') unsupported("a source that isn't a string");
  return new URLPattern({ pathname: source });
}

/** The rewrites and headers of a vercel.json, ready to match request paths against. */
export function hostRules(config: unknown): HostRules {
  const settings = onlyKeys(config, [...BUILD_SETTINGS, 'rewrites', 'headers'], 'configuration');
  return {
    rewrites: list(settings.rewrites, 'rewrites').map((entry) => {
      const rule = onlyKeys(entry, ['source', 'destination'], 'rewrite');
      // A rewrite here serves one file, so it can't substitute parameters or leave the site.
      if (typeof rule.destination !== 'string' || !/^\/[^:$]*$/.test(rule.destination)) {
        unsupported(`the rewrite destination ${JSON.stringify(rule.destination)}`);
      }
      return { source: pattern(rule.source), destination: rule.destination };
    }),
    headers: list(settings.headers, 'headers').map((entry) => {
      const rule = onlyKeys(entry, ['source', 'headers'], 'header rule');
      return {
        source: pattern(rule.source),
        headers: list(rule.headers, 'headers').map((header) => {
          const { key, value } = onlyKeys(header, ['key', 'value'], 'header');
          if (typeof key !== 'string' || typeof value !== 'string') {
            unsupported("a header whose key or value isn't a string");
          }
          return [key.toLowerCase(), value] as const;
        }),
      };
    }),
  };
}

export async function readHostRules(path = VERCEL_CONFIG): Promise<HostRules> {
  return hostRules(JSON.parse(await readFile(path, 'utf8')));
}

export function serveStatic(
  rootDir: string,
  port: number,
  rules: HostRules,
  host = '127.0.0.1',
): Promise<Server> {
  const root = resolve(rootDir);
  /** The file a path names, with a directory standing for its index.html. */
  const fileAt = async (path: string): Promise<{ file: string; size: number } | null> => {
    try {
      let file = join(root, path);
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file);
      }
      return info.isFile() ? { file, size: info.size } : null;
    } catch {
      return null;
    }
  };

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const target = join(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    // Files take precedence, and only a path that names none is rewritten.
    let found = await fileAt(path);
    if (found === null) {
      const rewrite = rules.rewrites.find((rule) => rule.source.test({ pathname: path }));
      if (rewrite !== undefined) found = await fileAt(rewrite.destination);
    }
    if (found === null) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const headers: Record<string, string | number> = {
      'content-type': CONTENT_TYPES[extname(found.file)] ?? 'application/octet-stream',
      'content-length': found.size,
      'cache-control': DEFAULT_CACHE_CONTROL,
    };
    for (const rule of rules.headers) {
      if (!rule.source.test({ pathname: path })) continue;
      for (const [key, value] of rule.headers) headers[key] = value;
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') response.end();
    else createReadStream(found.file).pipe(response);
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveServer(server));
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, port: { type: 'string' } } });
  if (values.root === undefined || values.port === undefined) {
    console.error('Usage: node bench/serve.ts --root <dir> --port <port>');
    process.exit(2);
  }
  await serveStatic(values.root, Number(values.port), await readHostRules());
  console.log(
    `Serving ${values.root} at http://127.0.0.1:${values.port}/ with vercel.json's rules`,
  );
}

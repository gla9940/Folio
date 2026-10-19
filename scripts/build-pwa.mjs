import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const template = await readFile(new URL('../pwa/sw-template.js', import.meta.url), 'utf8');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function createServiceWorker(files) {
  const entries = [...files].filter(([path]) => path === '/index.html' || path === '/manifest.webmanifest' || /^\/icons\/[^/]+\.(png|svg)$/.test(path) || /^\/assets\/[^/]+\.(js|css|woff2)$/.test(path)).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.some(([path]) => path === '/index.html')) throw Error('PWA index.html missing');
  const bytes = entries.reduce((sum, [, data]) => sum + data.length, 0);
  if (bytes > 6 * 1024 * 1024) throw Error('App-only offline cache exceeds 6MB; review build assets.');
  const precache = entries.map(([url, data]) => ({url, revision: digest(data)}));
  const version = digest(JSON.stringify(precache) + template).slice(0, 20);
  return {version, bytes, count: entries.length, source: `const VERSION = ${JSON.stringify(version)};\nconst PRECACHE = ${JSON.stringify(precache)};\n${template}`};
}
export async function readBuild(directory) {
  const root = resolve(directory), files = new Map();
  async function visit(path) {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else files.set('/' + relative(root, full).replaceAll('\\', '/'), await readFile(full));
    }
  }
  await visit(root); return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const build = createServiceWorker(await readBuild('dist'));
  await writeFile('dist/sw.js', build.source);
  console.log(`PWA ${build.version}: ${build.count} app files, ${(build.bytes / 1024 / 1024).toFixed(2)} MiB`);
}

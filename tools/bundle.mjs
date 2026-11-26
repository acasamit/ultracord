// Bundles plugins/<name>/src/index.ts into dist/plugins/<name>.js the way Sunbird bundles its own
// (esbuild IIFE, es2023, the leading `// @` lines kept as a banner) and writes the catalog files
// that assets.ultracord.dev serves:
//   plugins/index.json  every plugin with its metadata, access list and checksums
//   version.json        { plugins: { name: crc32 } }, the shape Sunbird's update check reads
// Bundles are not minified, so anyone can read exactly what they install.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { build } from 'esbuild';
import { forbiddenIn, inspect, listPlugins, pluginsDir, root, takenNames } from './plugins.mjs';

const ASSETS = 'https://assets.ultracord.dev/';
const dist = join(root, 'dist');
const out = join(dist, 'plugins');

await rm(dist, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const taken = await takenNames();
const index = [];
const crcs = {};

for (const name of await listPlugins()) {
  const plugin = await inspect(name, taken);
  if (plugin.errors.length) {
    console.error(`${name}: run "npm run check" first\n  ${plugin.errors.join('\n  ')}`);
    process.exit(1);
  }

  const file = join(out, `${name}.js`);
  await build({
    entryPoints: [join(pluginsDir, name, 'src', 'index.ts')],
    outfile: file,
    bundle: true,
    format: 'iife',
    target: 'es2023',
    legalComments: 'inline',
    logLevel: 'warning',
    banner: { js: plugin.banner },
  });

  const bytes = await readFile(file);
  const bundled = forbiddenIn(bytes.toString('utf8'));
  if (bundled.length) {
    console.error(`${name}: the bundle contains forbidden code (${bundled.join(', ')})`);
    process.exit(1);
  }

  crcs[name] = crc32(bytes);
  const { description, version, author, warning } = plugin.fields;
  index.push({
    name,
    description,
    version,
    author,
    ...(warning ? { warning } : {}),
    url: `${ASSETS}plugins/${name}.js`,
    access: plugin.access,
    domains: plugin.domains,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

await writeFile(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
await writeFile(join(dist, 'version.json'), JSON.stringify({ plugins: crcs }, null, 2) + '\n');
await writeFile(join(dist, '.nojekyll'), '');
await writeFile(join(dist, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>Ultracord assets</title>' +
  '<meta http-equiv="refresh" content="0; url=https://ultracord.dev/">' +
  '<p>Plugin files for <a href="https://ultracord.dev/">Ultracord</a>.</p>\n');

console.log(`bundled ${index.map((p) => `${p.name}@${p.version}`).join(', ') || 'nothing'}`);

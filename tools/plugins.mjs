// Shared helpers for check.mjs and bundle.mjs: plugin discovery, header parsing and the
// static scan that decides what a reviewer has to look at.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const pluginsDir = join(root, 'plugins');

export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Sunbird installs a bundle under its file name, so a plugin named like one of Sunbird's own
// would replace it. Names are checked against Sunbird's live list, or this copy when offline.
const SUNBIRD_LIST = 'https://assets.sunbird.tools/plugins/index.json';
const SUNBIRD_FALLBACK = [
  'clear-urls', 'dearrow', 'example', 'fakenitro', 'fix-embeds', 'global-badges',
  'hide-composer-buttons', 'message-latency', 'message-logger', 'no-profile-themes',
  'no-reply-mention', 'reviewdb', 'silent-typing', 'spoiler-mode', 'taptap', 'text-replace',
  'translate', 'view-raw',
];

/** Names Ultracord plugins cannot use. */
export async function takenNames() {
  const names = new Set(SUNBIRD_FALLBACK);
  try {
    const res = await fetch(SUNBIRD_LIST);
    if (res.ok) for (const plugin of await res.json()) if (typeof plugin?.name === 'string') names.add(plugin.name);
  } catch {
    console.warn(`could not read ${SUNBIRD_LIST}, using the built-in list of Sunbird plugins`);
  }
  return names;
}
const SEMVER = /^\d+\.\d+\.\d+$/;
const REQUIRED = ['description', 'version', 'author'];

// Patterns that run code the reviewer never saw. A plugin containing one is rejected.
const FORBIDDEN = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/(?<![\w.$]|new\s+)Function\s*\(/, 'Function()'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/, 'string passed to setTimeout/setInterval'],
  [/https?:\/\/[^\s'"`]+\.m?js(?:[?#][^\s'"`]*)?['"`]/, 'URL of a remote script'],
  [/\bphoenix\.native\b/, 'phoenix.native (debug console only)'],
];

// What a plugin can reach. Shown on the store page and in the PR summary, never blocking.
const ACCESS = [
  [/\bphoenix\.fetch\s*\(/, 'network'],
  [/\bphoenix\.discord\.(?:onRequest|onResponse)\b/, 'intercepts-discord-api'],
  [/\bphoenix\.discord\b/, 'discord-api'],
  [/\bphoenix\.messages\.onSend\b/, 'edits-outgoing-messages'],
  [/\bphoenix\.stores\b/, 'reads-local-cache'],
  [/\bphoenix\.bridge\b/, 'native-bridge'],
];

export async function listPlugins() {
  const names = [];
  for (const entry of (await readdir(pluginsDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    try {
      await stat(join(pluginsDir, entry.name, 'src', 'index.ts'));
      names.push(entry.name);
    } catch {
      // Not a plugin folder.
    }
  }
  return names;
}

async function sources(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sources(path)));
    else if (/\.(?:ts|js|mjs|json)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** The leading `// @key value` lines of a plugin entry file. */
export function parseHeader(source) {
  const lines = source.split(/\r?\n/);
  const end = lines.findIndex((line) => !line.startsWith('// @'));
  const banner = lines.slice(0, end === -1 ? lines.length : end);
  const fields = {};
  for (const line of banner) {
    const match = /^\/\/ @(\w+)(?:\s+(.*))?$/.exec(line);
    if (match) fields[match[1]] = (match[2] ?? '').trim();
  }
  return { banner: banner.join('\n'), fields };
}

export function forbiddenIn(code) {
  return FORBIDDEN.filter(([pattern]) => pattern.test(code)).map(([, label]) => label);
}

function accessIn(code) {
  const found = new Set(ACCESS.filter(([pattern]) => pattern.test(code)).map(([, label]) => label));
  if (found.has('intercepts-discord-api')) found.delete('discord-api');
  const domains = new Set();
  for (const match of code.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) domains.add(match[1].toLowerCase());
  return { access: [...found], domains: [...domains].sort() };
}

/** Reads and scans one plugin. `errors` block the merge, the rest guides the review. */
export async function inspect(name, taken = new Set()) {
  const dir = join(pluginsDir, name);
  const entry = await readFile(join(dir, 'src', 'index.ts'), 'utf8');
  const { banner, fields } = parseHeader(entry);
  const errors = [];

  if (!NAME.test(name)) errors.push(`folder name must be lowercase words joined by dashes (got "${name}")`);
  if (taken.has(name)) errors.push(`"${name}" is the name of a Sunbird plugin, which this one would replace`);
  for (const key of REQUIRED) if (!fields[key]) errors.push(`missing "// @${key}" header line`);
  if (fields.version && !SEMVER.test(fields.version)) errors.push(`@version must look like 1.2.3 (got "${fields.version}")`);

  let code = '';
  for (const file of await sources(dir)) code += `\n${await readFile(file, 'utf8')}`;
  for (const label of forbiddenIn(code)) errors.push(`forbidden: ${label}`);

  return { name, banner, fields, errors, ...accessIn(code) };
}

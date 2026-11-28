// Validates every plugin (folder name, header, forbidden patterns) and every theme (header,
// variables, readability), and prints what each plugin can reach. In GitHub Actions the report
// also lands in the job summary, so a reviewer sees it on the PR.
// These checks are a first filter: a human still reads every line before a merge.
import { appendFile } from 'node:fs/promises';
import { inspect, listPlugins, takenNames } from './plugins.mjs';
import { inspectTheme, listThemes } from './themes.mjs';

const taken = await takenNames();
const results = await Promise.all((await listPlugins()).map((name) => inspect(name, taken)));
const themes = await Promise.all((await listThemes()).map((name) => inspectTheme(name)));
let failed = false;
const rows = [];
const themeRows = [];

for (const plugin of results) {
  const status = plugin.errors.length ? 'FAIL' : 'ok';
  failed ||= plugin.errors.length > 0;
  console.log(`${status.padEnd(4)} ${plugin.name} ${plugin.fields.version ?? ''}`);
  for (const error of plugin.errors) console.log(`     - ${error}`);
  if (plugin.access.length) console.log(`     access: ${plugin.access.join(', ')}`);
  if (plugin.domains.length) console.log(`     domains: ${plugin.domains.join(', ')}`);
  rows.push(`| ${plugin.name} | ${plugin.fields.version ?? ''} | ${status} | ${plugin.access.join(', ') || 'none'} | ${plugin.domains.join(', ') || 'none'} |`);
}

for (const theme of themes) {
  const status = theme.errors.length ? 'FAIL' : 'ok';
  failed ||= theme.errors.length > 0;
  console.log(`${status.padEnd(4)} theme ${theme.name} ${theme.fields.version ?? ''}`);
  for (const error of theme.errors) console.log(`     - ${error}`);
  for (const warning of theme.warnings) console.log(`     ! ${warning}`);
  themeRows.push(`| ${theme.name} | ${theme.fields.version ?? ''} | ${status} | ${Object.keys(theme.values).map((v) => `\`--${v}\``).join(' ') || 'none'} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const errors = [
    ...results.flatMap((p) => p.errors.map((e) => `- \`${p.name}\`: ${e}`)),
    ...themes.flatMap((t) => t.errors.map((e) => `- theme \`${t.name}\`: ${e}`)),
  ];
  const warnings = themes.flatMap((t) => t.warnings.map((w) => `- theme \`${t.name}\`: ${w}`));
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    '## Plugin review report',
    '',
    '| Plugin | Version | Checks | Access | Domains |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...(themeRows.length
      ? ['## Themes', '', '| Theme | Version | Checks | Sets |', '|---|---|---|---|', ...themeRows, '']
      : []),
    ...(errors.length ? ['### Errors', '', ...errors, ''] : []),
    ...(warnings.length ? ['### Warnings', '', ...warnings, ''] : []),
  ].join('\n') + '\n');
}

if (!results.length) console.log('no plugins found');
process.exit(failed ? 1 : 0);

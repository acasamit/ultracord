// Validates every plugin (folder name, header, forbidden patterns) and prints what each one can
// reach. In GitHub Actions the report also lands in the job summary, so a reviewer sees it on the PR.
// These checks are a first filter: a human still reads every line before a merge.
import { appendFile } from 'node:fs/promises';
import { inspect, listPlugins, takenNames } from './plugins.mjs';

const taken = await takenNames();
const results = await Promise.all((await listPlugins()).map((name) => inspect(name, taken)));
let failed = false;
const rows = [];

for (const plugin of results) {
  const status = plugin.errors.length ? 'FAIL' : 'ok';
  failed ||= plugin.errors.length > 0;
  console.log(`${status.padEnd(4)} ${plugin.name} ${plugin.fields.version ?? ''}`);
  for (const error of plugin.errors) console.log(`     - ${error}`);
  if (plugin.access.length) console.log(`     access: ${plugin.access.join(', ')}`);
  if (plugin.domains.length) console.log(`     domains: ${plugin.domains.join(', ')}`);
  rows.push(`| ${plugin.name} | ${plugin.fields.version ?? ''} | ${status} | ${plugin.access.join(', ') || 'none'} | ${plugin.domains.join(', ') || 'none'} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const errors = results.flatMap((p) => p.errors.map((e) => `- \`${p.name}\`: ${e}`));
  await appendFile(process.env.GITHUB_STEP_SUMMARY, [
    '## Plugin review report',
    '',
    '| Plugin | Version | Checks | Access | Domains |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...(errors.length ? ['### Errors', '', ...errors, ''] : []),
  ].join('\n') + '\n');
}

if (!results.length) console.log('no plugins found');
process.exit(failed ? 1 : 0);

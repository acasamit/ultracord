// Writes dist/themes/stats.json after a build: how many times each theme was downloaded from the
// site, and how many comments and reactions its giscus thread has, so the site can show and sort
// them with one request. Run by the deploy workflow with its GITHUB_TOKEN:
//   downloads  the `themes` release's assets, one per version, added up per theme
//   comments   the thread `theme:<name>` in the "Theme comments" discussions, replies included
//   reactions  the reactions on that thread, which giscus shows above the comments
// A source that cannot be read is left out of the file instead of showing zeros.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './plugins.mjs';

const OWNER = 'acasamit';
const REPO = 'ultracord';
const CATEGORY = 'theme-comments';
const ASSET = /^([a-z0-9]+(?:-[a-z0-9]+)*)-\d+\.\d+\.\d+\.theme\.css$/;

const token = process.env.GITHUB_TOKEN;
const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'ultracord-stats',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};
const dir = join(root, 'dist', 'themes');
const names = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')).map((t) => t.name);
const themes = Object.fromEntries(names.map((name) => [name, {}]));

async function downloads() {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/themes`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  for (const name of names) themes[name].downloads = 0;
  for (const asset of (await res.json()).assets ?? []) {
    const theme = themes[ASSET.exec(asset.name)?.[1]];
    if (theme) theme.downloads += asset.download_count;
  }
}

async function graphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors ?? res.status));
  return body.data.repository;
}

async function discussions() {
  if (!token) throw new Error('no GITHUB_TOKEN');
  const category = (await graphql(
    'query($owner: String!, $repo: String!, $slug: String!) { repository(owner: $owner, name: $repo) { discussionCategory(slug: $slug) { id } } }',
    { owner: OWNER, repo: REPO, slug: CATEGORY },
  )).discussionCategory;
  if (!category) throw new Error(`no "${CATEGORY}" discussion category`);
  for (const name of names) Object.assign(themes[name], { comments: 0, reactions: 0 });

  let after = null;
  do {
    const page = (await graphql(
      `query($owner: String!, $repo: String!, $category: ID!, $after: String) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 100, after: $after, categoryId: $category) {
            pageInfo { hasNextPage endCursor }
            nodes {
              title
              reactions { totalCount }
              comments(first: 100) { totalCount nodes { replies { totalCount } } }
            }
          }
        }
      }`,
      { owner: OWNER, repo: REPO, category: category.id, after },
    )).discussions;
    for (const thread of page.nodes) {
      // giscus titles each thread with its term, `theme:<name>`.
      const theme = themes[/^theme:([a-z0-9-]+)$/.exec(thread.title)?.[1]];
      if (!theme) continue;
      const replies = thread.comments.nodes.reduce((sum, comment) => sum + comment.replies.totalCount, 0);
      theme.comments += thread.comments.totalCount + replies;
      theme.reactions += thread.reactions.totalCount;
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
}

for (const [label, read] of [['downloads', downloads], ['comments and reactions', discussions]]) {
  try {
    await read();
  } catch (err) {
    console.warn(`stats: could not read the ${label}: ${err.message}`);
  }
}

await writeFile(join(dir, 'stats.json'), JSON.stringify({ updated: new Date().toISOString(), themes }, null, 2) + '\n');
console.log(`stats ${Object.entries(themes).map(([name, s]) => `${name} ${s.downloads ?? '-'}/${s.comments ?? '-'}/${s.reactions ?? '-'}`).join(', ')}`);

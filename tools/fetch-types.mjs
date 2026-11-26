// Downloads Sunbird's plugin API types into types/phoenix.d.ts.
// The file belongs to the Sunbird project, so it is fetched at build time and never committed.
// Set SUNBIRD_REF to pin a commit or tag (defaults to main).
import { mkdir, writeFile } from 'node:fs/promises';

const ref = process.env.SUNBIRD_REF ?? 'main';
const url = `https://raw.githubusercontent.com/sunbird-tools/sunbird/${ref}/crates/runtime/phoenix.d.ts`;

const res = await fetch(url);
if (!res.ok) {
  console.error(`Could not download ${url}: HTTP ${res.status}`);
  process.exit(1);
}
await mkdir(new URL('../types/', import.meta.url), { recursive: true });
await writeFile(new URL('../types/phoenix.d.ts', import.meta.url), await res.text());
console.log(`types/phoenix.d.ts updated from sunbird@${ref}`);

// Rebuilds the `ultracord` branch of a Sunbird checkout: Sunbird's `main` with
// each of our changes merged on top. Every change lives on its own branch cut
// from Sunbird's `main`, so it can go upstream as a pull request on its own.
//
//   node tools/sunbird-fork.mjs <path to the sunbird checkout>
//
// `origin` is sunbird-tools/sunbird. Never commit on `ultracord` itself: the
// branch is reset to `origin/main` on every run.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/**
 * Our changes, merged in this order. Drop one once Sunbird has merged it.
 * `notification-gate` is sunbird-tools/sunbird#88 (by 0Allu) picked onto `main`.
 */
const CHANGES = ["windows-2208-locators", "settings-tabs", "in-app-notices", "notification-gate"];

const BRANCH = "ultracord";
const BASE = "origin/main";
/** The fork commit the 2208 release builds, which `.github/workflows/sunbird-2208.yml` checks out. */
const PIN = new URL("./sunbird-2208/ref", import.meta.url);

const dir = process.argv[2] ?? process.env.SUNBIRD_DIR;
if (!dir) {
  console.error("usage: node tools/sunbird-fork.mjs <path to the sunbird checkout>");
  process.exit(1);
}

const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error(`${dir} has uncommitted changes, commit or stash them first`);
  process.exit(1);
}

// Changes that touch the same lines conflict when merged together. rerere
// replays how such a conflict was resolved by hand the first time.
git("config", "rerere.enabled", "true");
git("config", "rerere.autoUpdate", "true");
git("fetch", "origin", "--prune");

/** Pins the release to the branch as it is now. */
function pin() {
  writeFileSync(PIN, `${git("rev-parse", BRANCH)}
`);
  console.log(`release it: git push --force-with-lease fork ${BRANCH}, then commit tools/sunbird-2208/ref and push`);
}

const contains = (ref) => {
  try {
    git("merge-base", "--is-ancestor", ref, BRANCH);
    return true;
  } catch {
    return false;
  }
};
// A rebuild makes new merge commits, so only rebuild once something moved.
if ([BASE, ...CHANGES].every(contains)) {
  console.log(`${BRANCH} already has ${BASE} and every change`);
  pin();
  process.exit(0);
}

git("switch", "--no-track", "-C", BRANCH, BASE);
for (const change of CHANGES) {
  try {
    git("merge", "--no-ff", "--no-edit", change);
    console.log(`merged ${change}`);
  } catch {
    if (git("diff", "--name-only", "--diff-filter=U")) {
      console.error(
        `${change} conflicts: resolve it by hand and commit the merge (rerere remembers it), ` +
          `or rebase ${change} on ${BASE}, then run this again`,
      );
      process.exit(1);
    }
    git("commit", "--no-edit");
    console.log(`merged ${change}, replaying a known resolution`);
  }
}
console.log(`${BRANCH} is ${BASE} (${git("rev-parse", "--short", BASE)}) with ${CHANGES.length} changes`);
pin();

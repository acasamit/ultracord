// @description Every Ultracord theme in Discord's settings, applied in one press and kept up to date
// @version 1.2.0
// @author Ultracord
// @permissions http
// @fetch assets.ultracord.dev

// `@permissions http` is how Sunbird 0.3 grants requests; `@fetch` is the same grant on older
// loaders, which read only that line.

// The themes are the store's reviewed `.theme.css` palettes. Only their custom properties are
// taken from a downloaded theme and applied as a new stylesheet: the ones in `:root`, and in
// `.theme-dark` and `.theme-light` for each of Discord's modes, plus the `@mode` a light theme
// pins. So a theme can change colors and corner rounding, and nothing else.

const BASE = 'https://assets.ultracord.dev/themes/';
const MAKER = 'https://ultracord.dev/create.html';
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[a-z][a-z0-9-]*$/;
/** A color, a number, or `var()` of them. */
const VALUE = /^[#a-z0-9\s.,%()/-]+$/i;
type Scope = ':root' | '.theme-dark' | '.theme-light';
const SCOPES: Scope[] = [':root', '.theme-dark', '.theme-light'];

interface Listing {
  name: string;
  title: string;
  description: string;
  version: string;
  author: string;
  source?: string;
}

/** The stylesheet in use, kept so it applies before the network answers on the next start. */
interface Applied {
  name: string;
  version: string;
  css: string;
}

function isListing(value: unknown): value is Listing {
  const t = value as Partial<Listing> | null;
  return (
    typeof t === 'object' && t !== null &&
    typeof t.name === 'string' && NAME.test(t.name) &&
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    typeof t.version === 'string' &&
    typeof t.author === 'string'
  );
}

/** Positive when `a` is a newer x.y.z version than `b`. */
function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** The site's order: Ultracord's own theme, the other house themes, then the ports, by name. */
function rank(t: Listing): number {
  return t.name === 'ultracord' ? 0 : t.source ? 2 : 1;
}

/** The `selector { body }` blocks of `text`, one level deep. */
function blocks(text: string): [string, string][] {
  const out: [string, string][] = [];
  let rest = text;
  for (;;) {
    const open = rest.indexOf('{');
    if (open < 0) return out;
    let depth = 0;
    let end = open;
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++;
      else if (rest[end] === '}' && --depth === 0) break;
    }
    if (depth) return out;
    out.push([rest.slice(0, open).trim(), rest.slice(open + 1, end)]);
    rest = rest.slice(end + 1);
  }
}

/** The theme's custom properties, as a stylesheet of their own. */
function clean(css: string): string {
  const vars = new Map<Scope, Map<string, string>>(SCOPES.map((s) => [s, new Map()]));
  const read = (selector: string, body: string, media: 'dark' | 'light' | null) => {
    let scope = SCOPES.find((s) => s === selector);
    if (!scope) return;
    // Under `@media (prefers-color-scheme: light)`, `:root` is the light mode's.
    if (media) {
      if (scope === ':root') scope = `.theme-${media}`;
      else if (scope !== `.theme-${media}`) return;
    }
    for (const declaration of body.split(';')) {
      const match = /^\s*--([^:\s]+)\s*:\s*(.+?)\s*$/s.exec(declaration);
      if (!match) continue;
      const [, key, value] = match;
      if (KEY.test(key) && VALUE.test(value) && !/url\(/i.test(value)) vars.get(scope)!.set(key, value.replace(/\s+/g, ' '));
    }
  };
  for (const [selector, body] of blocks(css.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    const media = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.exec(selector);
    if (media) {
      const mode = media[1].toLowerCase() as 'dark' | 'light';
      for (const [nested, inner] of blocks(body)) read(nested, inner, mode);
    } else {
      read(selector, body, null);
    }
  }

  const rules = SCOPES.filter((s) => vars.get(s)!.size).map(
    (s) => `${s} { ${[...vars.get(s)!].map(([key, value]) => `--${key}: ${value};`).join(' ')} }`,
  );
  if (!rules.length) return '';
  const mode = /@mode\s+(dark|light)\b/i.exec(/\/\*([\s\S]*?)\*\//.exec(css)?.[1] ?? '')?.[1].toLowerCase();
  return `${mode ? `/* @mode ${mode} */ ` : ''}${rules.join(' ')}`;
}

const themes = phoenix.themes;

if (!themes?.supported()) {
  phoenix.log.info("ultracord-themes: this Discord build can't be themed");
} else {
  const listings = () => phoenix.storage.get<Listing[]>('themes') ?? [];
  let picking = 0;

  async function apply(theme: Listing, quiet: boolean): Promise<void> {
    const ticket = ++picking;
    try {
      const res = await phoenix.fetch(`${BASE}${theme.name}.theme.css`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const css = clean(res.text());
      // A later pick wins over one still downloading.
      if (ticket !== picking) return;
      if (!css || !themes!.setCss(css)) throw new Error('it sets no color Sunbird can draw');
      phoenix.storage.set('applied', { name: theme.name, version: theme.version, css } satisfies Applied);
      if (!quiet) phoenix.ui.toast(`Theme: ${theme.title}`);
    } catch (err) {
      phoenix.log.warn(`ultracord-themes: ${theme.name}: ${err}`);
      if (!quiet) phoenix.ui.toast(`Could not apply ${theme.title}: ${err}`);
    }
  }

  function pick(name: string): void {
    if (name === 'off') {
      picking++;
      themes!.clear();
      phoenix.storage.delete('applied');
      return;
    }
    const theme = listings().find((t) => t.name === name);
    if (theme) void apply(theme, false);
  }

  const define = () =>
    phoenix.settings.define({
      theme: {
        type: 'select',
        title: 'Theme',
        description: 'Recolors Discord. If desktop-themes applies one too, the last picked wins.',
        // Short labels: Sunbird draws the picked one next to the title, and a long one squeezes it.
        options: [
          { value: 'off', label: 'Off' },
          ...listings().map((t) => ({ value: t.name, label: `${t.title} by ${t.author}` })),
        ],
        default: 'off',
        onChange: (value) => pick(value),
      },
      refresh: {
        type: 'button',
        title: 'Refresh the list',
        description: `${listings().length} themes. New ones show up here once they are reviewed.`,
        onPress: () => void refresh(true),
      },
      make: {
        type: 'button',
        title: 'Make your own',
        description: 'Opens the theme maker on ultracord.dev',
        onPress: () => {
          // `openUrl` is desktop only and new in Sunbird 0.3; older loaders get the link copied.
          const open = (phoenix.ui as { openUrl?(url: string): void }).openUrl;
          if (open) {
            open.call(phoenix.ui, MAKER);
            return;
          }
          phoenix.ui.copy(MAKER);
          phoenix.ui.toast('Link copied, open it in your browser');
        },
      },
    });

  let settings = define();

  async function refresh(loud: boolean): Promise<boolean> {
    try {
      const res = await phoenix.fetch(`${BASE}index.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = res.json<unknown>();
      if (!Array.isArray(list)) throw new Error('unexpected theme list');
      const sorted = list.filter(isListing).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
      phoenix.storage.set('themes', sorted);
      settings = define();
      if (loud) phoenix.ui.toast(`${sorted.length} themes`);
      return true;
    } catch (err) {
      phoenix.log.warn(`ultracord-themes: could not load the themes: ${err}`);
      if (loud) phoenix.ui.toast('Could not reach ultracord.dev');
      return false;
    }
  }

  // The saved stylesheet applies at once, so Discord does not flash its own colors first. A newer
  // version replaces it once the list is in. "Off" leaves alone a theme from another plugin.
  const chosen = settings.theme;
  const saved = phoenix.storage.get<Applied>('applied');
  if (chosen !== 'off' && saved?.name === chosen) themes.setCss(saved.css);
  void refresh(false).then(() => {
    if (chosen === 'off' || settings.theme !== chosen) return;
    const latest = listings().find((t) => t.name === chosen);
    if (latest && (saved?.name !== chosen || compare(latest.version, saved.version) > 0)) void apply(latest, true);
  });
}

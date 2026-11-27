// @description Every Ultracord theme in Discord's settings, applied in one press and kept up to date
// @version 1.0.1
// @author Ultracord
// @fetch assets.ultracord.dev

// The themes are the store's reviewed `.theme.css` palettes. Only the variables Sunbird reads are
// taken from a downloaded theme and applied as a new stylesheet, so a theme can change colors,
// corner rounding and the Nitro override, and nothing else.

const BASE = 'https://assets.ultracord.dev/themes/';
const MAKER = 'https://ultracord.dev/create.html';
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLORS = [
  'bg-tertiary',
  'bg-secondary',
  'bg-primary',
  'bg-elevated',
  'accent-color',
  'text-normal',
  'text-muted',
  'ui-border-color',
];
const COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([\d\s.,%/a-z]+\))$/i;

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

function allowed(key: string, value: string): boolean {
  if (COLORS.includes(key)) return COLOR.test(value);
  if (key === 'radius-scale') return /^\d+(?:\.\d+)?$/.test(value) && Number(value) <= 2.5;
  if (key === 'override-nitro') return /^(?:true|false|on|off|1|0)$/i.test(value);
  return false;
}

/** The theme's variables that Sunbird reads, as a stylesheet of their own. */
function clean(css: string): string {
  const root = /:root\s*\{([^{}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? '';
  const vars: string[] = [];
  for (const declaration of root.split(';')) {
    const match = /^\s*--([a-z-]+)\s*:\s*(.+?)\s*$/.exec(declaration);
    if (match && allowed(match[1], match[2])) vars.push(`--${match[1]}: ${match[2]};`);
  }
  return vars.length ? `:root { ${vars.join(' ')} }` : '';
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
        description: 'Copies the link to the theme maker on ultracord.dev',
        onPress: () => {
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

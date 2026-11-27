// @description Browse and install reviewed community plugins and themes from Ultracord
// @version 0.3.0
// @author Ultracord

const CATALOG = 'https://assets.ultracord.dev/plugins/';
const INDEX = `${CATALOG}index.json`;
const THEMES = 'https://assets.ultracord.dev/themes/';
const THEME_INDEX = `${THEMES}index.json`;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STALE_MS = 10 * 60 * 1000;
const CONFIRM_MS = 15 * 1000;
// Sunbird calls its install entry "Install from URL" on mobile and "+ URL" on desktop.
const PASTE_HINT = "Paste it in Sunbird's settings with Install from URL (+ URL on desktop).";

interface Listing {
  name: string;
  description: string;
  version: string;
  author: string;
  warning?: string;
  access: string[];
  domains: string[];
}

interface ThemeListing {
  name: string;
  title: string;
  description: string;
  version: string;
  author: string;
}

/** The stylesheet in use, kept so it applies at once on the next start. */
interface AppliedTheme {
  name: string;
  version: string;
  css: string;
}

// Proposed upstream as `phoenix.plugins`. Until Sunbird ships it, the store copies the install link.
interface PluginsApi {
  install(url: string): Promise<string>;
}
const installer = (phoenix as unknown as { plugins?: Partial<PluginsApi> }).plugins;
const install = typeof installer?.install === 'function' ? installer.install.bind(installer) : null;

const ACCESS: Record<string, string> = {
  network: 'the internet',
  'discord-api': 'the Discord API with your session',
  'intercepts-discord-api': 'changes Discord API requests',
  'edits-outgoing-messages': 'changes the messages you send',
  'reads-local-cache': 'reads your local message cache',
  'native-bridge': 'native app functions',
};

let catalog = phoenix.storage.get<Listing[]>('catalog') ?? [];
let themeCatalog = phoenix.storage.get<ThemeListing[]>('themes') ?? [];
/** Sunbird themes Discord on Windows desktop only. Elsewhere the theme picker stays hidden. */
const themes = phoenix.themes?.supported() ? phoenix.themes : null;
let lastLoadFailed = false;
let loading = false;
let page: Phoenix.PageHandle | null = null;
let armed: { name: string; at: number } | null = null;

function isListing(value: unknown): value is Listing {
  const v = value as Partial<Listing> | null;
  return (
    typeof v === 'object' && v !== null &&
    typeof v.name === 'string' && NAME.test(v.name) && v.name !== 'ultracord' &&
    typeof v.description === 'string' &&
    typeof v.version === 'string' &&
    typeof v.author === 'string' &&
    Array.isArray(v.access) && Array.isArray(v.domains)
  );
}

function isThemeListing(value: unknown): value is ThemeListing {
  const v = value as Partial<ThemeListing> | null;
  return (
    typeof v === 'object' && v !== null &&
    typeof v.name === 'string' && NAME.test(v.name) &&
    typeof v.title === 'string' &&
    typeof v.description === 'string' &&
    typeof v.version === 'string' &&
    typeof v.author === 'string'
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

function picked(): Record<string, string> {
  return phoenix.storage.get<Record<string, string>>('picked') ?? {};
}

async function refresh(): Promise<boolean> {
  try {
    const res = await phoenix.fetch(INDEX);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = res.json<unknown>();
    if (!Array.isArray(list)) throw new Error('unexpected catalog format');
    catalog = list.filter(isListing);
    phoenix.storage.set('catalog', catalog);
    phoenix.storage.set('fetchedAt', Date.now());
    lastLoadFailed = false;
    return true;
  } catch (err) {
    phoenix.log.warn(`could not load the catalog: ${err}`);
    lastLoadFailed = true;
    return false;
  }
}

async function refreshThemes(): Promise<void> {
  if (!themes) return;
  try {
    const res = await phoenix.fetch(THEME_INDEX);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = res.json<unknown>();
    if (!Array.isArray(list)) throw new Error('unexpected theme list format');
    themeCatalog = list.filter(isThemeListing);
    phoenix.storage.set('themes', themeCatalog);
  } catch (err) {
    phoenix.log.warn(`could not load the themes: ${err}`);
  }
}

/** Downloads and applies theme `name`, or brings back Discord's colors with "off". */
async function useTheme(name: string, quiet = false): Promise<void> {
  if (!themes) return;
  if (name === 'off') {
    themes.clear();
    phoenix.storage.delete('appliedTheme');
    return;
  }
  const listing = themeCatalog.find((t) => t.name === name);
  if (!listing) return;
  try {
    const res = await phoenix.fetch(`${THEMES}${listing.name}.theme.css`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const css = res.text();
    if (!themes.setCss(css)) throw new Error('it sets nothing Sunbird can draw');
    phoenix.storage.set('appliedTheme', { name, version: listing.version, css } satisfies AppliedTheme);
    if (!quiet) phoenix.ui.toast(`Theme: ${listing.title}`);
  } catch (err) {
    phoenix.ui.toast(`Could not apply ${listing.title}: ${err}`);
  }
}

function updates(): Listing[] {
  const mine = picked();
  return catalog.filter((p) => mine[p.name] && compare(p.version, mine[p.name]) > 0);
}

/** Plugins with an update first, then by name. */
function ordered(): Listing[] {
  const pending = new Set(updates().map((p) => p.name));
  return [...catalog].sort((a, b) =>
    Number(pending.has(b.name)) - Number(pending.has(a.name)) || a.name.localeCompare(b.name));
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function accessLine(p: Listing): string {
  const parts = p.access.map((key) => ACCESS[key] ?? key);
  if (p.domains.length) parts.push(`contacts ${p.domains.join(', ')}`);
  return parts.length ? `Uses ${parts.join(', ')}.` : 'No special access.';
}

function pickedLine(p: Listing, had: string | undefined): string {
  if (!had) return '';
  return compare(p.version, had) > 0 ? ` Update available, you have ${had}.` : ` You picked ${had}.`;
}

function actionLabel(p: Listing, had: string | undefined): string {
  const outdated = had !== undefined && compare(p.version, had) > 0;
  if (install) return outdated ? 'Update' : had ? 'Reinstall' : 'Install';
  return outdated ? 'Copy update link' : 'Copy install link';
}

function describe(p: Listing, had: string | undefined): string {
  const warning = p.warning ? ` Warning: ${sentence(p.warning)}` : '';
  return `${sentence(p.description)} By ${p.author}. ${accessLine(p)}${warning}${pickedLine(p, had)}`;
}

function status(): string {
  const fetchedAt = phoenix.storage.get<number>('fetchedAt');
  if (loading) return 'Getting the plugin list…';
  if (lastLoadFailed) {
    return fetchedAt ? 'Could not reach Ultracord. Showing the last saved list.' : 'Could not reach Ultracord. Check your connection.';
  }
  if (!fetchedAt) return 'Not loaded yet.';
  const at = new Date(fetchedAt);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const count = catalog.length;
  return count
    ? `${count} ${count === 1 ? 'plugin' : 'plugins'}, updated at ${time}.`
    : `No plugins yet, the first ones are being reviewed. Updated at ${time}.`;
}

/**
 * The store as rows on the plugin's own settings page. Settings work on every platform, while
 * pages need native modals that Sunbird turns off on some desktop builds.
 */
function defineSettings() {
  const mine = picked();
  const schema: Record<string, Phoenix.SettingSpec> = {
    refresh: {
      type: 'button',
      title: 'Refresh the plugin list',
      description: status(),
      onPress: () => void refreshSettings(),
    },
  };
  if (themes) {
    schema.theme = {
      type: 'select',
      title: 'Theme',
      description:
        "Recolors Discord. Sunbird's desktop-themes plugin applies themes too: the last one picked wins.",
      options: [
        { value: 'off', label: "Off, Discord's colors" },
        ...themeCatalog.map((t) => ({ value: t.name, label: `${t.title}, by ${t.author}. ${sentence(t.description)}` })),
      ],
      default: 'off',
      onChange: (value) => void useTheme(value),
    };
  }
  for (const p of ordered()) {
    const had = mine[p.name];
    schema[`plugin-${p.name}`] = {
      type: 'button',
      title: `${actionLabel(p, had)}: ${p.name} ${p.version}`,
      description: describe(p, had),
      onPress: () => void pick(p),
    };
  }
  schema.notify = {
    type: 'switch',
    title: 'Update notifications',
    description: 'Check for plugin updates when Discord starts',
    default: true,
  };
  return phoenix.settings.define(schema);
}

let settings = defineSettings();

async function refreshSettings(): Promise<void> {
  loading = true;
  settings = defineSettings();
  const [ok] = await Promise.all([refresh(), refreshThemes()]);
  loading = false;
  settings = defineSettings();
  phoenix.ui.toast(ok ? `Ultracord: ${status()}` : 'Could not reach Ultracord.');
}

async function pick(p: Listing): Promise<void> {
  // A warning needs a second press: confirmation dialogs are not available everywhere.
  if (p.warning && !(armed?.name === p.name && Date.now() - armed.at < CONFIRM_MS)) {
    armed = { name: p.name, at: Date.now() };
    phoenix.ui.toast(`${p.name}: ${sentence(p.warning)} Press again to continue.`);
    return;
  }
  armed = null;

  const url = `${CATALOG}${p.name}.js`;
  const mark = () => {
    phoenix.storage.set('picked', { ...picked(), [p.name]: p.version });
    settings = defineSettings();
  };

  if (install) {
    try {
      await install(url);
      mark();
      phoenix.ui.toast(`${p.name} ${p.version} installed`);
    } catch (err) {
      phoenix.ui.toast(`Could not install ${p.name}: ${err}`);
    }
  } else {
    phoenix.ui.copy(url);
    mark();
    phoenix.ui.toast(`Link copied. ${PASTE_HINT}`);
  }
}

/* Full-screen page, opened from the chat header button on mobile. */

function sections(): Phoenix.PageSection[] {
  const mine = picked();
  const list: Phoenix.PageSection[] = [
    { type: 'text', text: `Community plugins, reviewed line by line before they are listed. ${status()}` },
    { type: 'buttons', buttons: [{ label: 'Refresh', onPress: () => void reload() }] },
  ];
  for (const p of ordered()) {
    const had = mine[p.name];
    list.push({ type: 'text', title: `${p.name}  ${p.version}`, text: describe(p, had) });
    list.push({ type: 'buttons', buttons: [{ label: actionLabel(p, had), onPress: () => void pick(p) }] });
  }
  return list;
}

function show(): void {
  // Open the new page before closing the old one, so a refresh replaces it in place.
  const previous = page;
  page = phoenix.ui.openPage({ title: 'Ultracord', sections: sections() });
  previous?.close();
}

function open(): void {
  // Open before any await: a page opened long after the press can end up behind other UI.
  const fetchedAt = phoenix.storage.get<number>('fetchedAt') ?? 0;
  const stale = Date.now() - fetchedAt > STALE_MS;
  loading = stale && !catalog.length;
  show();
  if (!stale) return;

  const before = JSON.stringify(catalog);
  void refresh().then(() => {
    const wasLoading = loading;
    loading = false;
    settings = defineSettings();
    if (wasLoading || JSON.stringify(catalog) !== before) show();
  });
}

async function reload(): Promise<void> {
  if (!(await refresh())) phoenix.ui.toast('Could not reach Ultracord. Showing the last saved list.');
  settings = defineSettings();
  show();
}

// Mobile only: desktop has no header slots, so there the store lives on the settings page.
const removeButton = phoenix.ui.addHeaderButton({
  icon: 'res://ic_mana_puzzle_piece_plus',
  label: 'Ultracord',
  onPress: () => open(),
});

phoenix.onUnload(() => {
  removeButton();
  page?.close();
});

// The saved stylesheet applies before the network answers, so Discord does not flash its own
// colors first. A newer version of it replaces it once the theme list is in.
const applied = phoenix.storage.get<AppliedTheme>('appliedTheme');
if (themes && applied) themes.setCss(applied.css);
void refreshThemes().then(() => {
  settings = defineSettings();
  const latest = applied && themeCatalog.find((t) => t.name === applied.name);
  if (latest && compare(latest.version, applied.version) > 0) void useTheme(latest.name, true);
});

void refresh().then((ok) => {
  settings = defineSettings();
  const count = ok && settings.notify !== false ? updates().length : 0;
  if (count) {
    phoenix.ui.notify({
      title: 'Ultracord',
      // Desktop ignores onPress, so the text says where to go.
      body: `${count === 1 ? '1 plugin update is' : `${count} plugin updates are`} available. See Ultracord in Sunbird's settings.`,
      onPress: () => open(),
    });
  }
});

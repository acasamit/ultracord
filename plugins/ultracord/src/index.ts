// @description Browse and install reviewed community plugins from Ultracord
// @version 0.1.0
// @author Ultracord

const CATALOG = 'https://assets.ultracord.dev/plugins/';
const INDEX = `${CATALOG}index.json`;
const NAME = /^ultra-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STALE_MS = 10 * 60 * 1000;

interface Listing {
  name: string;
  description: string;
  version: string;
  author: string;
  warning?: string;
  access: string[];
  domains: string[];
}

// Proposed upstream as `phoenix.plugins`. Until Sunbird ships it, the store copies the install link.
interface PluginsApi {
  install(url: string): Promise<string>;
}
const installer = (phoenix as unknown as { plugins?: Partial<PluginsApi> }).plugins;
const install = typeof installer?.install === 'function' ? installer.install.bind(installer) : null;

const ACCESS: Record<string, string> = {
  network: 'Connects to the internet',
  'discord-api': 'Calls the Discord API with your session',
  'intercepts-discord-api': 'Reads or changes Discord API requests',
  'edits-outgoing-messages': 'Can change the messages you send',
  'reads-local-cache': "Reads Discord's local cache, including your messages",
  'native-bridge': 'Calls native app functions',
};

const settings = phoenix.settings.define({
  open: { type: 'button', title: 'Open Ultracord', onPress: () => void open() },
  notify: {
    type: 'switch',
    title: 'Update notifications',
    description: 'Check for plugin updates when Discord starts',
    default: true,
  },
});

let catalog = phoenix.storage.get<Listing[]>('catalog') ?? [];
let page: Phoenix.PageHandle | null = null;

function isListing(value: unknown): value is Listing {
  const v = value as Partial<Listing> | null;
  return (
    typeof v === 'object' && v !== null &&
    typeof v.name === 'string' && NAME.test(v.name) &&
    typeof v.description === 'string' &&
    typeof v.version === 'string' &&
    typeof v.author === 'string' &&
    Array.isArray(v.access) && Array.isArray(v.domains)
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
    return true;
  } catch (err) {
    phoenix.log.warn(`could not load the catalog: ${err}`);
    return false;
  }
}

function updates(): Listing[] {
  const mine = picked();
  return catalog.filter((p) => mine[p.name] && compare(p.version, mine[p.name]) > 0);
}

function describe(p: Listing, had: string | undefined): string {
  const lines = [p.description, `by ${p.author}`];
  if (had) lines.push(compare(p.version, had) > 0 ? `Update available (you have ${had})` : `You picked ${had}`);
  if (p.access.length) {
    lines.push('');
    for (const key of p.access) lines.push(`• ${ACCESS[key] ?? key}`);
  }
  if (p.domains.length) lines.push(`• Contacts: ${p.domains.join(', ')}`);
  if (p.warning) lines.push('', `Warning: ${p.warning}`);
  return lines.join('\n');
}

function sections(): Phoenix.PageSection[] {
  const mine = picked();
  const list: Phoenix.PageSection[] = [
    {
      type: 'text',
      text: install
        ? 'Community plugins, reviewed line by line before they are listed.'
        : 'Community plugins, reviewed line by line before they are listed. ' +
          'Pick one to copy its link, then paste it in Settings > Phoenix > Install from URL.',
    },
    { type: 'buttons', buttons: [{ label: 'Refresh', onPress: () => void reload() }] },
  ];

  if (!catalog.length) {
    list.push({ type: 'text', title: 'Nothing to show', text: 'The catalog could not be loaded. Check your connection and refresh.' });
  }

  // Plugins with an update first, then by name.
  const pending = new Set(updates().map((p) => p.name));
  const order = [...catalog].sort((a, b) =>
    Number(pending.has(b.name)) - Number(pending.has(a.name)) || a.name.localeCompare(b.name));

  for (const p of order) {
    const had = mine[p.name];
    const label = install ? (had ? 'Update' : 'Install') : 'Copy install link';
    list.push({ type: 'text', title: `${p.name}  ${p.version}`, text: describe(p, had) });
    list.push({ type: 'buttons', buttons: [{ label, onPress: () => void pick(p) }] });
  }
  return list;
}

async function pick(p: Listing): Promise<void> {
  if (p.warning) {
    const choice = await phoenix.ui.choose({ title: p.name, message: p.warning, options: ['Continue', 'Cancel'] });
    if (choice !== 0) return;
  }
  const url = `${CATALOG}${p.name}.js`;
  const mark = () => phoenix.storage.set('picked', { ...picked(), [p.name]: p.version });

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
    phoenix.ui.toast('Link copied. Paste it in Settings > Phoenix > Install from URL.');
  }
}

function show(): void {
  page?.close();
  page = phoenix.ui.openPage({ title: 'Ultracord', sections: sections() });
}

async function open(): Promise<void> {
  const fetchedAt = phoenix.storage.get<number>('fetchedAt') ?? 0;
  if (Date.now() - fetchedAt > STALE_MS) await refresh();
  show();
}

async function reload(): Promise<void> {
  if (!(await refresh())) phoenix.ui.toast('Could not reach Ultracord. Showing the last saved list.');
  show();
}

const removeButton = phoenix.ui.addHeaderButton({
  icon: 'res://ic_mana_puzzle_piece_plus',
  label: 'Ultracord',
  onPress: () => void open(),
});

phoenix.onUnload(() => {
  removeButton();
  page?.close();
});

if (settings.notify) {
  void refresh().then((ok) => {
    const count = ok ? updates().length : 0;
    if (count) {
      phoenix.ui.notify({
        title: 'Ultracord',
        body: count === 1 ? '1 plugin update is available' : `${count} plugin updates are available`,
        onPress: () => void open(),
      });
    }
  });
}

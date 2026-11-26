// @description Marks every server as read in one press
// @version 1.2.0
// @author Ultracord

// Discord takes up to 100 read states per bulk request.
const CHUNK = 100;
const SNOWFLAKE = /^\d+$/;

interface ReadState {
  id: string;
  ack: string | null;
  last: string | null;
}

const settings = phoenix.settings.define({
  run: {
    type: 'button',
    title: 'Mark all servers as read',
    description: 'Marks every unread server channel as read in one go.',
    onPress: () => void readAll(),
  },
  dms: {
    type: 'switch',
    title: 'Include direct messages',
    description: 'Also mark direct messages and group chats as read.',
    default: false,
  },
});

function isUnread(state: ReadState): boolean {
  if (!state.last || !SNOWFLAKE.test(state.last)) return false;
  if (!state.ack || !SNOWFLAKE.test(state.ack)) return true;
  return BigInt(state.last) > BigInt(state.ack);
}

const CATEGORY = 4;
const THREADS = new Set([10, 11, 12]);
const VIEW_CHANNEL = 1024;

interface CachedChannel {
  k: string;
  type: number | null;
  last: string | null;
}

interface ChannelUpdate {
  id?: unknown;
  last_message_id?: unknown;
}

/** An id as Discord writes it. Phoenix's cache keys pad ids with zeros. */
function plain(id: unknown): string | null {
  const text = String(id ?? '');
  return SNOWFLAKE.test(text) ? BigInt(text).toString() : null;
}

/** The newest of some message ids, any of which may be missing. */
function newest(...ids: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const id of ids) {
    const value = plain(id);
    if (value && (!best || BigInt(value) > BigInt(best))) best = value;
  }
  return best;
}

/*
 * On big servers Discord does not send every message to the app, only summaries of each channel's
 * latest message (PASSIVE_UPDATE_V2, CHANNEL_UNREAD_UPDATE), and Phoenix's cache lags behind them.
 * The plugin keeps the newest id each summary announced, across restarts.
 */
const SAVE_EVERY_MS = 30 * 1000;
const seen = new Map<string, string>(Object.entries(phoenix.storage.get<Record<string, string>>('seen') ?? {}));
let savedAt = 0;

function save(): void {
  savedAt = Date.now();
  phoenix.storage.set('seen', Object.fromEntries(seen));
}

function remember(updates: unknown): void {
  if (!Array.isArray(updates)) return;
  for (const update of updates as ChannelUpdate[]) {
    const id = plain(update?.id);
    const last = id ? newest(seen.get(id), plain(update?.last_message_id)) : null;
    if (id && last) seen.set(id, last);
  }
  if (Date.now() - savedAt > SAVE_EVERY_MS) save();
}

for (const event of ['passiveUpdateV2', 'channelUnreadUpdate']) {
  // Event names only: `onSend` never comes through here.
  const sig = phoenix.gateway[event] as Phoenix.Sig<unknown> | undefined;
  if (!sig) continue;
  phoenix.on(sig, (payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    remember(p.updated_channels ?? p.channel_unread_updates ?? p.channels);
  });
}

/** Whether `raw`, a channel_access row (`[permissions, …]`), grants View Channel. */
function canView(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const [permissions] = JSON.parse(raw) as unknown[];
    return typeof permissions === 'number' && Number.isSafeInteger(permissions) && Math.floor(permissions / VIEW_CHANNEL) % 2 === 1;
  } catch {
    return false;
  }
}

/** `rows` keyed by their plain id, the part of `key` after the last colon. */
function byId<T>(rows: T[], key: (row: T) => unknown): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const id = plain(String(key(row)).split(':').pop());
    if (id) map.set(id, row);
  }
  return map;
}

/**
 * Unread channels, from Phoenix's cache and the summaries Discord sent. A channel you never opened
 * has no read state yet but still counts as unread for its server, like Discord's own "Mark as read".
 */
async function unreadChannels(includeDms: boolean): Promise<ReadState[]> {
  const json = (path: string) => `json_extract(CAST(v AS TEXT), '$.${path}')`;
  const states = byId(
    await phoenix.stores.sql<ReadState>(`SELECT k AS id, ${json('ack_message_id')} AS ack, ${json('last_message_id')} AS last FROM read_states`),
    (state) => state.id,
  );
  // Channel keys are "<guild>:<channel>"; DMs and group chats are also listed in message_channels.
  const channels = byId(
    await phoenix.stores.sql<CachedChannel>(`SELECT k, ${json('type')} AS type, ${json('last_message_id')} AS last FROM channels`),
    (channel) => channel.k,
  );
  const dms = byId(await phoenix.stores.sql<{ k: string }>('SELECT k FROM message_channels'), (row) => row.k);
  const access = byId(await phoenix.stores.sql<{ k: string; v: string }>('SELECT k, CAST(v AS TEXT) AS v FROM channel_access'), (row) => row.k);

  const unread: ReadState[] = [];
  for (const [id, channel] of channels) {
    if (channel.type === CATEGORY) continue;
    const state = states.get(id);
    if (dms.has(id)) {
      if (!includeDms || !state) continue;
    } else {
      // Unjoined threads never make a server unread, and acking a channel you cannot see would fail the batch.
      if (!state && (THREADS.has(channel.type ?? -1) || !canView(access.get(id)?.v))) continue;
    }
    const entry = { id, ack: plain(state?.ack), last: newest(state?.last, channel.last, seen.get(id)) };
    if (isUnread(entry)) unread.push(entry);
  }
  return unread;
}

let running = false;

async function readAll(): Promise<void> {
  if (running) {
    phoenix.ui.toast('Already marking everything as read');
    return;
  }
  running = true;
  try {
    const unread = await unreadChannels(settings.dms);
    if (!unread.length) {
      phoenix.ui.toast('Everything is already read');
      return;
    }
    for (let i = 0; i < unread.length; i += CHUNK) {
      const read_states = unread.slice(i, i + CHUNK).map((state) => ({
        channel_id: state.id,
        message_id: state.last,
        read_state_type: 0,
      }));
      const res = await phoenix.discord.post('/read-states/ack-bulk', { read_states });
      if (res.status === 429) throw new Error('Discord asks to slow down, try again in a few seconds');
      if (!res.ok) throw new Error(`Discord answered ${res.status}`);
    }
    phoenix.ui.toast(`Marked ${unread.length} ${unread.length === 1 ? 'channel' : 'channels'} as read`);
  } catch (err) {
    phoenix.log.warn(`read all failed: ${err}`);
    phoenix.ui.toast(`Could not mark everything as read: ${err}`);
  } finally {
    running = false;
  }
}

// Mobile: a button in the chat header. Desktop has no header slots, so it uses the settings button.
const removeButton = phoenix.ui.addHeaderButton({
  icon: 'res://ic_mana_chat_eye',
  label: 'Mark all as read',
  onPress: () => void readAll(),
});

phoenix.onUnload(() => {
  removeButton();
  save();
});

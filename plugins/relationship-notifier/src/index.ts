// @description Notifies you when you lose a friend, a friend request, a server or a group
// @version 1.2.1
// @author Ultracord

const FRIEND = 1;
const INCOMING_REQUEST = 3;
const GROUP_DM = 3;
// A removal this soon after your own request to remove it is yours, not theirs.
const SELF_ACTION_MS = 20 * 1000;
const HISTORY_MAX = 50;
const SNOWFLAKE = /^\d+$/;

type Kind = 'friend' | 'request' | 'server' | 'group';

interface Entry {
  at: number;
  kind: Kind;
  name: string;
  offline: boolean;
}

interface Snapshot {
  friends: Record<string, string>;
  servers: Record<string, string>;
  groups: Record<string, string>;
  /** Picture URLs by `pictureKey`, for reports about what the cache no longer has. */
  pictures?: Record<string, string>;
}

const TEXT: Record<Kind, { title: string; live: string; offline: string }> = {
  friend: {
    title: 'No longer friends',
    live: 'is no longer your friend. They removed you or blocked you, or you did it from another device.',
    offline: 'left your friends list while Discord was closed.',
  },
  request: {
    title: 'Friend request cancelled',
    live: 'cancelled their friend request.',
    offline: 'cancelled their friend request while Discord was closed.',
  },
  server: {
    title: 'Removed from a server',
    live: 'is no longer in your servers. You were kicked or banned, or left it from another device.',
    offline: 'left your servers while Discord was closed.',
  },
  group: {
    title: 'Removed from a group',
    live: 'is no longer in your groups. You were removed, or left it from another device.',
    offline: 'left your groups while Discord was closed.',
  },
};

/** An id as Discord writes it. Phoenix's cache keys pad ids with zeros. */
function plain(id: unknown): string | null {
  const text = String(id ?? '').split(':').pop() ?? '';
  return SNOWFLAKE.test(text) ? BigInt(text).toString() : null;
}

/* What the plugin knows right now, kept current by gateway events. */

const people = new Map<string, { type: number; name: string }>();
const servers = new Map<string, string>();
const groups = new Map<string, string>();
/** Avatars and icons by `pictureKey`, shown on desktop banners. */
const pictures = new Map<string, string>();
const selfActions = new Map<string, number>();
let me: string | null = null;

function personName(user: { username?: unknown; global_name?: unknown } | null | undefined, id: string): string {
  const username = typeof user?.username === 'string' ? user.username : null;
  const display = typeof user?.global_name === 'string' && user.global_name ? user.global_name : null;
  if (display && username && display !== username) return `${display} (@${username})`;
  return username ? `@${username}` : display ?? `user ${id}`;
}

const CDN = 'https://cdn.discordapp.com';
const HASH = /^(?:a_)?[0-9a-f]{32}$/;

function pictureKey(kind: Kind, id: string): string {
  return `${kind === 'request' ? 'friend' : kind}:${id}`;
}

/** A user's avatar, or the default one Discord gives them. */
function avatar(id: string, hash: unknown): string {
  if (typeof hash === 'string' && HASH.test(hash)) return `${CDN}/avatars/${id}/${hash}.png?size=80`;
  return `${CDN}/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
}

/** A server or group icon, if it has one. */
function icon(path: 'icons' | 'channel-icons', id: string, hash: unknown): string | undefined {
  return typeof hash === 'string' && HASH.test(hash) ? `${CDN}/${path}/${id}/${hash}.png?size=80` : undefined;
}

function setPicture(key: string, url: string | undefined): void {
  if (url) pictures.set(key, url);
}

async function loadCache(): Promise<void> {
  const json = (path: string) => `json_extract(CAST(v AS TEXT), '$.${path}')`;
  const users = new Map<string, { username?: unknown; global_name?: unknown; avatar?: unknown }>();
  for (const row of await phoenix.stores.sql<{ k: string; username: string; global_name: string; avatar: string | null }>(
    `SELECT k, ${json('username')} AS username, ${json('global_name')} AS global_name, ${json('avatar')} AS avatar FROM users`,
  )) {
    const id = plain(row.k);
    if (id) users.set(id, row);
  }

  people.clear();
  for (const row of await phoenix.stores.sql<{ id: string; type: number }>(`SELECT ${json('user_id')} AS id, ${json('type')} AS type FROM relationships`)) {
    const id = plain(row.id);
    if (!id) continue;
    people.set(id, { type: Number(row.type), name: personName(users.get(id), id) });
    setPicture(pictureKey('friend', id), avatar(id, users.get(id)?.avatar));
  }

  servers.clear();
  for (const row of await phoenix.stores.sql<{ k: string; name: string; icon: string | null }>(
    `SELECT k, ${json('properties.name')} AS name, ${json('properties.icon')} AS icon FROM guilds`,
  )) {
    const id = plain(row.k);
    if (!id) continue;
    servers.set(id, typeof row.name === 'string' ? row.name : `server ${id}`);
    setPicture(pictureKey('server', id), icon('icons', id, row.icon));
  }

  groups.clear();
  for (const row of await phoenix.stores.sql<{ k: string; name: string | null; recipients: string | null; icon: string | null }>(
    `SELECT k, ${json('name')} AS name, ${json('recipient_ids')} AS recipients, ${json('icon')} AS icon FROM channels WHERE ${json('type')} = ${GROUP_DM}`,
  )) {
    const id = plain(row.k);
    if (!id) continue;
    let name = typeof row.name === 'string' && row.name ? row.name : '';
    if (!name) {
      try {
        const ids = JSON.parse(row.recipients ?? '[]') as unknown[];
        name = `group with ${ids.map((r) => personName(users.get(plain(r) ?? ''), String(r))).slice(0, 3).join(', ')}`;
      } catch {
        name = 'a group';
      }
    }
    groups.set(id, name);
    setPicture(pictureKey('group', id), icon('channel-icons', id, row.icon));
  }
}

function snapshot(): Snapshot {
  const friends: Record<string, string> = {};
  for (const [id, person] of people) if (person.type === FRIEND) friends[id] = person.name;
  const kept: Record<string, string> = {};
  const keep = (kind: Kind, ids: Iterable<string>) => {
    for (const id of ids) {
      const url = pictures.get(pictureKey(kind, id));
      if (url) kept[pictureKey(kind, id)] = url;
    }
  };
  keep('friend', Object.keys(friends));
  keep('server', servers.keys());
  keep('group', groups.keys());
  return { friends, servers: Object.fromEntries(servers), groups: Object.fromEntries(groups), pictures: kept };
}

function saveSnapshot(): void {
  // Each account has its own friends and servers: Phoenix can hold several.
  if (me) phoenix.storage.set(`snapshot:${me}`, snapshot());
}

/* History, notifications and the settings page that lists them. */

function history(): Entry[] {
  return me ? phoenix.storage.get<Entry[]>(`history:${me}`) ?? [] : [];
}

function when(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

function enabled(kind: Kind): boolean {
  const key = { friend: 'friends', request: 'requests', server: 'servers', group: 'groups' }[kind];
  return (settings as Record<string, unknown>)[key] !== false;
}

function report(kind: Kind, name: string, offline = false, picture?: string): void {
  if (!enabled(kind)) return;
  const text = TEXT[kind];
  const options = {
    title: text.title,
    body: `${name} ${offline ? text.offline : text.live}`,
    // Drawn on desktop banners by Ultracord's Sunbird build, round for people and groups and square
    // for servers like Discord does. Other runtimes ignore them.
    image: picture,
    imageShape: kind === 'server' ? 'square' : 'circle',
    // Up until closed, so one that comes while Discord is in the background is still there.
    durationMs: 0,
  };
  phoenix.ui.notify(options);
  if (me) phoenix.storage.set(`history:${me}`, [{ at: Date.now(), kind, name, offline }, ...history()].slice(0, HISTORY_MAX));
  settings = defineSettings();
}

function defineSettings() {
  const schema: Record<string, Phoenix.SettingSpec> = {
    friends: { type: 'switch', title: 'Friends', description: 'When someone is no longer your friend', default: true },
    requests: { type: 'switch', title: 'Friend requests', description: 'When someone cancels a friend request they sent you', default: true },
    servers: { type: 'switch', title: 'Servers', description: 'When you are kicked or banned from a server', default: true },
    groups: { type: 'switch', title: 'Groups', description: 'When you are removed from a group chat', default: true },
    offline: { type: 'switch', title: 'While Discord was closed', description: 'Check what changed since last time when Discord starts', default: true },
  };
  const past = history();
  schema.clear = {
    type: 'button',
    title: past.length ? `History (${past.length})` : 'History',
    description: past.length ? 'Newest first. Press an entry to copy the name. Press here to clear it.' : 'Nothing yet.',
    onPress: () => {
      if (me) phoenix.storage.set(`history:${me}`, []);
      settings = defineSettings();
      phoenix.ui.toast('History cleared');
    },
  };
  past.forEach((entry, i) => {
    schema[`entry-${i}`] = {
      type: 'button',
      title: `${TEXT[entry.kind].title}: ${entry.name}`,
      description: `${when(entry.at)}${entry.offline ? ', while Discord was closed' : ''}`,
      onPress: () => {
        phoenix.ui.copy(entry.name);
        phoenix.ui.toast('Name copied');
      },
    };
  });
  return phoenix.settings.define(schema);
}

let settings = defineSettings();

/* Your own actions, seen on their way to Discord, so they are never reported. */

function markSelf(kind: string, id: string | null | undefined): void {
  if (id) selfActions.set(`${kind}:${id}`, Date.now());
}

/** The id at the end of an API path, like `/users/@me/guilds/123`. */
function lastId(path: string): string | null {
  return plain(/(\d+)$/.exec(path)?.[1]);
}

function isSelf(kind: string, id: string): boolean {
  const at = selfActions.get(`${kind}:${id}`);
  return at !== undefined && Date.now() - at < SELF_ACTION_MS;
}

const removers = [
  // Leaving a server, or deleting your own.
  phoenix.discord.onRequest({ method: 'DELETE', pathPrefix: '/users/@me/guilds/' }, (req) => markSelf('server', lastId(req.path))),
  phoenix.discord.onRequest({ method: 'DELETE', pathPrefix: '/guilds/' }, (req) => markSelf('server', plain(/^\/guilds\/(\d+)$/.exec(req.path)?.[1]))),
  phoenix.discord.onRequest({ method: 'POST', pathSuffix: '/delete' }, (req) => markSelf('server', plain(/^\/guilds\/(\d+)\/delete$/.exec(req.path)?.[1]))),
  // Removing a friend, refusing a request, or blocking someone.
  phoenix.discord.onRequest({ method: 'DELETE', pathPrefix: '/users/@me/relationships/' }, (req) => markSelf('user', lastId(req.path))),
  phoenix.discord.onRequest({ method: 'PUT', pathPrefix: '/users/@me/relationships/' }, (req) => markSelf('user', lastId(req.path))),
  // Leaving a group chat.
  phoenix.discord.onRequest({ method: 'DELETE', pathPrefix: '/channels/' }, (req) => markSelf('group', plain(/^\/channels\/(\d+)$/.exec(req.path)?.[1]))),
];

/* Live changes. */

/** A name from the last session's snapshot, for what the cache had not loaded yet. */
function savedName(key: keyof Snapshot, id: string): string | undefined {
  return me ? previous.get(me)?.[key]?.[id] : undefined;
}

/** The picture for a report, from the cache or else the last session's snapshot. */
function pictureOf(kind: Kind, id: string): string | undefined {
  const key = pictureKey(kind, id);
  return pictures.get(key) ?? (me ? previous.get(me)?.pictures?.[key] : undefined);
}

function on(event: string, listener: (payload: Record<string, unknown>) => void): void {
  // Event names only: `onSend` never comes through here.
  const sig = phoenix.gateway[event] as Phoenix.Sig<unknown> | undefined;
  if (sig) phoenix.on(sig, (payload) => listener((payload ?? {}) as Record<string, unknown>));
}

on('relationshipAdd', (p) => {
  const user = p.user as { id?: unknown; avatar?: unknown } | undefined;
  const id = plain(p.id ?? user?.id);
  if (id) {
    people.set(id, { type: Number(p.type), name: personName(user as never, id) });
    setPicture(pictureKey('friend', id), avatar(id, user?.avatar));
  }
  saveSnapshot();
});

on('relationshipUpdate', (p) => {
  const id = plain(p.id);
  const known = id ? people.get(id) : undefined;
  if (id) people.set(id, { type: Number(p.type ?? known?.type), name: known?.name ?? `user ${id}` });
  saveSnapshot();
});

on('relationshipRemove', (p) => {
  const id = plain(p.id);
  if (!id) return;
  const known = people.get(id);
  people.delete(id);
  saveSnapshot();
  if (isSelf('user', id)) return;
  const type = Number(p.type ?? known?.type);
  const name = known?.name ?? savedName('friends', id) ?? `user ${id}`;
  if (type === FRIEND) report('friend', name, false, pictureOf('friend', id));
  else if (type === INCOMING_REQUEST) report('request', name, false, pictureOf('request', id));
});

on('guildCreate', (p) => {
  const id = plain(p.id);
  const props = p.properties as { name?: unknown; icon?: unknown } | undefined;
  const name = props?.name ?? p.name;
  if (id) {
    servers.set(id, typeof name === 'string' ? name : servers.get(id) ?? `server ${id}`);
    setPicture(pictureKey('server', id), icon('icons', id, props?.icon ?? p.icon));
  }
  saveSnapshot();
});

on('guildDelete', (p) => {
  const id = plain(p.id);
  // `unavailable` means a Discord outage, not a removal.
  if (!id || p.unavailable === true) return;
  const name = servers.get(id) ?? savedName('servers', id) ?? `server ${id}`;
  servers.delete(id);
  saveSnapshot();
  if (!isSelf('server', id)) report('server', name, false, pictureOf('server', id));
});

on('channelRecipientRemove', (p) => {
  const id = plain(p.channel_id);
  const user = plain((p.user as { id?: unknown } | undefined)?.id);
  if (!id || !me || user !== me) return;
  const name = groups.get(id) ?? savedName('groups', id) ?? 'a group';
  groups.delete(id);
  saveSnapshot();
  if (!isSelf('group', id)) report('group', name, false, pictureOf('group', id));
});

on('channelDelete', (p) => {
  const id = plain(p.id);
  if (id && groups.delete(id)) saveSnapshot();
});

/* Changes that happened while Discord was closed. */

type Listed = Record<string, unknown>;

const asList = (body: unknown): Listed[] => (Array.isArray(body) ? (body as Listed[]) : []);

/** Where Discord lists what you have now, for confirming what the cache says is gone. */
const CURRENT: Record<Exclude<Kind, 'request'>, { path: string; ids(body: unknown): (string | null)[] }> = {
  friend: {
    path: '/users/@me/relationships',
    ids: (body) => asList(body).filter((r) => Number(r.type) === FRIEND).map((r) => plain(r.id ?? (r.user as Listed | undefined)?.id)),
  },
  server: { path: '/users/@me/guilds?limit=200', ids: (body) => asList(body).map((g) => plain(g.id)) },
  group: {
    path: '/users/@me/channels',
    ids: (body) => asList(body).filter((c) => Number(c.type) === GROUP_DM).map((c) => plain(c.id)),
  },
};

/** What Discord says you have now, or null when it could not be asked. */
async function current(kind: Exclude<Kind, 'request'>): Promise<Set<string> | null> {
  try {
    const res = await phoenix.discord.request(CURRENT[kind].path);
    if (!res.ok) return null;
    return new Set(CURRENT[kind].ids(res.json()).filter((id): id is string => id !== null));
  } catch {
    return null;
  }
}

/** Puts back an entry the cache had not loaded yet, so it stays in the snapshot. */
function restore(kind: Kind, id: string, name: string, picture: string | undefined): void {
  if (kind === 'friend') people.set(id, { type: FRIEND, name });
  else if (kind === 'server') servers.set(id, name);
  else if (kind === 'group') groups.set(id, name);
  if (!pictures.has(pictureKey(kind, id))) setPicture(pictureKey(kind, id), picture);
}

async function checkOffline(previous: Snapshot): Promise<void> {
  const now = snapshot();
  const lists: [Exclude<Kind, 'request'>, Record<string, string>, Record<string, string>][] = [
    ['friend', previous.friends ?? {}, now.friends],
    ['server', previous.servers ?? {}, now.servers],
    ['group', previous.groups ?? {}, now.groups],
  ];
  for (const [kind, before, after] of lists) {
    const picture = (id: string) => previous.pictures?.[pictureKey(kind, id)];
    const gone = Object.keys(before).filter((id) => !(id in after));
    if (!gone.length) continue;
    // A list that lost most of its entries is a cache that is not loaded yet, not real removals.
    const total = Object.keys(before).length;
    if (Object.keys(after).length === 0 || gone.length > Math.max(3, total / 2)) {
      for (const id of gone) restore(kind, id, before[id], picture(id));
      continue;
    }
    // Phoenix can still be filling its cache in: only what Discord confirms is gone is reported.
    const still = await current(kind);
    for (const id of gone) {
      if (!still || still.has(id)) restore(kind, id, before[id], picture(id));
      else report(kind, before[id], true, picture(id));
    }
  }
}

// The state each account had at the end of its last session, read before anything overwrites it.
const previous = new Map<string, Snapshot | null>();
const checked = new Set<string>();
// The first version kept one snapshot for every account.
phoenix.storage.delete('snapshot');
phoenix.storage.delete('history');

async function refresh(check: boolean): Promise<void> {
  me = plain((await phoenix.discord.me().catch(() => null))?.id) ?? me;
  if (me && !previous.has(me)) previous.set(me, phoenix.storage.get<Snapshot>(`snapshot:${me}`) ?? null);
  await loadCache();
  const before = me ? previous.get(me) : null;
  if (check && me && before && !checked.has(me) && (settings as Record<string, unknown>).offline !== false) {
    checked.add(me);
    await checkOffline(before);
  }
  saveSnapshot();
  settings = defineSettings();
}

const fail = (err: unknown) => phoenix.log.warn(`could not read the cache: ${err}`);
// Names for live events right away. The cache only reflects a new session once Discord has sent
// READY_SUPPLEMENTAL, which also comes after switching accounts, so changes made while Discord was
// closed or the account was not in use are checked then. Installed mid-session, there is no such
// event: the snapshot is just saved for next time.
void refresh(false).catch(fail);
on('readySupplemental', () => void refresh(true).catch(fail));

phoenix.onUnload(() => {
  for (const remove of removers) remove();
});

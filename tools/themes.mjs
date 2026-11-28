// Shared helpers for check.mjs and bundle.mjs: theme discovery, header parsing and the checks a
// `.theme.css` has to pass. Sunbird 0.3 themes Discord through its own table of named colors (Mana
// tokens): a theme sets custom properties in `:root`, and optionally in `.theme-dark` and
// `.theme-light` for each of Discord's modes. A few broad ones (the backgrounds, the accent, the
// text) fan out to every token of their family; any other `--<token>` sets that one color.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAME, root } from './plugins.mjs';

export const themesDir = join(root, 'themes');
const SEMVER = /^\d+\.\d+\.\d+$/;
const REQUIRED = ['name', 'description', 'version', 'author'];
const VARIABLE = /^[a-z][a-z0-9-]*$/;

/**
 * The broad colors, with the other names Sunbird takes for each (Vencord's and BetterDiscord's
 * among them), first one first, as `crates/themes/src/aliases.rs` picks them.
 */
export const BASE = {
  'bg-tertiary': ['bg-tertiary', 'background-tertiary', 'bg-base-tertiary', 'bg-1'],
  'bg-secondary': ['bg-secondary', 'background-secondary', 'bg-base-secondary', 'bg-2'],
  'bg-primary': ['bg-primary', 'background-primary', 'bg-base-primary', 'bg-3'],
  'bg-elevated': ['bg-elevated', 'background-floating', 'background-modifier-hover', 'bg-4'],
  'accent-color': ['accent-color', 'accent', 'brand-experiment', 'brand-500', 'accent-1', 'accent-2'],
  'text-normal': ['text-normal', 'text-primary', 'text-1', 'text-2'],
  'text-muted': ['text-muted', 'text-secondary', 'text-3', 'text-4'],
  'ui-border-color': ['ui-border-color', 'background-modifier-accent', 'border-subtle'],
};

/**
 * Discord's tokens that Sunbird itself writes, so they exist in every build it themes. A theme can
 * set others, which apply when Discord has a color by that name: the check only warns about those.
 */
export const TOKENS = new Set([
  'background-base-lowest', 'background-base-lower', 'background-base-low', 'background-secondary-alt',
  'chat-background-default', 'home-background', 'background-surface-high', 'background-surface-higher',
  'background-surface-highest', 'bg-surface-overlay', 'bg-surface-raised', 'card-background-default',
  'card-primary-bg', 'card-secondary-bg', 'modal-background', 'modal-footer-background',
  'input-background-default', 'background-mod-subtle', 'background-mod-normal', 'background-mod-strong',
  'background-modifier-active', 'background-modifier-selected', 'chat-input-container-background',
  'channeltextarea-background', 'background-brand', 'brand-560', 'brand-600',
  'button-filled-brand-background', 'button-filled-brand-background-hover',
  'button-filled-brand-background-active', 'button-filled-brand-text', 'control-primary-background-default',
  'control-primary-background-hover', 'control-primary-background-active', 'control-primary-text-default',
  'text-brand', 'icon-brand', 'text-link', 'mention-foreground', 'mention-background', 'focus-primary',
  'text-default', 'text-strong', 'header-primary', 'interactive-text-default', 'interactive-text-active',
  'icon-default', 'icon-strong', 'control-secondary-text-default', 'control-secondary-text-hover',
  'control-secondary-text-active', 'control-secondary-icon-default', 'control-secondary-icon-hover',
  'control-secondary-icon-active', 'button-outline-primary-text', 'control-icon-only-icon-hover',
  'control-icon-only-icon-active', 'interactive-text-hover', 'interactive-icon-hover', 'interactive-icon-active',
  'tab-label-text-focused', 'redesign-channel-name-text', 'badge-secondary-text', 'badge-common-text',
  'text-subtle', 'header-secondary', 'channels-default', 'interactive-text-muted', 'icon-muted', 'icon-subtle',
  'input-placeholder-text-default', 'border-normal', 'border-faint', 'border-strong', 'app-border-frame',
  'input-border-default',
  ...Object.values(BASE).flat(),
]);

/** What a theme sets that is not a color. */
const CONTROLS = { 'radius-scale': [0, 2.5] };

// WCAG contrast, so a theme stays readable: body text needs 4.5:1, secondary text 3:1.
const CONTRAST = [
  ['text-normal', 'bg-primary', 4.5],
  ['text-normal', 'bg-secondary', 4.5],
  ['text-muted', 'bg-primary', 3],
];

/** Theme folders that hold a `<name>.theme.css`. */
export async function listThemes() {
  const names = [];
  let entries = [];
  try {
    entries = await readdir(themesDir, { withFileTypes: true });
  } catch {
    return names;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const files = await readdir(join(themesDir, entry.name));
    if (files.some((file) => file.endsWith('.theme.css'))) names.push(entry.name);
  }
  return names;
}

/** `[r, g, b, a]` in 0..1 from a CSS color Sunbird reads (hex, rgb(), hsl()), or null. */
export function parseColor(raw) {
  const value = raw.trim().toLowerCase();
  if (value === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('');
    if (digits.length === 6) digits += 'ff';
    return [0, 2, 4, 6].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
  if (!fn) return null;
  const args = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (args.length < 3 || args.length > 4) return null;
  const num = (arg) => {
    const match = /^(-?[\d.]+)(%|deg|turn)?$/.exec(arg);
    return match ? [Number(match[1]), match[2] ?? ''] : null;
  };
  const parts = args.map(num);
  if (parts.some((part) => part === null || Number.isNaN(part[0]))) return null;
  const alpha = parts[3] ? (parts[3][1] === '%' ? parts[3][0] / 100 : parts[3][0]) : 1;
  if (fn[1].startsWith('rgb')) {
    const channel = ([v, unit]) => (unit === '%' ? v / 100 : v / 255);
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha].map(clamp);
  }
  const hue = parts[0][1] === 'turn' ? parts[0][0] : parts[0][0] / 360;
  return [...hslToRgb(((hue % 1) + 1) % 1, clamp(parts[1][0] / 100), clamp(parts[2][0] / 100)), clamp(alpha)];
}

const clamp = (v) => Math.min(1, Math.max(0, v));

function hslToRgb(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

/** The color with its lightness moved by `delta`, as Sunbird derives the levels a theme leaves out. */
function shiftLightness(rgba, delta) {
  const [h, s, l] = rgbToHsl(rgba);
  return [...hslToRgb(h, s, clamp(l + delta)), rgba[3]];
}

/** `#rrggbb`, or `#rrggbbaa` when not opaque, for previews and the catalog. */
export function toHex(rgba) {
  const hex = rgba.map((v) => Math.round(v * 255).toString(16).padStart(2, '0'));
  return `#${hex.slice(0, 3).join('')}${rgba[3] < 1 ? hex[3] : ''}`;
}

function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The `@key value` lines of the first block comment. */
function parseHeader(css) {
  const comment = /\/\*([\s\S]*?)\*\//.exec(css)?.[1] ?? '';
  const fields = {};
  for (const line of comment.split(/\r?\n/)) {
    const match = /@(\w+)\s+(.*)$/.exec(line);
    if (match && !(match[1] in fields)) fields[match[1]] = match[2].trim();
  }
  return fields;
}

/* The stylesheet: `selector { --name: value; }` blocks, and `@media (prefers-color-scheme)` around them. */

const SCOPES = { ':root': 'root', '.theme-dark': 'dark', '.theme-light': 'light' };

/** The `{ ... }` blocks of `text` as `[selector, body]`, or an error for anything else. */
function blocks(text, errors) {
  const out = [];
  let rest = text.trim();
  while (rest) {
    const open = rest.indexOf('{');
    if (open < 0) {
      errors.push(`unexpected "${rest.slice(0, 40)}" outside a block`);
      break;
    }
    let depth = 0;
    let end = open;
    for (; end < rest.length; end++) {
      if (rest[end] === '{') depth++;
      else if (rest[end] === '}' && --depth === 0) break;
    }
    if (depth) {
      errors.push('a block is not closed');
      break;
    }
    out.push([rest.slice(0, open).trim(), rest.slice(open + 1, end)]);
    rest = rest.slice(end + 1).trim();
  }
  return out;
}

/**
 * The custom properties of each scope: `{ root, dark, light }`, each `{ name: value }`. `order`
 * gets the scope of each block, in the file's order.
 */
function parseScopes(body, errors, order) {
  const scopes = { root: {}, dark: {}, light: {} };
  const read = (selector, inner, forced) => {
    const scope = SCOPES[selector];
    if (!scope) {
      errors.push(`"${selector}" is not a block Sunbird reads (use :root, .theme-dark or .theme-light, one per block)`);
      return;
    }
    // Under `@media (prefers-color-scheme: light)`, `:root` is the light mode's.
    const into = forced && scope === 'root' ? forced : scope;
    if (forced && into !== forced) {
      errors.push(`${selector} inside a ${forced} @media block never applies`);
      return;
    }
    order.push(into);
    for (const declaration of inner.split(';')) {
      if (!declaration.trim()) continue;
      const match = /^\s*--([^:\s]+)\s*:\s*(.+?)\s*$/s.exec(declaration);
      if (!match) {
        errors.push(`not a custom property: "${declaration.trim()}"`);
        continue;
      }
      const [, key, value] = match;
      if (!VARIABLE.test(key)) errors.push(`--${key}: names are lowercase letters, digits and dashes`);
      else if (key in scopes[into]) errors.push(`--${key} is set twice in ${selector}`);
      else scopes[into][key] = value.replace(/\s+/g, ' ');
    }
  };
  for (const [selector, inner] of blocks(body, errors)) {
    const media = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.exec(selector);
    if (media) {
      for (const [nested, nestedBody] of blocks(inner, errors)) read(nested, nestedBody, media[1].toLowerCase());
    } else if (selector.startsWith('@')) {
      errors.push(`"${selector}" is not allowed: only @media (prefers-color-scheme: dark|light)`);
    } else {
      read(selector, inner, null);
    }
  }
  return scopes;
}

/** `value` with every `var(--name, fallback)` replaced from `vars`, or null when one is missing. */
function resolve(value, vars, seen = []) {
  let out = '';
  let rest = value;
  for (;;) {
    const at = rest.search(/var\(/i);
    if (at < 0) return out + rest;
    out += rest.slice(0, at);
    let depth = 0;
    let end = at + 3;
    for (; end < rest.length; end++) {
      if (rest[end] === '(') depth++;
      else if (rest[end] === ')' && --depth === 0) break;
    }
    if (depth) return null;
    const inner = rest.slice(at + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim().replace(/^--/, '');
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    let replaced = null;
    if (name in vars && !seen.includes(name) && seen.length < 16) replaced = resolve(vars[name], vars, [...seen, name]);
    if (replaced === null && fallback !== null) replaced = resolve(fallback, vars, seen);
    if (replaced === null) return null;
    out += replaced;
    rest = rest.slice(end + 1);
  }
}

/** The names `var()` refers to anywhere in the theme: palette variables rather than Discord colors. */
function referenced(scopes) {
  const names = new Set();
  for (const vars of Object.values(scopes)) {
    for (const value of Object.values(vars)) {
      for (const match of value.matchAll(/var\(\s*--([a-z0-9-]+)/gi)) names.add(match[1].toLowerCase());
    }
  }
  return names;
}

/** What Discord shows in `mode`: the broad colors (derived like Sunbird when left out), the other tokens, the rounding. */
function look(scopes, mode, errors, label) {
  const vars = { ...scopes.root, ...scopes[mode] };
  const resolved = {};
  for (const [key, value] of Object.entries(vars)) {
    const out = resolve(value, vars);
    if (out === null) errors.push(`${label}--${key}: "${value}" refers to a variable the theme does not set`);
    else resolved[key] = out;
  }
  const helpers = referenced(scopes);
  const rgba = {};
  for (const [key, value] of Object.entries(resolved)) {
    if (key in CONTROLS || key === 'override-nitro') continue;
    const color = parseColor(value);
    if (color) rgba[key] = color;
    // A palette variable can hold a part of a color, which only the colors using it need to make sense.
    else if (!helpers.has(key)) errors.push(`${label}--${key}: "${value}" is not a color Sunbird reads (hex, rgb() or hsl())`);
  }

  const base = {};
  for (const [key, names] of Object.entries(BASE)) {
    const name = names.find((n) => rgba[n]);
    if (name) base[key] = rgba[name];
  }
  // As Sunbird does: the levels left out follow the chat's, one step darker each (lighter in light mode).
  const chat = base['bg-primary'] ?? base['bg-secondary'] ?? base['bg-tertiary'] ?? base['bg-elevated'];
  if (chat) {
    const step = mode === 'light' ? -1 : 1;
    base['bg-primary'] ??= chat;
    base['bg-secondary'] ??= shiftLightness(base['bg-primary'], -0.03);
    base['bg-tertiary'] ??= shiftLightness(base['bg-secondary'], -0.03);
    base['bg-elevated'] ??= shiftLightness(base['bg-primary'], 0.05 * step);
  }

  const aliases = new Set(Object.values(BASE).flat());
  const tokens = Object.fromEntries(Object.entries(rgba).filter(([key]) => !aliases.has(key) && !helpers.has(key)));
  let radiusScale;
  if ('radius-scale' in resolved) {
    const scale = Number(resolved['radius-scale']);
    const [min, max] = CONTROLS['radius-scale'];
    if (resolved['radius-scale'].trim() === '' || !(scale >= min && scale <= max)) {
      errors.push(`${label}--radius-scale must be a number from ${min} to ${max} (got "${resolved['radius-scale']}")`);
    } else {
      radiusScale = scale;
    }
  }

  for (const [text, bg, min] of CONTRAST) {
    if (!base[text] || !base[bg]) continue;
    const ratio = contrast(base[text], base[bg]);
    if (ratio < min) errors.push(`${label}--${text} on --${bg} is ${ratio.toFixed(2)}:1, under ${min}:1, so text is hard to read`);
  }
  const hex = (map) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, toHex(value)]));
  return { colors: hex(base), tokens: hex(tokens), radiusScale, light: chat ? luminance(base['bg-primary']) > 0.4 : null };
}

/** Reads and checks one theme. `errors` block the merge, `warnings` are for the reviewer. */
export async function inspectTheme(name) {
  const file = `${name}.theme.css`;
  const errors = [];
  const warnings = [];
  let css = '';
  try {
    css = await readFile(join(themesDir, name, file), 'utf8');
  } catch {
    errors.push(`missing themes/${name}/${file}`);
    return { name, file, css, fields: {}, values: {}, colors: {}, errors, warnings };
  }
  const fields = parseHeader(css);

  if (!NAME.test(name)) errors.push(`folder name must be lowercase words joined by dashes (got "${name}")`);
  for (const key of REQUIRED) if (!fields[key]) errors.push(`missing "@${key}" in the header comment`);
  if (fields.version && !SEMVER.test(fields.version)) errors.push(`@version must look like 1.2.3 (got "${fields.version}")`);
  // A theme made from someone else's palette links to it and says under which license it is shared.
  if (fields.source && !/^https:\/\/\S+$/.test(fields.source)) errors.push(`@source must be an https link (got "${fields.source}")`);
  if (fields.source && !fields.license) errors.push('"@source" needs "@license": the original palette\'s license and copyright line');
  const mode = fields.mode?.toLowerCase();
  if (mode && !['dark', 'light'].includes(mode)) errors.push(`@mode must be dark or light (got "${fields.mode}")`);

  // Blocks of custom properties and comments, nothing else: no imports, URLs or component rules,
  // which Sunbird would ignore anyway.
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (/url\(|@import|expression\(/i.test(body)) errors.push('a theme holds colors only: no url(), @import or scripts');
  const order = [];
  const scopes = parseScopes(body, errors, order);
  // Sunbird 0.3.1 and older read every block and keep the last value: with the light colors last,
  // they would show them in dark mode too.
  if (order.lastIndexOf('light') > Math.min(...['root', 'dark'].map((s) => order.indexOf(s)).filter((i) => i >= 0))) {
    errors.push('put the light colors first, before :root and .theme-dark: Sunbird 0.3.1 and older keep the last value of each variable, whatever its block');
  }

  const values = { ...scopes.root, ...scopes.dark, ...scopes.light };
  if (!Object.keys(values).length) errors.push('the theme sets no variable');
  const helpers = referenced(scopes);
  for (const [key, names] of Object.entries(BASE)) {
    const name = names.find((n) => n in values);
    if (name && /var\(/i.test(values[name])) {
      warnings.push(`--${name} uses var(), which Sunbird 0.3.1 and older skip: there ${key === name ? 'it' : `--${key}`} keeps Discord's color`);
    }
  }
  for (const key of Object.keys(values)) {
    if (key === 'override-nitro') {
      errors.push('--override-nitro is gone since Sunbird 0.3: remove it');
    } else if (!(key in CONTROLS) && !TOKENS.has(key) && !helpers.has(key)) {
      warnings.push(`--${key} is not a color Sunbird writes itself: it only applies if Discord has a color by that name`);
    }
  }

  // `@mode` pins one mode. Otherwise `.theme-light` makes it follow Discord's mode.
  const adapts = !mode && Object.keys(scopes.light).length > 0;
  if (mode && Object.keys(scopes[mode === 'dark' ? 'light' : 'dark']).length) {
    warnings.push(`@mode ${mode} pins the theme, so its .theme-${mode === 'dark' ? 'light' : 'dark'} block never applies`);
  }
  const primary = mode ?? 'dark';
  const main = look(scopes, primary, errors, adapts ? 'dark mode: ' : '');
  const light = adapts ? look(scopes, 'light', errors, 'light mode: ') : null;
  if (!mode && !adapts && main.light) {
    warnings.push('the chat is light: add "@mode light" to the header, so Sunbird shades it as a light theme');
  }

  return {
    name,
    file,
    css,
    fields,
    mode,
    adapts,
    values,
    colors: main.colors,
    tokens: main.tokens,
    radiusScale: main.radiusScale,
    ...(light ? { lightColors: light.colors, lightTokens: light.tokens } : {}),
    errors: [...new Set(errors)],
    warnings,
  };
}

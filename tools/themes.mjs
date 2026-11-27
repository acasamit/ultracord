// Shared helpers for check.mjs and bundle.mjs: theme discovery, header parsing and the checks a
// `.theme.css` has to pass. Sunbird's desktop themes are palettes: a theme sets a few custom
// properties in `:root`, which Sunbird maps onto everything Discord draws.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAME, root } from './plugins.mjs';

export const themesDir = join(root, 'themes');

const SEMVER = /^\d+\.\d+\.\d+$/;
const REQUIRED = ['name', 'description', 'version', 'author'];

/** The custom properties Sunbird reads, as `crates/runtime/phoenix.d.ts` lists them. */
export const VARIABLES = {
  'bg-tertiary': 'color',
  'bg-secondary': 'color',
  'bg-primary': 'color',
  'bg-elevated': 'color',
  'accent-color': 'color',
  'text-normal': 'color',
  'text-muted': 'color',
  'ui-border-color': 'color',
  'radius-scale': 'number',
  'override-nitro': 'switch',
};

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
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = [...digits].map((c) => c + c).join('');
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

/** Reads and checks one theme. `errors` block the merge. */
export async function inspectTheme(name) {
  const file = `${name}.theme.css`;
  const errors = [];
  let css = '';
  try {
    css = await readFile(join(themesDir, name, file), 'utf8');
  } catch {
    errors.push(`missing themes/${name}/${file}`);
    return { name, file, css, fields: {}, values: {}, colors: {}, errors };
  }
  const fields = parseHeader(css);

  if (!NAME.test(name)) errors.push(`folder name must be lowercase words joined by dashes (got "${name}")`);
  for (const key of REQUIRED) if (!fields[key]) errors.push(`missing "@${key}" in the header comment`);
  if (fields.version && !SEMVER.test(fields.version)) errors.push(`@version must look like 1.2.3 (got "${fields.version}")`);
  // A theme made from someone else's palette links to it and says under which license it is shared.
  if (fields.source && !/^https:\/\/\S+$/.test(fields.source)) errors.push(`@source must be an https link (got "${fields.source}")`);
  if (fields.source && !fields.license) errors.push('"@source" needs "@license": the original palette\'s license and copyright line');

  // One `:root` block of custom properties and comments, nothing else: no imports, URLs or other
  // selectors, which Sunbird would ignore anyway.
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const block = /:root\s*\{([^{}]*)\}/.exec(body);
  if (!block || body.replace(block[0], '').trim()) {
    errors.push('the stylesheet must be a single ":root { ... }" block');
  }

  const values = {};
  const colors = {};
  for (const declaration of (block?.[1] ?? '').split(';')) {
    if (!declaration.trim()) continue;
    const match = /^\s*--([a-z-]+)\s*:\s*(.+?)\s*$/.exec(declaration);
    if (!match) {
      errors.push(`not a custom property: "${declaration.trim()}"`);
      continue;
    }
    const [, key, value] = match;
    const kind = VARIABLES[key];
    if (!kind) {
      errors.push(`--${key} is not a variable Sunbird reads (${Object.keys(VARIABLES).map((v) => `--${v}`).join(', ')})`);
      continue;
    }
    if (key in values) errors.push(`--${key} is set twice`);
    values[key] = value;
    if (kind === 'color') {
      const rgba = parseColor(value);
      if (rgba) colors[key] = rgba;
      else errors.push(`--${key}: "${value}" is not a color Sunbird reads (hex, rgb() or hsl())`);
    } else if (kind === 'number') {
      const scale = Number(value);
      if (!(scale >= 0 && scale <= 2.5)) errors.push(`--${key} must be a number from 0 to 2.5 (got "${value}")`);
    } else if (!['true', 'false', '1', '0', 'on', 'off'].includes(value.toLowerCase())) {
      errors.push(`--${key} must be true or false (got "${value}")`);
    }
  }
  if (!Object.keys(values).length) errors.push('the theme sets no variable');

  for (const [text, bg, min] of CONTRAST) {
    if (!colors[text] || !colors[bg]) continue;
    const ratio = contrast(colors[text], colors[bg]);
    if (ratio < min) errors.push(`--${text} on --${bg} is ${ratio.toFixed(2)}:1, under ${min}:1, so text is hard to read`);
  }

  return {
    name,
    file,
    css,
    fields,
    values,
    colors: Object.fromEntries(Object.entries(colors).map(([key, rgba]) => [key, toHex(rgba)])),
    errors,
  };
}

# Themes

Sunbird themes Discord on desktop: a theme is a palette, a `.theme.css` file of custom properties,
and the colors change everywhere. Pictures, fonts and the layout stay as they are.

Sunbird 0.3.1 and older recolor what Discord draws from the broad colors below. The engine on
Sunbird's main branch, in its next release, writes them into Discord's own table of named colors,
which also brings one-color tweaks, `var()` and dark and light versions. Those sections say what
older versions do with them.

## Writing one

The easiest way is the [theme maker](https://ultracord.dev/create.html): pick the colors with a
live preview, and it proposes the file for you. By hand, create `themes/<name>/<name>.theme.css`,
with a name in lowercase words joined by dashes:

```css
/**
 * @name My Theme
 * @description One sentence about it.
 * @version 1.0.0
 * @author your-github-name
 */
:root {
  --bg-tertiary: #0b0b0d;
  --bg-secondary: #111013;
  --bg-primary: #141317;
  --bg-elevated: #1c1a20;
  --accent-color: #e3121b;
  --text-normal: #f1ede6;
  --text-muted: #b8b1a7;
  --ui-border-color: #2a282f;
  --radius-scale: 0.5;
}
```

These broad colors each paint a whole family of Discord's colors:

| Variable | What it colors |
|---|---|
| `--bg-tertiary` | the server list, the darkest level |
| `--bg-secondary` | the channel and member lists |
| `--bg-primary` | the chat |
| `--bg-elevated` | popups and menus |
| `--accent-color` | buttons, links and highlights |
| `--text-normal` | text |
| `--text-muted` | secondary text |
| `--ui-border-color` | separators |
| `--radius-scale` | corner rounding, from 0 (square) to 2.5, 1 by default |

Colors can be hex, `rgb()` or `hsl()`. Every variable is optional: Sunbird derives the background
levels you leave out from the ones you set. Vencord and BetterDiscord names work too, like
`--background-primary`, `--brand-experiment` or `--text-normal`, so the variables of many existing
themes can be copied as they are.

### One color at a time

Any other `--<name>` sets that one color of Discord's, over what the broad colors gave it:

```css
:root {
  --text-link: #8ab4f8;
  --mention-background: rgb(227 18 27 / 0.2);
  --channeltextarea-background: #1c1a20;
}
```

`tools/themes.mjs` lists the names Sunbird writes itself. Others work when Discord has a color by
that name, and the check warns about them so a reviewer can try them. Sunbird 0.3.1 and older skip
these.

### Your own palette

A variable that `var()` reads is the theme's own, not one of Discord's:

```css
:root {
  --mauve: #cba6f7;
  --accent-color: var(--mauve);
  --text-link: var(--mauve);
}
```

Sunbird 0.3.1 and older skip a value that uses `var()`, so the check warns when a broad color does.

### Dark and light

Colors in `:root` apply in both of Discord's modes. A `.theme-light` block (or `.theme-dark`, or
`@media (prefers-color-scheme: light)`) adds colors for one mode only, so a theme can follow the
mode picked in Discord's settings. The light colors go first: Sunbird 0.3.1 and older read every
block and keep the last value of each variable, so they show the dark version, and the check
refuses the other order.

```css
.theme-light {
  --bg-primary: #eff1f5;
  --text-normal: #4c4f69;
}
:root {
  --bg-primary: #1e1e2e;
  --text-normal: #cdd6f4;
}
```

A light theme that does not change with the mode says so with `@mode light` in the header, so
Sunbird shades it as a light theme (hovers get darker, not lighter).

## Ports of other palettes

A theme made from someone else's palette, like Dracula or Nord, credits it in the header: `@source`
links to the original, and `@license` gives its license and copyright line. The site shows both on
the theme's card. Only port a palette whose license allows it, such as MIT.

```css
 * @source https://draculatheme.com
 * @license MIT, Copyright (c) 2016 Dracula Theme
```

Raise `@version` whenever the file changes: the site's Download buttons serve each version from
a GitHub release, which keeps one file per version and counts its downloads.

`npm run check` refuses a theme with other rules than these blocks, or whose text is hard to read
on its backgrounds (under 4.5:1 for text, 3:1 for secondary text), in each of its modes. To try
one, put the file in Sunbird's themes folder (Sunbird's `desktop-themes` plugin has a button that
opens it) and pick it there.

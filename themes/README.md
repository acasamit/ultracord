# Themes

Sunbird themes Discord on Windows desktop: a theme is a palette, a `.theme.css` file whose
`:root` block sets a few custom properties. Sunbird maps them onto everything Discord draws, so
the colors change everywhere. Pictures, fonts and the layout stay as they are.

## Writing one

Create `themes/<name>/<name>.theme.css`, with a name in lowercase words joined by dashes:

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
| `--override-nitro` | `false` keeps the gradients of a Nitro client theme, which the theme covers by default |

Colors can be hex, `rgb()` or `hsl()`. Every variable is optional: Sunbird derives the background
levels you leave out from the ones you set.

## Ports of other palettes

A theme made from someone else's palette, like Dracula or Nord, credits it in the header: `@source`
links to the original, and `@license` gives its license and copyright line. The site shows both on
the theme's card. Only port a palette whose license allows it, such as MIT.

```css
 * @source https://draculatheme.com
 * @license MIT, Copyright (c) 2016 Dracula Theme
```

`npm run check` refuses a theme that sets anything else, or whose text is hard to read on its
backgrounds (under 4.5:1 for text, 3:1 for secondary text). To try one, put the file in Sunbird's
themes folder (Sunbird's `desktop-themes` plugin has a button that opens it) and pick it there.

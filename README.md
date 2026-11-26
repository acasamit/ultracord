<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ultracord-lockup-on-dark.png">
    <img alt="Ultracord" src=".github/assets/ultracord-lockup-on-light.png" width="520">
  </picture>
</p>

<p align="center">Community plugins and themes for <a href="https://github.com/sunbird-tools/sunbird">Sunbird</a>, reviewed before they ship.</p>

Sunbird unlocks Phoenix, Discord's native client, and comes with a plugin runtime and a few bundled
plugins. Ultracord adds a store on top of it: plugins written by the community, read line by line
before they are listed, and installable from inside Discord.

## Install

1. Get Sunbird from [sunbird.tools](https://sunbird.tools/) with the plugin runtime turned on.
2. In Discord, open **Settings → Phoenix**, choose **Install from URL** and paste:
   ```
   https://assets.ultracord.dev/plugins/ultracord.js
   ```
3. Open Ultracord from the button in the chat header and pick the plugins you want.

Every plugin's code is in [`plugins/`](plugins). The files you install are built from it by
[GitHub Actions](.github/workflows/deploy.yml) and are not minified, so you can check them.

## How plugins are reviewed

- Plugins are submitted as pull requests. Nothing is published until it is merged.
- CI rejects code that runs anything it did not ship with (`eval`, `new Function`, remote scripts).
- CI lists what each plugin can reach (network, Discord API, local cache) and every domain it
  contacts. The store shows the same list before you install.
- Every line is read by a maintainer before merging, and so is every update.

## Write a plugin

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Themes

Phoenix has no CSS, so themes need support from Sunbird itself. Theme submissions open as soon as
it lands. See [`themes/`](themes).

## License

[GPL-3.0-or-later](LICENSE). Not affiliated with Discord or the Sunbird project.

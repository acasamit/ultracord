# Contributing a plugin

Plugins are TypeScript files that Sunbird runs inside Discord with a global `phoenix` object.
The API is documented in Sunbird's
[`phoenix.d.ts`](https://github.com/sunbird-tools/sunbird/blob/main/crates/runtime/phoenix.d.ts),
and its [bundled plugins](https://github.com/sunbird-tools/sunbird/tree/main/plugins) are good
examples.

## Setup

Node 22 or newer.

```sh
npm ci
npm run types      # downloads Sunbird's phoenix.d.ts into types/
npm run all        # types, checks, typecheck and build
```

## Add a plugin

Create `plugins/<name>/src/index.ts`, with a name in lowercase words joined by dashes, like
`read-all`. It cannot be the name of one of Sunbird's own plugins: Sunbird installs a plugin under
its file name, so a plugin called `translate` would replace Sunbird's. `npm run check` refuses
those names.

The file starts with its header:

```ts
// @description Shows when a message was edited
// @version 1.0.0
// @author your-github-name

phoenix.on(phoenix.gateway.messageUpdate, (message) => {
  phoenix.log.info(`edited: ${message.id}`);
});
```

Optional header lines: `// @warning <text>` (shown before install) and `// @enabled false`
(off until the user turns it on).

## Test it

`npm run build` writes `dist/plugins/<name>.js`. Install that file in Discord with
**Install from file** in Sunbird's settings (**+ File** on desktop). Sunbird's debug shell can also hot reload a plugin
while you work on it (see Sunbird's `AGENTS.md`, "Fast loop").

## Rules

A pull request is refused if the plugin:

- loads or runs code it does not ship with (`eval`, `new Function`, dynamic `import()`, remote scripts);
- sends user data anywhere the description does not mention, or collects analytics;
- sends messages, joins servers or changes account settings without a user action;
- is obfuscated or minified;
- copies code under a license that is not compatible with GPL-3.0.

`npm run check` catches the obvious cases. It is a first filter, not the review.

## Updates

Bump `@version` in the same pull request. Updates are reviewed like new plugins.

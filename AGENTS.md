# Vencord

Vencord is a Discord client mod. It runs inside Discord desktop, Vesktop, and the browser (extension or userscript), patches Discord's webpack modules at load time, and ships 100+ built-in plugins on top of a small plugin API.

## Taste

Keep changes small and in the style of the surrounding code. Prefer deleting complexity over adding machinery. If the change needs a paragraph to justify, it is probably too big.

## Where code lives

- `src/webpack/` finds and patches Discord's modules. `patchWebpack.ts` applies patches, `webpack.ts` has the finders, `common/` re-exports Discord's React, stores, and utils.
- `src/plugins/<name>/index.ts(x)` is one plugin. `_api` and `_core` hold internal plugins.
- `src/api/` is the plugin API: settings, commands, context menus, message events and decorations, badges, chat buttons, notifications, DataStore.
- `src/main/` is the Electron main process: injection, IPC, CSP, updater.
- `browser/` holds extension manifests and the userscript wrapper.
- `packages/discord-types` types Discord internals. Extend it instead of reaching for `any`.
- `src/userplugins/` is gitignored and for local plugins only.

## Writing plugins

- Use `definePlugin` from `@utils/types` and `definePluginSettings` from `@api/Settings`. Add yourself to `Devs` in `@utils/constants` if needed. Every file starts with the GPL license header.
- File suffixes limit where a plugin builds: `.web`, `.desktop`, `.discordDesktop`, `.browser`, `.dev`.
- Browser code cannot import Node builtins or `electron`. Put that in the plugin's `native.ts`.
- Find Discord modules with the lazy finders from `@webpack` (`findByPropsLazy`, `findComponentByCodeLazy`, `findStoreLazy`, ...) at module scope.
- Prefer API hooks (`contextMenus`, `flux`, chat buttons, decorations) over patches when they do the job.

## Patches

Discord ships minified code that changes every build, so patches are the fragile part.

- `find` should be a short, stable string unique to the target module, ideally a string literal or i18n key (`#{intl::KEY}`). Use a RegExp only when a string cannot work.
- `match` should anchor on stable text, not minified names. Use `\i` for any identifier. Keep matches as narrow as possible.
- In `replace`, `$self` refers to the plugin object. Call into plugin methods instead of inlining logic in the replacement string.
- Use `group: true` when replacements depend on each other.
- A patch that silently stops matching is a broken plugin. If you cannot verify a patch against current Discord code, say so.

## Verifying

- `pnpm build` (or `pnpm buildWeb` for browser-only changes), `pnpm testTsc`, and `pnpm lint` on what you touched. `pnpm test` runs everything.
- There is no unit test suite. Do not add one for a single change.
- Testing in a real client needs `pnpm inject`, which modifies the user's Discord install. Ask first.

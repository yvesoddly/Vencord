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
- `scripts/` is repo tooling, written with Effect and run directly by Node (no build step, so only erasable TypeScript and explicit `.ts` imports). `scripts/build/` bundles with Rolldown: `bundles.ts` lists every output, `plugins.ts` has the virtual modules (`~plugins`, `~pluginNatives`, `~git-hash`, `file://`, `?managed` CSS) and the CSS collector.
- `oxlint-plugin-vencord/` holds the repo's own lint rules (license header, no `../` imports into aliased dirs).
- `.reference/` is gitignored and holds read-only clones: `vp run sync:reference` fetches Effect at the installed version and t3code. Read `.reference/effect/LLMS.md` before writing Effect code.

## Writing plugins

- Use `definePlugin` from `@utils/types` and `definePluginSettings` from `@api/Settings`. Add yourself to `Devs` in `@utils/constants` if needed. Every file starts with the SPDX license header (`vp lint --fix` adds it).
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

The toolchain is Vite+ (`vp`): Oxlint, Oxfmt, Vitest, TypeScript 7 and Rolldown. All config lives in `vite.config.ts`.

- `vp check` formats, lints and typechecks everything in about two seconds. `vp check --fix` applies fixes. Run it after every change.
- `vp run build` (desktop) or `vp run buildWeb` (browser and extensions) proves the bundles still build, in under a second each.
- `vp run report` is the real check for patches. It builds the reporter, loads Discord's login page in headless Chrome with every plugin enabled, and exits 1 on any patch that had no effect, webpack find that failed or plugin that failed to start. No account is needed. The first run downloads Chrome Headless Shell into `node_modules/.cache`. Run it whenever you touch a `find`, `match` or finder. `node scripts/generateReport.ts --branch stable` tests one branch against an existing reporter build.
- `vp run verify` runs everything CI runs except the report.
- `vp test run` covers the build and lint tooling. Plugins have no unit tests; the reporter is their test. Don't add tests that only mirror an implementation.
- Testing in a real client needs `vp run inject`, which modifies the user's Discord install. Ask first.

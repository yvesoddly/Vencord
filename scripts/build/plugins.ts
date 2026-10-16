/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";

import { minify as minifyHtml } from "html-minifier-terser";
import { transform as transformCss } from "lightningcss";
import type { Plugin } from "vite/rolldown";
import { minify as minifyJs } from "vite/rolldown/utils";

import type { PluginTarget } from "../../src/utils/pluginTargets.ts";
import { listPlugins, readPluginDefinition } from "../lib/plugins.ts";
import type { BuildInfo, Runner } from "./options.ts";

/** Which client a renderer bundle is for. Decides which target-suffixed plugins it includes. */
export type RendererKind = "web" | "discordDesktop" | "vesktop";

// Virtual module ids keep their file extension (`style.css?managed`), so say what they load as.
const js = (code: string) => ({ code, moduleType: "js" as const });

const virtual = (name: string): Plugin => ({
    name: `virtual:${name}`,
    resolveId: { filter: { id: new RegExp(`^${name}$`) }, handler: id => `\0${id}` }
});

/** Whether a plugin with this target suffix stays out of a renderer bundle. Reporter builds keep everything. */
export const isExcluded = (
    target: PluginTarget | null,
    kind: RendererKind,
    info: Pick<BuildInfo, "dev" | "reporter">
) =>
    !info.reporter &&
    ((target === "dev" && !info.dev) ||
        (target === "web" && kind === "discordDesktop") ||
        (target === "browser" && kind !== "web") ||
        (target === "desktop" && kind === "web") ||
        (target === "discordDesktop" && kind !== "discordDesktop") ||
        (target === "vesktop" && kind !== "vesktop"));

/**
 * `import plugins, { PluginMeta, ExcludedPlugins } from "~plugins"`: every plugin this renderer
 * bundles, keyed by name, plus the names of the ones its target excludes.
 */
export const pluginsModule = (kind: RendererKind, info: BuildInfo, run: Runner): Plugin => ({
    ...virtual("~plugins"),
    load: {
        filter: { id: /^\0~plugins$/ },
        handler: async function () {
            const plugins = await run(listPlugins(info.srcDir));
            for (const dir of new Set(plugins.map(p => dirname(p.path)))) this.addWatchFile(dir);

            let imports = "",
                entries = "",
                meta = "",
                excluded = "";
            for (const [i, plugin] of plugins.entries()) {
                if (isExcluded(plugin.target, kind, info)) {
                    const { name } = await run(readPluginDefinition(plugin.entry));
                    excluded += `${JSON.stringify(name)}:${JSON.stringify(plugin.target)},`;
                    continue;
                }
                imports += `import p${i} from ${JSON.stringify(plugin.entry)};\n`;
                entries += `[p${i}.name]:p${i},`;
                meta += `[p${i}.name]:${JSON.stringify({ folderName: plugin.folderName, userPlugin: plugin.userPlugin })},`;
            }
            return js(
                `${imports}export default {${entries}};export const PluginMeta={${meta}};export const ExcludedPlugins={${excluded}};`
            );
        }
    }
});

/** `import natives from "~pluginNatives"`: every plugin's native.ts module, keyed by plugin name. */
export const pluginNativesModule = (info: BuildInfo, run: Runner): Plugin => ({
    ...virtual("~pluginNatives"),
    load: {
        filter: { id: /^\0~pluginNatives$/ },
        handler: async function () {
            const plugins = await run(listPlugins(info.srcDir));
            for (const dir of new Set(plugins.map(p => dirname(p.path)))) this.addWatchFile(dir);

            let imports = "",
                entries = "";
            for (const [i, plugin] of plugins.entries()) {
                if (!plugin.native) continue;
                const { name } = await run(readPluginDefinition(plugin.entry));
                imports += `import * as p${i} from ${JSON.stringify(plugin.native)};\n`;
                entries += `${JSON.stringify(name)}:p${i},`;
            }
            return js(`${imports}export default {${entries}};`);
        }
    }
});

/** `~git-hash` and `~git-remote`, resolved once per build. */
export const gitModules = (info: BuildInfo): Plugin => ({
    name: "git-modules",
    resolveId: { filter: { id: /^~git-(hash|remote)$/ }, handler: id => `\0${id}` },
    load: {
        filter: { id: /^\0~git-(hash|remote)$/ },
        handler: id => js(`export default ${JSON.stringify(id.endsWith("hash") ? info.gitHash : info.gitRemote)};`)
    }
});

/**
 * `import text from "file://./thing.html?minify&base64"`: a file's contents as a string.
 * `?minify` minifies html and js, `?base64` encodes, `?trim=false` keeps trailing whitespace.
 */
export const fileUriModules = (): Plugin => ({
    name: "file-uri",
    resolveId: {
        filter: { id: /^file:\/\// },
        handler: (id, importer) => {
            const [path, query = ""] = id.slice("file://".length).split("?");
            return `\0file-uri:${resolve(dirname(importer!), path)}?${query}`;
        }
    },
    load: {
        filter: { id: /^\0file-uri:/ },
        handler: async id => {
            const [path, query] = id.slice("\0file-uri:".length).split("?");
            const params = new URLSearchParams(query);
            const base64 = params.has("base64");

            let content = await readFile(path, "utf-8");
            if (params.has("minify")) {
                if (path.endsWith(".html")) {
                    content = await minifyHtml(content, {
                        collapseWhitespace: true,
                        removeComments: true,
                        minifyCSS: true,
                        minifyJS: true,
                        removeEmptyAttributes: true,
                        removeRedundantAttributes: true,
                        removeScriptTypeAttributes: true,
                        removeStyleLinkTypeAttributes: true,
                        useShortDoctype: true
                    });
                } else if (/\.[mc]?[jt]sx?$/.test(path)) {
                    content = (await minifyJs(path, content)).code;
                } else {
                    throw new Error(`Don't know how to minify file type: ${path}`);
                }
            } else if (params.get("trim") !== "false") {
                content = content.trimEnd();
            }

            if (base64) content = Buffer.from(content).toString("base64");
            return js(`export default ${JSON.stringify(content)};`);
        }
    }
});

/**
 * `import style from "./style.css?managed"`: registers the stylesheet with the Styles API instead
 * of bundling it, so plugins can enable and disable it at runtime. Exports the style's name.
 */
export const managedStyles = (info: BuildInfo): Plugin => ({
    name: "managed-styles",
    resolveId: {
        filter: { id: /\.css\?managed$/ },
        handler: (id, importer) => `\0managed-style:${resolve(dirname(importer!), id.replace("?managed", ""))}`
    },
    load: {
        filter: { id: /^\0managed-style:/ },
        handler: async function (id) {
            const path = id.slice("\0managed-style:".length);
            this.addWatchFile(path);
            const name = JSON.stringify(relative(info.rootDir, path).replaceAll("\\", "/"));
            const source = JSON.stringify(await readFile(path, "utf-8"));
            return js(
                `(window.VencordStyles ??= new Map()).set(${name}, { name: ${name}, source: ${source}, classNames: {}, dom: null });\nexport default ${name};`
            );
        }
    }
});

/**
 * Collects every plain `.css` import into one stylesheet next to the chunk (`renderer.js` gets
 * `renderer.css`), in module order, like esbuild did. Rolldown no longer bundles CSS itself.
 * Relative `url()`s are copied as assets. Bundles that can't ship a stylesheet pass `inline`, which
 * turns the CSS into code appended to the chunk instead.
 */
export const cssBundle = (options: { readonly minify: boolean; readonly inline?: (css: string) => string }): Plugin => {
    const sources = new Map<string, string>();

    return {
        name: "css-bundle",
        load: {
            filter: { id: /^[^\0].*\.css$/ },
            handler: async id => {
                sources.set(id, await readFile(id, "utf-8"));
                return { code: "", moduleType: "js", moduleSideEffects: "no-treeshake" };
            }
        },
        renderChunk: async function (code, chunk) {
            const files = chunk.moduleIds.filter(id => sources.has(id));
            if (!files.length && !options.inline) return null;

            const parts = await Promise.all(
                files.map(async file => {
                    // Copy relative url()s (monaco's codicon font) next to the stylesheet.
                    const assets = new Map<string, string>();
                    for (const [, url] of sources.get(file)!.matchAll(/url\(["']?(\.{1,2}\/[^"')?#]+)[^)]*\)/g)) {
                        if (assets.has(url)) continue;
                        const ref = this.emitFile({
                            type: "asset",
                            name: basename(url),
                            source: await readFile(join(dirname(file), url))
                        });
                        assets.set(url, ref);
                    }
                    let css = sources.get(file)!;
                    for (const [url, ref] of assets) css = css.replaceAll(url, `./${this.getFileName(ref)}`);
                    return css;
                })
            );

            let css = parts.join("\n");
            if (options.minify) {
                const result = transformCss({
                    filename: chunk.fileName,
                    code: Buffer.from(css),
                    minify: true,
                    errorRecovery: true
                });
                for (const warning of result.warnings) this.warn(`${warning.loc.filename}: ${warning.message}`);
                css = result.code.toString();
            }

            if (options.inline) return { code: `${code}\n${options.inline(css)}`, map: null };

            this.emitFile({ type: "asset", fileName: chunk.fileName.replace(/\.js$/, ".css"), source: css });
            return null;
        }
    };
};

/** Fails the build when browser code imports something only the main process can use. */
const banImports = (rules: ReadonlyArray<readonly [RegExp, string]>): Plugin => ({
    name: "ban-imports",
    resolveId: (id, importer) => {
        for (const [filter, message] of rules)
            if (filter.test(id)) throw new Error(`${message}\n  imported by ${importer}`);
        return null;
    }
});

const builtinModule = new RegExp(
    `^(node:)?(${builtinModules.map(m => m.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})$`
);

/** The import bans every renderer bundle enforces. */
export const rendererImportBans = banImports([
    [builtinModule, "Cannot import node inbuilt modules in browser code. You need to use a native.ts file"],
    [/^react$/, "Cannot import from react. React and hooks should be imported from @webpack/common"],
    [/^electron(\/.*)?$/, "Cannot import electron in browser code. You need to use a native.ts file"],
    [/^ts-pattern$/, "Cannot import from ts-pattern. match and P should be imported from @webpack/common"]
]);

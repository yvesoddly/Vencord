/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { OutputOptions, Plugin, RolldownOptions } from "vite/rolldown";

import type { BuildInfo, Runner } from "./options.ts";
import {
    cssBundle,
    fileUriModules,
    gitModules,
    managedStyles,
    pluginNativesModule,
    pluginsModule,
    rendererImportBans,
    type RendererKind
} from "./plugins.ts";

/** One output file, and what to build it from. */
export interface Bundle extends RolldownOptions {
    readonly output: OutputOptions;
}

const stringify = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));

const common = (info: BuildInfo, defines: Record<string, unknown>, plugins: Plugin[]): Bundle => {
    const minify = !info.watch && !info.reporter;
    const reactInject = join(info.rootDir, "scripts/build/inject/react.mjs");

    return {
        cwd: info.rootDir,
        tsconfig: join(info.rootDir, "tsconfig.json"),
        logLevel: "warn",
        // transform.jsx below is meant to override tsconfig's "preserve", which is only for tsc.
        checks: { configurationFieldConflict: false },
        plugins: [...plugins, fileUriModules(), gitModules(info), managedStyles(info)],
        transform: {
            define: stringify({
                VERSION: info.version,
                BUILD_TIMESTAMP: info.timestamp,
                IS_STANDALONE: info.standalone,
                IS_DEV: info.dev,
                IS_REPORTER: info.reporter,
                IS_ANTI_CRASH_TEST: info.antiCrashTest,
                IS_UPDATER_DISABLED: info.updaterDisabled,
                IS_WEB: false,
                IS_EXTENSION: false,
                IS_USERSCRIPT: false,
                IS_DISCORD_DESKTOP: false,
                IS_VESKTOP: false,
                ...defines
            }),
            jsx: { runtime: "classic", pragma: "VencordCreateElement", pragmaFrag: "VencordFragment" },
            inject: {
                VencordCreateElement: [reactInject, "VencordCreateElement"],
                VencordFragment: [reactInject, "VencordFragment"]
            }
        },
        output: {
            minify,
            comments: minify ? { legal: true, annotation: false, jsdoc: false } : undefined,
            codeSplitting: false
        }
    };
};

/** Patcher, renderer and preload for Discord Desktop, and the same three for Vesktop. */
export function desktopBundles(info: BuildInfo, run: Runner): Bundle[] {
    const banner = [
        `// Vencord ${info.gitHash}`,
        `// Standalone: ${info.standalone}`,
        `// Platform: ${info.standalone ? "Universal" : process.platform}`,
        `// Updater Disabled: ${info.updaterDisabled}`
    ].join("\n");

    // The renderer runs from a string, so its maps are served by the vencord:// protocol (src/main/index.ts).
    const desktopSourcemap = (file: string, sourceUrl: string): OutputOptions =>
        info.watch
            ? { sourcemap: "inline", postFooter: `//# sourceURL=file:///${sourceUrl}` }
            : {
                  sourcemap: "hidden",
                  postFooter: `//# sourceURL=file:///${sourceUrl}\n//# sourceMappingURL=vencord://${file}.map`
              };

    // A local build only ever runs on this machine, so let the minifier drop the other platforms.
    const platform = info.standalone ? {} : { "process.platform": process.platform };

    const node = (
        entry: string,
        file: string,
        sourceUrl: string,
        defines: Record<string, unknown>,
        plugins: Plugin[] = []
    ): Bundle => {
        const base = common(info, { ...platform, ...defines }, plugins);
        return {
            ...base,
            input: join(info.rootDir, entry),
            platform: "node",
            external: [/^electron(\/.*)?$/, "original-fs"],
            output: {
                ...base.output,
                file: join(info.rootDir, "dist", file),
                format: "cjs",
                ...desktopSourcemap(file, sourceUrl),
                postBanner: banner
            }
        };
    };

    const renderer = (
        kind: RendererKind,
        file: string,
        sourceUrl: string,
        defines: Record<string, unknown>
    ): Bundle => {
        const css = cssBundle({ minify: !info.watch && !info.reporter });
        const base = common(info, { ...platform, ...defines }, [
            rendererImportBans,
            pluginsModule(kind, info, run),
            css
        ]);
        return {
            ...base,
            input: join(info.rootDir, "src/Vencord.ts"),
            platform: "browser",
            output: {
                ...base.output,
                file: join(info.rootDir, "dist", file),
                format: "iife",
                name: "Vencord",
                ...desktopSourcemap(file, sourceUrl),
                postBanner: banner
            }
        };
    };

    const discordDesktop = { IS_DISCORD_DESKTOP: true, IS_VESKTOP: false };
    const vesktop = { IS_DISCORD_DESKTOP: false, IS_VESKTOP: true };

    return [
        node("src/main/index.ts", "patcher.js", "VencordPatcher", discordDesktop, [pluginNativesModule(info, run)]),
        renderer("discordDesktop", "renderer.js", "VencordRenderer", discordDesktop),
        node("src/preload.ts", "preload.js", "VencordPreload", discordDesktop),
        node("src/main/index.ts", "vencordDesktopMain.js", "VencordDesktopMain", vesktop, [
            pluginNativesModule(info, run)
        ]),
        renderer("vesktop", "vencordDesktopRenderer.js", "VencordDesktopRenderer", vesktop),
        node("src/preload.ts", "vencordDesktopPreload.js", "VencordPreload", vesktop)
    ];
}

/** Monaco, and the browser build as a plain script, an extension script and a userscript. */
export function webBundles(info: BuildInfo, run: Runner): Bundle[] {
    const monacoDir = join(info.rootDir, "node_modules/monaco-editor/esm");
    const vendor = (input: string, file: string): Bundle => ({
        cwd: info.rootDir,
        input,
        platform: "browser",
        logLevel: "warn",
        plugins: [cssBundle({ minify: true })],
        // Monaco reads import.meta.url for workers we never load (MonacoEnvironment points elsewhere).
        checks: { emptyImportMeta: false, missingNameOptionForIifeExport: false },
        output: {
            file: join(info.rootDir, "dist/vendor/monaco", file),
            format: "iife",
            minify: true,
            comments: { legal: true, annotation: false, jsdoc: false },
            codeSplitting: false,
            assetFileNames: "[name]-[hash][extname]"
        }
    });

    const web = (file: string, defines: Record<string, unknown>, extra: (base: Bundle) => Bundle = b => b): Bundle => {
        const base = common(info, { IS_WEB: true, IS_UPDATER_DISABLED: true, ...defines }, [
            rendererImportBans,
            pluginsModule("web", info, run)
        ]);
        return extra({
            ...base,
            input: join(info.rootDir, "browser/Vencord.ts"),
            platform: "browser",
            output: {
                ...base.output,
                file: join(info.rootDir, "dist", file),
                format: "iife",
                name: "Vencord",
                sourcemap: info.watch ? "inline" : "hidden",
                postFooter: "//# sourceURL=file:///VencordWeb"
            }
        });
    };

    const withCss = (base: Bundle): Bundle => ({
        ...base,
        plugins: [base.plugins, cssBundle({ minify: !info.watch && !info.reporter })]
    });

    const userscriptMeta = readFileSync(join(info.rootDir, "browser/userscript.meta.js"), "utf-8").replace(
        "%version%",
        `${info.version}.${Date.now()}`
    );

    return [
        vendor(join(monacoDir, "vs/language/css/css.worker.js"), "vs/language/css/css.worker.js"),
        vendor(join(monacoDir, "vs/editor/editor.worker.js"), "vs/editor/editor.worker.js"),
        vendor(join(info.rootDir, "browser/monaco.ts"), "index.js"),
        web("browser.js", {}, withCss),
        web("extension.js", { IS_EXTENSION: true }, withCss),
        web("Vencord.user.js", { IS_USERSCRIPT: true, window: "unsafeWindow" }, base => ({
            ...base,
            // Userscripts can't ship a stylesheet, so the CSS rides along as a string the runtime injects.
            plugins: [
                base.plugins,
                cssBundle({
                    minify: !info.watch && !info.reporter,
                    inline: css => `unsafeWindow._vcUserScriptRendererCss=${JSON.stringify(css)};`
                })
            ],
            transform: {
                ...base.transform,
                inject: { ...base.transform!.inject, fetch: [join(info.rootDir, "browser/GMPolyfill.js"), "fetch"] }
            },
            output: {
                ...base.output,
                postBanner: userscriptMeta,
                // UserScripts get wrapped in an iife, so define Vencord prop on window that returns our local
                postFooter:
                    "//# sourceURL=file:///VencordWeb\nObject.defineProperty(unsafeWindow,'Vencord',{get:()=>Vencord});"
            }
        }))
    ];
}

#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Writes the plugin list the website shows: `node scripts/generatePluginList.ts plugins.json readmes.json`,
// or prints it with no arguments. Fails on any plugin whose definePlugin call it can't read, so it
// doubles as a check that every plugin has a name, description and known authors.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { listPlugins, PluginParseError, readDevs, readPluginDefinition } from "./lib/plugins.ts";

const main = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rootDir = path.resolve(import.meta.dirname, "..");
    const srcDir = path.join(rootDir, "src");

    const devs = yield* readDevs(path.join(srcDir, "utils/constants.ts"));
    const entries = (yield* listPlugins(srcDir)).filter(p => !p.userPlugin && !p.folderName.startsWith("_api/"));

    const plugins = yield* Effect.forEach(
        entries,
        Effect.fnUntraced(function* (entry) {
            const plugin = yield* readPluginDefinition(entry.entry);
            const fail = (reason: string) => new PluginParseError({ file: entry.entry, reason });

            if (!plugin.description || !plugin.authors) return yield* fail("name, description or authors are missing");
            const authors = yield* Effect.forEach(plugin.authors, name =>
                devs[name] ? Effect.succeed(devs[name]) : Effect.fail(fail(`couldn't look up author ${name}`))
            );

            const readmePath = path.join(path.dirname(entry.entry), "README.md");
            const readme =
                entry.path !== entry.entry && (yield* fs.exists(readmePath))
                    ? yield* fs.readFileString(readmePath)
                    : "";

            return {
                data: {
                    name: plugin.name,
                    description: plugin.description,
                    tags: plugin.tags ?? [],
                    searchTerms: plugin.searchTerms ?? [],
                    authors,
                    dependencies: plugin.dependencies,
                    hasPatches: plugin.hasPatches,
                    hasCommands: plugin.hasCommands,
                    required: plugin.required,
                    enabledByDefault: plugin.enabledByDefault,
                    target: entry.target ?? undefined,
                    filePath: path
                        .relative(path.join(srcDir, "plugins"), entry.entry)
                        .split(path.sep)
                        .join("/")
                        .replace(/\/index\.([jt]sx?)$/, "")
                },
                readme
            };
        }),
        { concurrency: "unbounded" }
    );

    const json = JSON.stringify(plugins.map(p => p.data));
    const [pluginsFile, readmesFile] = process.argv.slice(2);
    if (!pluginsFile || !readmesFile) return yield* Console.log(json);

    yield* fs.writeFileString(pluginsFile, json);
    yield* fs.writeFileString(
        readmesFile,
        JSON.stringify(Object.fromEntries(plugins.filter(p => p.readme).map(p => [p.data.name, p.readme])))
    );
});

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);

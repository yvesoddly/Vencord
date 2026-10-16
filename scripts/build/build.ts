#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds Vencord. `node scripts/build/build.ts desktop` writes the Discord Desktop and Vesktop
// files to dist/, `... web` writes the browser files and extensions. Run with --help for flags.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Command, Flag } from "effect/cli";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { build, type RolldownWatcherEvent, watch } from "vite/rolldown";

import { type Bundle, desktopBundles, webBundles } from "./bundles.ts";
import { packageExtensions } from "./extension.ts";
import type { BuildFlags, BuildInfo, Runner } from "./options.ts";

export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
    bundle: Schema.String,
    cause: Schema.Defect()
}) {
    override get message() {
        return `Failed to build ${this.bundle}`;
    }
}

const PackageJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const git = Effect.fnUntraced(function* (...args: string[]) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return (yield* spawner.string(ChildProcess.make("git", args))).trim();
});

const resolveInfo = Effect.fn("resolveInfo")(function* (flags: BuildFlags) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rootDir = path.resolve(import.meta.dirname, "../..");

    const { version } = yield* Schema.decodeEffect(PackageJson)(
        yield* fs.readFileString(path.join(rootDir, "package.json"))
    );
    const gitHash =
        Option.getOrUndefined(yield* Config.option(Config.String("VENCORD_HASH"))) ??
        (yield* git("-C", rootDir, "rev-parse", "--short", "HEAD"));
    const gitRemote =
        Option.getOrUndefined(yield* Config.option(Config.String("VENCORD_REMOTE"))) ??
        (yield* git("-C", rootDir, "remote", "get-url", "origin"))
            .replace("https://github.com/", "")
            .replace("git@github.com:", "")
            .replace(/\.git$/, "");
    const epoch = yield* Config.option(Config.Int("SOURCE_DATE_EPOCH"));

    return {
        ...flags,
        // --watch implies a dev build
        dev: flags.dev || flags.watch,
        rootDir,
        srcDir: path.join(rootDir, "src"),
        version,
        gitHash,
        gitRemote,
        timestamp: Option.getOrUndefined(epoch) ?? (yield* Clock.currentTimeMillis)
    } satisfies BuildInfo;
});

const bundleName = (bundle: Bundle) => bundle.output.file!.split(/[/\\]/).slice(-1)[0];

/** Builds every bundle once, in parallel, and reports how long it took. */
const buildAll = Effect.fn("buildAll")(function* (bundles: ReadonlyArray<Bundle>) {
    const started = yield* Clock.currentTimeMillis;
    yield* Effect.forEach(
        bundles,
        bundle =>
            Effect.tryPromise({
                try: () => build({ ...bundle, write: true }),
                catch: cause => new BuildError({ bundle: bundleName(bundle), cause })
            }),
        { concurrency: "unbounded", discard: true }
    );
    yield* Effect.logInfo(`Built ${bundles.length} bundles in ${(yield* Clock.currentTimeMillis) - started}ms`);
});

/** Rebuilds on change until interrupted, running `afterBuild` after each successful round. */
const watchAll = Effect.fn("watchAll")(function* (
    bundles: ReadonlyArray<Bundle>,
    afterBuild: Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path>
) {
    const watcher = yield* Effect.acquireRelease(
        Effect.sync(() => watch(bundles.map(bundle => ({ ...bundle, watch: { clearScreen: false } })))),
        watcher => Effect.promise(() => watcher.close())
    );

    let started = 0;
    yield* Stream.callback<RolldownWatcherEvent>(queue =>
        Effect.sync(() => {
            watcher.on("event", event => {
                Queue.offerUnsafe(queue, event);
            });
        })
    ).pipe(
        Stream.runForEach(event => {
            switch (event.code) {
                case "START":
                    return Clock.currentTimeMillis.pipe(
                        Effect.map(now => {
                            started = now;
                        })
                    );
                case "BUNDLE_END":
                    return Effect.promise(() => event.result.close());
                case "ERROR":
                    return Effect.promise(() => event.result.close()).pipe(
                        Effect.andThen(Effect.logError(event.error.message))
                    );
                case "END":
                    return Clock.currentTimeMillis.pipe(
                        Effect.flatMap(now => Effect.logInfo(`Built in ${now - started}ms, watching for changes`)),
                        Effect.andThen(afterBuild),
                        Effect.catchCause(cause => Effect.logError("Post-build step failed", cause))
                    );
                default:
                    return Effect.void;
            }
        })
    );
});

const flag = (name: string, description: string) =>
    Flag.Boolean(name).pipe(Flag.withDescription(description), Flag.withDefault(false));

const flags = {
    watch: flag("watch", "Rebuild on change (implies --dev)"),
    dev: flag("dev", "Include dev-only plugins"),
    reporter: flag("reporter", "Build the patch reporter: every plugin, unminified"),
    antiCrashTest: flag("anti-crash-test", "Build the anti-crash test"),
    standalone: flag("standalone", "Build for any platform instead of this one"),
    updaterDisabled: flag("disable-updater", "Leave the updater out"),
    skipExtension: flag("skip-extension", "Skip packaging the browser extensions")
};

const target = (
    name: "desktop" | "web",
    bundles: (info: BuildInfo, run: Runner) => Bundle[],
    afterBuild: (info: BuildInfo) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path>
) =>
    Command.make(
        name,
        flags,
        Effect.fn(function* (flags) {
            const info = yield* resolveInfo(flags);
            const run = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem | Path.Path>());
            const all = bundles(info, run);

            if (info.watch) return yield* watchAll(all, afterBuild(info));
            yield* buildAll(all);
            yield* afterBuild(info);
        })
    );

// The repo's package.json says "type": "module" for scripts/, but Electron require()s the desktop
// bundles as CommonJS from dist/, so dist/ gets its own package.json saying so.
const markDistCommonJs = Effect.fn("markDistCommonJs")(function* (info: BuildInfo) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.writeFileString(path.join(info.rootDir, "dist/package.json"), '{ "type": "commonjs" }\n');
});

const desktop = target("desktop", desktopBundles, markDistCommonJs).pipe(
    Command.withDescription("Build Discord Desktop and Vesktop")
);

const web = target("web", webBundles, info => (info.skipExtension ? Effect.void : packageExtensions(info))).pipe(
    Command.withDescription("Build the browser script, extensions and userscript")
);

Command.make("build").pipe(
    Command.withSubcommands([desktop, web]),
    Command.run({ version: "1.0.0" }),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain
);

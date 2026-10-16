#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Shallow-clones read-only reference repos into the gitignored .reference/ directory, or moves an
// existing clone to the wanted ref. Effect is pinned to the installed version so its docs
// (.reference/effect/LLMS.md) match the code here.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";

const PackageJson = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

const main = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const rootDir = path.resolve(import.meta.dirname, "..");

    const effect = yield* Schema.decodeEffect(PackageJson)(
        yield* fs.readFileString(path.join(rootDir, "node_modules/effect/package.json"))
    );
    const repos = [
        { name: "effect", url: "https://github.com/Effect-TS/effect.git", ref: `effect@${effect.version}` },
        { name: "t3code", url: "https://github.com/pingdotgg/t3code.git", ref: "main" }
    ];

    const git = (...args: string[]) =>
        spawner
            .exitCode(ChildProcess.make("git", args, { stdout: "inherit", stderr: "inherit" }))
            .pipe(
                Effect.flatMap(code =>
                    code === 0 ? Effect.void : Effect.fail(new Error(`git ${args.join(" ")} exited with ${code}`))
                )
            );

    yield* Effect.forEach(
        repos,
        Effect.fnUntraced(function* (repo) {
            const dir = path.join(rootDir, ".reference", repo.name);
            yield* Effect.logInfo(`Syncing ${repo.name} at ${repo.ref}`);
            if (yield* fs.exists(path.join(dir, ".git"))) {
                yield* git("-C", dir, "fetch", "--depth", "1", "origin", repo.ref);
                yield* git("-C", dir, "reset", "--hard", "FETCH_HEAD");
            } else {
                yield* git(
                    "-c",
                    "advice.detachedHead=false",
                    "clone",
                    "--depth",
                    "1",
                    "--branch",
                    repo.ref,
                    repo.url,
                    dir
                );
            }
        }),
        { concurrency: "unbounded", discard: true }
    );
});

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);

/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Stream from "effect/Stream";

import { type Change, Updater, UpdaterError } from "./common";

// dist/ sits inside the checkout this install was built from.
const VENCORD_SRC_DIR = join(__dirname, "..");

const isFlatpak = process.platform === "linux" && !!process.env.FLATPAK_ID;

if (process.platform === "darwin") process.env.PATH = `/usr/local/bin:${process.env.PATH}`;

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) => stream.pipe(Stream.decodeText(), Stream.mkString);

/** Updates a local checkout: `git pull`, then rebuild with scripts/build/build.ts. */
export const GitUpdater = Layer.effect(
    Updater,
    Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

        /** Runs a command in the checkout (through the host under Flatpak) and returns its stdout. */
        const run = (command: string, args: string[]) =>
            Effect.gen(function* () {
                const handle = yield* spawner.spawn(
                    isFlatpak
                        ? ChildProcess.make("flatpak-spawn", ["--host", command, ...args], { cwd: VENCORD_SRC_DIR })
                        : ChildProcess.make(command, args, { cwd: VENCORD_SRC_DIR })
                );
                const [stdout, stderr, exitCode] = yield* Effect.all(
                    [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
                    { concurrency: "unbounded" }
                );
                if (exitCode !== 0)
                    return yield* new UpdaterError({
                        message: `${command} ${args.join(" ")} exited with code ${exitCode}`,
                        stderr,
                        stdout
                    });
                return stdout;
            }).pipe(
                Effect.scoped,
                Effect.catchTag("PlatformError", error => Effect.fail(new UpdaterError({ message: error.message })))
            );

        const git = (...args: string[]) => run("git", args);

        const repo = git("remote", "get-url", "origin").pipe(
            Effect.map(url =>
                url
                    .trim()
                    .replace(/git@(.+):/, "https://$1/")
                    .replace(/\.git$/, "")
            )
        );

        const changes = Effect.gen(function* () {
            yield* git("fetch");
            const branch = (yield* git("branch", "--show-current")).trim();
            if (!(yield* git("ls-remote", "origin", branch)).length) return [];

            const log = (yield* git("log", `HEAD...origin/${branch}`, "--pretty=format:%an/%h/%s")).trim();
            return log
                ? log.split("\n").map((line): Change => {
                      const [author, hash, ...rest] = line.split("/");
                      return { hash, author, message: rest.join("/") };
                  })
                : [];
        });

        const update = git("pull").pipe(Effect.map(stdout => stdout.includes("Fast-forward")));

        const rebuild = run("node", ["scripts/build/build.ts", "desktop", ...(IS_DEV ? ["--dev"] : [])]).pipe(
            Effect.as(true)
        );

        return Updater.of({ repo, changes, update, rebuild });
    })
);

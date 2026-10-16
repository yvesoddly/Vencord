#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Downloads the Vencord installer CLI into dist/Installer and runs it against this checkout's
// dist/. Everything after `--` is passed to the installer: `node scripts/runInstaller.ts -- --install`.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

const BASE_URL = "https://github.com/Vencord/Installer/releases/latest/download/";

export class InstallerError extends Schema.TaggedError<InstallerError>()("InstallerError", {
    reason: Schema.String
}) {
    override get message() {
        return this.reason;
    }
}

const installerFile = () => {
    switch (process.platform) {
        case "win32":
            return Effect.succeed("VencordInstallerCli.exe");
        case "darwin":
            return Effect.succeed("VencordInstallerCli-darwin");
        case "linux":
            return Effect.succeed("VencordInstallerCli-linux");
        default:
            return Effect.fail(new InstallerError({ reason: `Unsupported platform: ${process.platform}` }));
    }
};

/** Downloads the installer unless the cached copy's etag is still current. Returns its path. */
const ensureInstaller = Effect.fn("ensureInstaller")(function* (dir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const client = yield* HttpClient.HttpClient;

    const fileName = yield* installerFile();
    const binary = path.join(dir, fileName);
    const etagFile = path.join(dir, "etag.txt");
    yield* fs.makeDirectory(dir, { recursive: true });

    const etag =
        (yield* fs.exists(binary)) && (yield* fs.exists(etagFile)) ? yield* fs.readFileString(etagFile) : undefined;

    yield* Effect.logInfo(`Downloading ${fileName}`);
    const response = yield* HttpClientRequest.get(BASE_URL + fileName).pipe(
        HttpClientRequest.setHeaders({
            "User-Agent": "Vencord (https://github.com/Vendicated/Vencord)",
            ...(etag ? { "If-None-Match": etag } : {})
        }),
        client.execute
    );

    if (response.status === 304) {
        yield* Effect.logInfo("Up to date, not redownloading!");
        return binary;
    }
    if (response.status < 200 || response.status >= 300)
        return yield* new InstallerError({ reason: `Failed to download installer: HTTP ${response.status}` });

    yield* response.stream.pipe(Stream.run(fs.sink(binary)));
    yield* fs.chmod(binary, 0o755);
    if (response.headers.etag) yield* fs.writeFileString(etagFile, response.headers.etag);
    yield* Effect.logInfo("Finished downloading!");
    return binary;
});

const main = Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const rootDir = path.resolve(import.meta.dirname, "..");

    const installer = yield* ensureInstaller(path.join(rootDir, "dist", "Installer"));

    const argStart = process.argv.indexOf("--");
    const args = argStart === -1 ? [] : process.argv.slice(argStart + 1);

    yield* Effect.logInfo("Now running Installer...");
    const exitCode = yield* spawner.exitCode(
        ChildProcess.make(installer, args, {
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
            extendEnv: true,
            env: { VENCORD_USER_DATA_DIR: rootDir, VENCORD_DEV_INSTALL: "1" }
        })
    );
    if (exitCode !== 0)
        return yield* new InstallerError({ reason: "Something went wrong. Please check the logs above." });
});

main.pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)), NodeRuntime.runMain);

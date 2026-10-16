/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { Updater, UpdaterError, VENCORD_FILES } from "./common";

const Release = Schema.Struct({
    // "DevBuild <hash>"
    name: Schema.String,
    assets: Schema.Array(Schema.Struct({ name: Schema.String, browser_download_url: Schema.String }))
});

const Comparison = Schema.Struct({
    commits: Schema.Array(
        Schema.Struct({
            sha: Schema.String,
            author: Schema.NullOr(Schema.Struct({ login: Schema.String })),
            commit: Schema.Struct({
                message: Schema.String,
                author: Schema.NullOr(Schema.Struct({ name: Schema.String }))
            })
        })
    )
});

/** Updates a standalone build from the repo's latest GitHub release. */
export const HttpUpdater = Layer.effect(
    Updater,
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const client = (yield* HttpClient.HttpClient).pipe(
            HttpClient.mapRequest(
                HttpClientRequest.setHeaders({
                    Accept: "application/vnd.github+json",
                    // "All API requests MUST include a valid User-Agent header."
                    "User-Agent": VENCORD_USER_AGENT
                })
            ),
            HttpClient.filterStatusOk
        );

        /** Release assets downloaded by `update` and written by `rebuild`, as [file name, url]. */
        const pending = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);

        const github = <S extends Schema.Top>(endpoint: string, schema: S) =>
            client
                .get(`https://api.github.com/repos/${gitRemote}${endpoint}`)
                .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)));

        // Queues the latest release's files when it was built from another commit.
        const fetchUpdates = Effect.gen(function* () {
            const release = yield* github("/releases/latest", Release);
            const hash = release.name.slice(release.name.lastIndexOf(" ") + 1);
            if (hash === gitHash) return false;

            yield* Ref.set(
                pending,
                release.assets
                    .filter(({ name }) => VENCORD_FILES.some(file => name.startsWith(file)))
                    .map(({ name, browser_download_url }) => [name, browser_download_url] as const)
            );
            return true;
        });

        const changes = Effect.gen(function* () {
            if (!(yield* fetchUpdates)) return [];
            const { commits } = yield* github(`/compare/${gitHash}...HEAD`, Comparison);
            return commits.map(c => ({
                // the API only sends the long sha
                hash: c.sha.slice(0, 7),
                author: c.author?.login ?? c.commit.author?.name ?? "Unknown Author",
                message: c.commit.message.split("\n")[0]
            }));
        });

        const rebuild = Effect.gen(function* () {
            const files = yield* Effect.forEach(
                yield* Ref.get(pending),
                ([name, url]) =>
                    client.get(url).pipe(
                        Effect.flatMap(response => response.arrayBuffer),
                        Effect.map(contents => [join(__dirname, name), new Uint8Array(contents)] as const)
                    ),
                { concurrency: "unbounded" }
            );
            // Download everything before writing anything, so a failed download leaves the install intact.
            yield* Effect.forEach(files, ([file, contents]) => fs.writeFile(file, contents), { discard: true });
            yield* Ref.set(pending, []);
            return true;
        });

        const toUpdaterError = Effect.mapError(
            (error: { readonly message: string }) => new UpdaterError({ message: error.message })
        );

        return Updater.of({
            repo: Effect.succeed(`https://github.com/${gitRemote}`),
            changes: changes.pipe(toUpdaterError),
            update: fetchUpdates.pipe(toUpdaterError),
            rebuild: rebuild.pipe(toUpdaterError)
        });
    })
);

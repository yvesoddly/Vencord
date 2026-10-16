/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { IpcEvents } from "@shared/IpcEvents";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as Path from "effect/Path";
import type { ChildProcessSpawner } from "effect/process";
import * as Schema from "effect/Schema";
import { ipcMain } from "electron";

export const VENCORD_FILES = [
    IS_DISCORD_DESKTOP ? "patcher.js" : "vencordDesktopMain.js",
    IS_DISCORD_DESKTOP ? "preload.js" : "vencordDesktopPreload.js",
    IS_DISCORD_DESKTOP ? "renderer.js" : "vencordDesktopRenderer.js",
    IS_DISCORD_DESKTOP ? "renderer.css" : "vencordDesktopRenderer.css"
];

/** A failed update step. `stderr`/`stdout` carry git's output, which the updater tab shows. */
export class UpdaterError extends Schema.TaggedError<UpdaterError>()("UpdaterError", {
    message: Schema.String,
    stderr: Schema.optional(Schema.String),
    stdout: Schema.optional(Schema.String)
}) {}

export interface Change {
    readonly hash: string;
    readonly author: string;
    readonly message: string;
}

/**
 * How this install updates itself: git for a local checkout, GitHub releases for a standalone
 * build. The renderer drives it through the updater IPC calls in src/VencordNative.ts.
 */
export class Updater extends Context.Service<
    Updater,
    {
        readonly repo: Effect.Effect<string, UpdaterError>;
        /** Commits between this build and upstream. */
        readonly changes: Effect.Effect<ReadonlyArray<Change>, UpdaterError>;
        /** Fetches the update. Returns whether there was one. */
        readonly update: Effect.Effect<boolean, UpdaterError>;
        /** Builds or writes the fetched update to disk. Returns whether that worked. */
        readonly rebuild: Effect.Effect<boolean, UpdaterError>;
    }
>()("vencord/main/updater/Updater") {}

// IPC results lose prototypes, so errors cross as plain objects.
const toIpcResult = <A>(exit: Exit.Exit<A, UpdaterError>) => {
    if (Exit.isSuccess(exit)) return { ok: true, value: exit.value } as const;
    const error = Cause.squash(exit.cause);
    return {
        ok: false,
        error:
            error instanceof Error ? { ...error, message: error.message, name: error.name, stack: error.stack } : error
    } as const;
};

/** Serves the updater IPC calls from `layer`. */
type Services = ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;

// Only what the updaters use, to keep the main process bundle small.
const ServicesLive = Layer.mergeAll(
    Layer.provideMerge(NodeChildProcessSpawner.layer, Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    FetchHttpClient.layer
);

export function registerUpdater(layer: Layer.Layer<Updater, never, Services>) {
    const runtime = ManagedRuntime.make(layer.pipe(Layer.provide(ServicesLive)));

    const handle = <A>(channel: IpcEvents, select: (updater: Updater["Service"]) => Effect.Effect<A, UpdaterError>) =>
        ipcMain.handle(channel, () => runtime.runPromiseExit(Updater.use(select)).then(toIpcResult));

    handle(IpcEvents.GET_REPO, u => u.repo);
    handle(IpcEvents.GET_UPDATES, u => u.changes);
    handle(IpcEvents.UPDATE, u => u.update);
    handle(IpcEvents.BUILD, u => u.rebuild);
}

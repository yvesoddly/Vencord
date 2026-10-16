/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";

/** Command-line switches shared by the desktop and web builds. */
export interface BuildFlags {
    readonly watch: boolean;
    readonly dev: boolean;
    readonly reporter: boolean;
    readonly antiCrashTest: boolean;
    readonly standalone: boolean;
    readonly updaterDisabled: boolean;
    readonly skipExtension: boolean;
}

/** Everything a bundle definition needs, resolved once before building. */
export interface BuildInfo extends BuildFlags {
    readonly rootDir: string;
    readonly srcDir: string;
    readonly version: string;
    readonly gitHash: string;
    readonly gitRemote: string;
    /** https://reproducible-builds.org/docs/source-date-epoch/ */
    readonly timestamp: number;
}

/** Runs an Effect from inside a Rolldown hook, with the build's services. */
export type Runner = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) => Promise<A>;

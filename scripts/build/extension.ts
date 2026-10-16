/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { zipSync } from "fflate";

import type { BuildInfo } from "./options.ts";

const Extensions = [
    {
        dir: "chromium-unpacked",
        zip: "extension-chrome.zip",
        files: ["modifyResponseHeaders.json", "content.js", "manifest.json", "icon.png", "service-worker.js"]
    },
    {
        dir: "firefox-unpacked",
        zip: "extension-firefox.zip",
        files: ["background.js", "content.js", "manifestv2.json", "icon.png"]
    }
] as const;

/** Assembles the unpacked Chromium and Firefox extensions from the web build, and zips each. */
export const packageExtensions = Effect.fn("packageExtensions")(function* (info: BuildInfo) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dist = path.join(info.rootDir, "dist");

    const vendorDir = path.join(dist, "vendor/monaco");
    const vendor = yield* Effect.forEach(
        yield* fs.readDirectory(vendorDir, { recursive: true }),
        Effect.fnUntraced(function* (file) {
            const full = path.join(vendorDir, file);
            return (yield* fs.stat(full)).type === "File"
                ? [[`vendor/monaco/${file}`, yield* fs.readFile(full)] as const]
                : [];
        })
    );

    const shared = {
        "dist/Vencord.js": yield* fs.readFile(path.join(dist, "extension.js")),
        "dist/Vencord.css": yield* fs.readFile(path.join(dist, "extension.css")),
        ...Object.fromEntries(vendor.flat())
    };

    yield* Effect.forEach(
        Extensions,
        Effect.fnUntraced(function* (extension) {
            const entries: Record<string, Uint8Array> = { ...shared };
            for (const file of extension.files) {
                const content = yield* fs.readFile(path.join(info.rootDir, "browser", file));
                if (file.startsWith("manifest")) {
                    const manifest = { ...JSON.parse(new TextDecoder().decode(content)), version: info.version };
                    entries["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest));
                } else {
                    entries[file] = content;
                }
            }

            const target = path.join(dist, extension.dir);
            yield* fs.remove(target, { recursive: true, force: true });
            yield* Effect.forEach(
                Object.entries(entries),
                ([file, content]) => {
                    const dest = path.join(target, file);
                    return fs
                        .makeDirectory(path.dirname(dest), { recursive: true })
                        .pipe(Effect.andThen(fs.writeFile(dest, content)));
                },
                { concurrency: "unbounded", discard: true }
            );

            yield* fs.writeFile(path.join(dist, extension.zip), zipSync(entries));
            yield* Effect.logInfo(`Extension written to dist/${extension.dir} and dist/${extension.zip}`);
        }),
        { concurrency: "unbounded", discard: true }
    );
});

/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import EventEmitter from "events";
import { basename, dirname, join } from "path";

import { app } from "electron";
import { copyFileSync, existsSync, readdirSync, renameSync } from "original-fs";

function isNewer($new: string, old: string) {
    const newParts = $new.slice(4).split(".").map(Number);
    const oldParts = old.slice(4).split(".").map(Number);

    for (let i = 0; i < oldParts.length; i++) {
        if (newParts[i] > oldParts[i]) return true;
        if (newParts[i] < oldParts[i]) return false;
    }
    return false;
}

function patchLatest() {
    if (process.env.DISABLE_UPDATER_AUTO_PATCHING) return;

    try {
        const currentAppPath = dirname(process.execPath);
        const currentVersion = basename(currentAppPath);
        const discordPath = join(currentAppPath, "..");

        const latestVersion = readdirSync(discordPath).reduce((prev, curr) => {
            return curr.startsWith("app-") && isNewer(curr, prev) ? curr : prev;
        }, currentVersion as string);

        if (latestVersion === currentVersion) return;

        const oldResources = join(discordPath, currentVersion, "resources");
        const oldVencordAsar = join(oldResources, "app.asar");

        const resources = join(discordPath, latestVersion, "resources");
        const newAppAsar = join(resources, "app.asar");
        const newAppAsarBackup = join(resources, "_app.asar");

        if (!existsSync(oldVencordAsar) || !existsSync(newAppAsar) || existsSync(newAppAsarBackup)) return;

        console.info(`[Vencord] Detected Host Update (${currentVersion} -> ${latestVersion}). Repatching...`);

        renameSync(newAppAsar, newAppAsarBackup);
        copyFileSync(oldVencordAsar, newAppAsar);
    } catch (err) {
        console.error("[Vencord] Failed to repatch latest host update", err);
    }
}

if (process.platform === "win32" || process.platform === "linux") {
    EventEmitter.prototype.emit = new Proxy(EventEmitter.prototype.emit, {
        apply(target, thisArg, argArray) {
            if (argArray[0] === "host-updated") {
                patchLatest();
            }

            return Reflect.apply(target, thisArg, argArray);
        }
    });

    // Try to patch latest on before-quit
    // Discord's Win32 updater will call app.quit() on restart and open new version on will-quit
    app.on("before-quit", patchLatest);
}

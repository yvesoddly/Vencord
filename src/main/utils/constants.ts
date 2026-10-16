/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

import { app } from "electron";

export const DATA_DIR =
    process.env.VENCORD_USER_DATA_DIR ??
    (process.env.DISCORD_USER_DATA_DIR
        ? join(process.env.DISCORD_USER_DATA_DIR, "..", "VencordData")
        : join(app.getPath("userData"), "..", "Vencord"));
export const SETTINGS_DIR = join(DATA_DIR, "settings");
export const THEMES_DIR = join(DATA_DIR, "themes");
export const QUICK_CSS_PATH = join(SETTINGS_DIR, "quickCss.css");
export const SETTINGS_FILE = join(SETTINGS_DIR, "settings.json");
export const NATIVE_SETTINGS_FILE = join(SETTINGS_DIR, "native-settings.json");
export const ALLOWED_PROTOCOLS = [
    "https:",
    "http:",
    "steam:",
    "spotify:",
    "com.epicgames.launcher:",
    "tidal:",
    "itunes:"
];

export const IS_VANILLA = /* @__PURE__ */ process.argv.includes("--vanilla");

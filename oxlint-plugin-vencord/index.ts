/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePlugin } from "vite-plus/lint/plugins";

import licenseHeader from "./rules/license-header.ts";
import noRelativeParentImport from "./rules/no-relative-parent-import.ts";

export default definePlugin({
    meta: {
        name: "vencord"
    },
    rules: {
        "license-header": licenseHeader,
        "no-relative-parent-import": noRelativeParentImport
    }
});

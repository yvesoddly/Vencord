/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as NodePath from "node:path";

import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import rule from "./no-relative-parent-import.ts";

RuleTester.describe = describe;
RuleTester.it = it;

// Fixtures pretend to live in the real tree so the root tsconfig aliases apply.
const filename = NodePath.resolve(import.meta.dirname, "../../src/plugins/example/index.ts");

new RuleTester().run("no-relative-parent-import", rule, {
    valid: [
        { filename, code: `import { settings } from "./settings";` },
        { filename, code: `import { PlainSettings } from "../../Vencord";` },
        { filename, code: `export * from "../../webpack";` },
        { filename, code: `import "@api/Commands";` }
    ],
    invalid: [
        {
            filename,
            code: `import { sendBotMessage } from "../../api/Commands";`,
            output: `import { sendBotMessage } from "@api/Commands";`,
            errors: [/@api\/Commands/]
        },
        {
            filename,
            code: `export { debounce } from '../../shared/debounce';`,
            output: `export { debounce } from '@shared/debounce';`,
            errors: 1
        },
        {
            filename,
            code: `export * from "../../webpack/common/utils";\nconst wp = import("../../webpack/webpack");`,
            output: `export * from "@webpack/common/utils";\nconst wp = import("@webpack");`,
            errors: 2
        },
        {
            filename,
            code: `import { patches } from "../../webpack/patchWebpack";\nimport "../../webpack/common";`,
            output: `import { patches } from "@webpack/patcher";\nimport "@webpack/common";`,
            errors: 2
        }
    ]
});

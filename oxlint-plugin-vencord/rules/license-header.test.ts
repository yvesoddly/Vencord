/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import rule from "./license-header.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const header = (year: string | number, author: string, bang = "") =>
    `/*${bang}\n * Vencord, a Discord client mod\n * Copyright (c) ${year} ${author}\n * SPDX-License-Identifier: GPL-3.0-or-later\n */`;

const oldHeader = (year: string, author: string, bang = "") => `/*${bang}
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) ${year} ${author}
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/`;

new RuleTester().run("license-header", rule, {
    valid: [
        `${header(2023, "Vendicated and contributors")}\n\nexport {};\n`,
        `${header(2024, "Sofia Lima", "!")}\n\nexport {};\n`,
        `#!/usr/bin/node\n${header(2022, "rini")}\n\nexport {};\n`
    ],
    invalid: [
        {
            code: `${oldHeader("2023", "Vendicated, Nuckyz and contributors")}\n\nexport {};\n`,
            output: `${header(2023, "Vendicated, Nuckyz and contributors")}\n\nexport {};\n`,
            errors: [/SPDX/]
        },
        {
            code: `#!/usr/bin/node\n${oldHeader("2022", "Vendicated and contributors", "!")}\nexport {};\n`,
            output: `#!/usr/bin/node\n${header(2022, "Vendicated and contributors", "!")}\nexport {};\n`,
            errors: [/SPDX/]
        },
        {
            code: `import React from "react";\n`,
            output: `${header(new Date().getFullYear(), "Vendicated and contributors")}\n\nimport React from "react";\n`,
            errors: [/Missing/]
        },
        {
            code: `/*\n * Copyright 2013 Rob Wu\n */\nexport {};\n`,
            output: `${header(new Date().getFullYear(), "Vendicated and contributors")}\n\n/*\n * Copyright 2013 Rob Wu\n */\nexport {};\n`,
            errors: [/Missing/]
        }
    ]
});

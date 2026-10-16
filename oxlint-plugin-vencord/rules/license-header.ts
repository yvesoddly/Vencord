/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineRule } from "vite-plus/lint/plugins";

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a header comment made of these body lines, capturing the `!` of `/*!` (kept by minifiers), year, and author. */
const headerPattern = (lines: string[], close: string) => {
    const comment = ["/*{bang}", ...lines.map(line => (line ? ` * ${line}` : " *")), close].join("\n");
    return new RegExp(
        "^\\s*" +
            escapeRegex(comment)
                .replace("\\{bang\\}", "(!?)")
                .replace("\\{year\\}", "(\\d{4})")
                .replace("\\{author\\}", "(.+)")
    );
};

const NEW_HEADER = headerPattern(
    ["Vencord, a Discord client mod", "Copyright (c) {year} {author}", "SPDX-License-Identifier: GPL-3.0-or-later"],
    " */"
);

const OLD_HEADER = headerPattern(
    [
        "Vencord, a modification for Discord's desktop app",
        "Copyright (c) {year} {author}",
        "",
        "This program is free software: you can redistribute it and/or modify",
        "it under the terms of the GNU General Public License as published by",
        "the Free Software Foundation, either version 3 of the License, or",
        "(at your option) any later version.",
        "",
        "This program is distributed in the hope that it will be useful,",
        "but WITHOUT ANY WARRANTY; without even the implied warranty of",
        "MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the",
        "GNU General Public License for more details.",
        "",
        "You should have received a copy of the GNU General Public License",
        "along with this program.  If not, see <https://www.gnu.org/licenses/>."
    ],
    "*/"
);

const newHeader = (bang: string, year: string | number, author: string) =>
    `/*${bang}\n * Vencord, a Discord client mod\n * Copyright (c) ${year} ${author}\n * SPDX-License-Identifier: GPL-3.0-or-later\n */`;

/**
 * Requires the SPDX license header at the top of every file (after a shebang). The old long GPL
 * header is rewritten to the SPDX form, keeping its year and author. Files that carry a
 * third-party license opt out with `oxlint-disable vencord/license-header` above it.
 */
export default defineRule({
    meta: {
        type: "layout",
        fixable: "code",
        docs: {
            description: "Require the Vencord SPDX license header."
        }
    },
    create(context) {
        return {
            Program() {
                const { text } = context.sourceCode;
                const start = text.startsWith("#!") ? text.indexOf("\n") + 1 : 0;
                const head = text.slice(start);
                if (NEW_HEADER.test(head)) return;

                const old = OLD_HEADER.exec(head);
                if (old) {
                    const [match, bang, year, author] = old;
                    const range: [number, number] = [
                        start + match.length - match.trimStart().length,
                        start + match.length
                    ];
                    context.report({
                        node: { range },
                        message: "Use the SPDX license header instead of the full GPL notice.",
                        fix: fixer => fixer.replaceTextRange(range, newHeader(bang, year, author))
                    });
                    return;
                }

                // Report on the first statement, not offset 0, so a leading `oxlint-disable` comment covers it.
                context.report({
                    node: context.sourceCode.ast.body[0] ?? { range: [start, start] },
                    message: "Missing the Vencord license header.",
                    fix: fixer =>
                        fixer.insertTextBeforeRange(
                            [start, start],
                            `${newHeader("", new Date().getFullYear(), "Vendicated and contributors")}\n\n`
                        )
                });
            }
        };
    }
});

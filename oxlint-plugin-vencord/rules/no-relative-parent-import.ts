/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { defineRule, type ESTree } from "vite-plus/lint/plugins";

const ROOT = NodePath.resolve(import.meta.dirname, "../..");

/** Drops what JSON.parse rejects in a tsconfig (comments, then trailing commas) and leaves strings alone. */
const parseJsonc = (text: string): unknown =>
    JSON.parse(
        text
            .replace(/("(?:\\.|[^"\\])*")|\/\/.*|\/\*[\s\S]*?\*\//g, (_, string?: string) => string ?? "")
            .replace(/("(?:\\.|[^"\\])*")|,(?=\s*[}\]])/g, (_, string?: string) => string ?? "")
    );

const tsconfig = parseJsonc(NodeFS.readFileSync(NodePath.join(ROOT, "tsconfig.json"), "utf8")) as {
    compilerOptions: { paths: Record<string, string[]> };
};

/** Aliases from the root tsconfig `paths`, longest target first so the most specific one wins. */
const ALIASES = Object.entries(tsconfig.compilerOptions.paths)
    .map(([alias, [target]]) => ({
        alias: alias.replace(/\/\*$/, ""),
        target: NodePath.resolve(ROOT, target.replace(/\/\*$/, ""))
    }))
    .sort((a, b) => b.target.length - a.target.length);

/**
 * Reports `../` imports, re-exports, and dynamic imports that land inside a tsconfig path alias
 * and rewrites them to the alias (`../../api/Commands` -> `@api/Commands`). `./` imports are fine.
 */
export default defineRule({
    meta: {
        type: "suggestion",
        fixable: "code",
        docs: {
            description: "Use a path alias instead of a `../` import into an aliased directory."
        }
    },
    create(context) {
        const check = (source: ESTree.Expression | ESTree.StringLiteral | null | undefined) => {
            if (source?.type !== "Literal" || typeof source.value !== "string" || !source.value.startsWith("../"))
                return;

            const resolved = NodePath.resolve(NodePath.dirname(context.filename), source.value);
            const match = ALIASES.find(
                ({ target }) => resolved === target || resolved.startsWith(target + NodePath.sep)
            );
            if (!match) return;

            const aliased = match.alias + resolved.slice(match.target.length).split(NodePath.sep).join("/");
            const quote = source.raw?.[0] ?? '"';
            context.report({
                node: source,
                message: `Import from "${aliased}" instead of a relative parent path.`,
                fix: fixer => fixer.replaceText(source, quote + aliased + quote)
            });
        };

        return {
            ImportDeclaration: node => check(node.source),
            ExportNamedDeclaration: node => check(node.source),
            ExportAllDeclaration: node => check(node.source),
            ImportExpression: node => check(node.source)
        };
    }
});

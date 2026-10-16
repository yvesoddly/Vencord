/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { defineConfig } from "vite-plus";

const ignorePatterns = ["dist/**", ".reference/**", "node_modules/**", "pnpm-lock.yaml", "src/userplugins/**"];

export default defineConfig({
    test: {
        include: ["scripts/**/*.test.ts", "oxlint-plugin-vencord/**/*.test.ts"]
    },
    staged: {
        "*": "vp check --fix --no-error-on-unmatched-pattern"
    },
    fmt: {
        ignorePatterns: [
            ...ignorePatterns,
            // Third-party code kept byte-for-byte.
            "src/plugins/youtubeAdblock.desktop/adguard.js",
            "packages/discord-types/**"
        ],
        tabWidth: 4,
        printWidth: 120,
        arrowParens: "avoid",
        trailingComma: "none",
        sortImports: {},
        sortPackageJson: false
    },
    lint: {
        ignorePatterns: [...ignorePatterns, "src/plugins/youtubeAdblock.desktop/adguard.js"],
        plugins: ["eslint", "typescript", "react", "oxc", "unicorn"],
        jsPlugins: ["./oxlint-plugin-vencord/index.ts"],
        categories: { correctness: "error" },
        rules: {
            "eslint/yoda": "error",
            "eslint/eqeqeq": ["error", "always", { null: "ignore" }],
            "eslint/operator-assignment": ["error", "always"],
            "eslint/no-useless-computed-key": "error",
            "eslint/no-unneeded-ternary": ["error", { defaultAssignment: false }],
            "eslint/no-constant-condition": ["error", { checkLoops: false }],
            "eslint/no-duplicate-imports": "error",
            "eslint/no-fallthrough": "error",
            "eslint/no-prototype-builtins": "error",
            "eslint/no-regex-spaces": "error",
            "eslint/prefer-const": ["error", { destructuring: "all" }],
            "eslint/prefer-spread": "error",
            // Old browser globals that are easy to use by mistake, e.g. `addEventListener(e => console.log(event))`
            "eslint/no-restricted-globals": ["error", "event", "name"],
            "eslint/no-unused-vars": [
                "error",
                {
                    vars: "all",
                    args: "none",
                    caughtErrors: "none",
                    ignoreRestSiblings: true,
                    varsIgnorePattern: "^_"
                }
            ],
            // Patches write `\i` for "any identifier" in their regexes.
            "eslint/no-useless-escape": ["error", { allowRegexCharacters: ["i"] }],
            "react/jsx-key": "error",

            // Correctness rules that flag things Vencord does on purpose: evaluating patches, poking at
            // Discord's internals, plugins like F8Break that exist to hit `debugger`.
            "eslint/no-eval": "off",
            "eslint/no-debugger": "off",
            "eslint/no-sparse-arrays": "off",
            "eslint/no-ex-assign": "off",
            "eslint/no-unused-expressions": "off",
            "typescript/no-this-alias": "off",
            "typescript/no-unsafe-declaration-merging": "off",
            "typescript/no-non-null-asserted-optional-chain": "off",
            "typescript/no-wrapper-object-types": "off",
            "typescript/triple-slash-reference": "off",
            "unicorn/no-new-array": "off",
            "unicorn/no-useless-spread": "off",
            // Type-aware rules that flag intended patterns: fire-and-forget promises, Discord store
            // methods passed around unbound, loosely typed Discord internals.
            "typescript/no-floating-promises": "off",
            "typescript/unbound-method": "off",
            "typescript/await-thenable": "off",
            "typescript/no-base-to-string": "off",
            "typescript/no-implied-eval": "off",
            "typescript/no-meaningless-void-operator": "off",
            "typescript/no-misused-spread": "off",
            "typescript/no-redundant-type-constituents": "off",
            "typescript/no-unsafe-unary-minus": "off",
            "typescript/restrict-template-expressions": "off",
            // React Compiler rules. Vencord renders inside Discord's React and doesn't use the compiler.
            "react/immutability": "off",
            "react/globals": "off",
            "react/purity": "off",
            "react/static-components": "off",
            "react/react-in-jsx-scope": "off",
            // Not enforced before the move to oxlint; plugins often pin deps on purpose.
            "react-hooks/exhaustive-deps": "off"
        },
        overrides: [
            {
                files: ["src/**", "scripts/**", "oxlint-plugin-vencord/**", "vite.config.ts"],
                rules: { "vencord/license-header": "error" }
            },
            {
                files: ["src/**"],
                rules: { "vencord/no-relative-parent-import": "error" }
            },
            {
                // Plain scripts injected into pages, kept close to what the browser runs.
                files: ["browser/**/*.js"],
                rules: { "eslint/prefer-spread": "off", "unicorn/no-empty-file": "off" }
            }
        ],
        options: {
            reportUnusedDisableDirectives: "error",
            typeAware: true,
            typeCheck: true
        }
    }
});

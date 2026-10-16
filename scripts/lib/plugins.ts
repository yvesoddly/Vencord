/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parseSync } from "vite/rolldown/utils";

import { PluginTargets, type PluginTarget } from "../../src/utils/pluginTargets.ts";

// oxc's ESTree types, pulled from parseSync so they track the installed parser.
type Program = ReturnType<typeof parseSync>["program"];
type Expression = Extract<Program["body"][number], { type: "ExpressionStatement" }>["expression"];
type ObjectExpression = Extract<Expression, { type: "ObjectExpression" }>;

export class PluginParseError extends Schema.TaggedError<PluginParseError>()("PluginParseError", {
    file: Schema.String,
    reason: Schema.String
}) {
    override get message() {
        return `Invalid plugin ${this.file}: ${this.reason}`;
    }
}

/** One plugin found under src/, before reading its definePlugin call. */
export interface PluginEntry {
    /** `src/<dir>/<fileName>` with `src/plugins/` stripped, as the runtime PluginMeta expects. */
    readonly folderName: string;
    /** Absolute path of the plugin file or directory. */
    readonly path: string;
    /** Absolute path of the module that calls definePlugin. */
    readonly entry: string;
    readonly target: PluginTarget | null;
    readonly userPlugin: boolean;
    /** Absolute path of `native.ts` or `native/index.ts`, when the plugin has one. */
    readonly native: string | null;
}

/** The statically readable fields of a definePlugin call. */
export interface PluginDefinition {
    readonly name: string;
    readonly description?: string;
    readonly authors?: ReadonlyArray<string>;
    readonly tags?: ReadonlyArray<string>;
    readonly searchTerms?: ReadonlyArray<string>;
    readonly dependencies?: ReadonlyArray<string>;
    readonly required: boolean;
    readonly enabledByDefault: boolean;
    readonly hasPatches: boolean;
    readonly hasCommands: boolean;
}

const PluginDirs = ["plugins/_api", "plugins/_core", "plugins", "userplugins"];

const isPluginTarget = (target: string): target is PluginTarget =>
    (PluginTargets as readonly string[]).includes(target);

/**
 * Reads the build target suffix from a plugin's file or folder name: `foo.desktop/index.ts` is
 * "desktop", `foo.ts` has none. Returns the raw suffix, which may not be a valid target.
 */
export function getPluginTarget(fileName: string) {
    const parts = fileName.split(/[/\\]/);
    if (/^index\.tsx?$/.test(parts.at(-1)!)) parts.pop();

    const bits = parts
        .at(-1)!
        .replace(/\.tsx?$/, "")
        .split(".");
    return bits.length === 1 ? null : bits.at(-1)!;
}

/** Lists every plugin under `<srcDir>/plugins` and `<srcDir>/userplugins`, in load order. */
export const listPlugins = Effect.fn("listPlugins")(function* (srcDir: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const firstExisting = Effect.fnUntraced(function* (candidates: ReadonlyArray<string>) {
        for (const candidate of candidates) if (yield* fs.exists(candidate)) return candidate;
        return null;
    });

    const entries: PluginEntry[] = [];
    for (const dir of PluginDirs) {
        const fullDir = path.join(srcDir, dir);
        if (!(yield* fs.exists(fullDir))) continue;

        for (const fileName of (yield* fs.readDirectory(fullDir)).sort()) {
            if (fileName.startsWith("_") || fileName.startsWith(".") || fileName === "index.ts") continue;

            const fullPath = path.join(fullDir, fileName);
            const isDirectory = (yield* fs.stat(fullPath)).type === "Directory";
            const entry = isDirectory
                ? yield* firstExisting([path.join(fullPath, "index.ts"), path.join(fullPath, "index.tsx")])
                : fullPath;
            if (!entry) return yield* new PluginParseError({ file: fullPath, reason: "could not resolve entry point" });

            const target = getPluginTarget(fileName);
            if (target !== null && !isPluginTarget(target))
                return yield* new PluginParseError({
                    file: fullPath,
                    reason: `invalid target ${target}, expected one of ${PluginTargets.join(", ")}`
                });

            entries.push({
                folderName: `${dir}/${fileName}`.replace(/^plugins\//, ""),
                path: fullPath,
                entry,
                target,
                userPlugin: dir === "userplugins",
                native:
                    isDirectory && !dir.startsWith("plugins/_")
                        ? yield* firstExisting([
                              path.join(fullPath, "native.ts"),
                              path.join(fullPath, "native", "index.ts")
                          ])
                        : null
            });
        }
    }
    return entries;
});

const parse = (file: string, source: string) => {
    const { program, errors } = parseSync(file, source);
    return errors.length
        ? Effect.fail(new PluginParseError({ file, reason: errors[0].message }))
        : Effect.succeed(program);
};

const propertyKey = (prop: ObjectExpression["properties"][number]) =>
    prop.type === "Property" && prop.key.type === "Identifier" ? prop.key.name : undefined;

const stringValue = (node: Expression) =>
    node.type === "Literal" && typeof node.value === "string"
        ? node.value
        : node.type === "TemplateLiteral" && node.expressions.length === 0
          ? (node.quasis[0].value.cooked ?? undefined)
          : undefined;

/** Reads the definePlugin call of a plugin entry without running it. */
export const readPluginDefinition = Effect.fn("readPluginDefinition")(function* (entry: string) {
    const fs = yield* FileSystem.FileSystem;
    const program = yield* parse(entry, yield* fs.readFileString(entry));
    const fail = (reason: string) => new PluginParseError({ file: entry, reason });

    const call = program.body.flatMap(node =>
        node.type === "ExportDefaultDeclaration" &&
        node.declaration.type === "CallExpression" &&
        node.declaration.callee.type === "Identifier" &&
        node.declaration.callee.name === "definePlugin"
            ? [node.declaration]
            : []
    )[0];
    if (!call) return yield* fail("no default export called 'definePlugin' found");

    const object = call.arguments[0];
    if (object?.type !== "ObjectExpression") return yield* fail("no object literal passed to definePlugin");

    const fields: Record<string, Expression> = {};
    for (const prop of object.properties) {
        const key = propertyKey(prop);
        if (key && prop.type === "Property") fields[key] = prop.value as Expression;
    }

    const strings = (key: string) => {
        const node = fields[key];
        if (!node) return Effect.succeed(undefined);
        if (node.type !== "ArrayExpression") return Effect.fail(fail(`${key} is not an array literal`));
        const values = node.elements.map(e => (e && e.type !== "SpreadElement" ? stringValue(e) : undefined));
        return values.every(v => v !== undefined)
            ? Effect.succeed(values)
            : Effect.fail(fail(`${key} array contains non-string literals`));
    };

    const name = fields.name && stringValue(fields.name);
    if (!name) return yield* fail("must contain definePlugin call with simple string name property");

    const authors = fields.authors;
    if (authors && authors.type !== "ArrayExpression") return yield* fail("authors is not an array literal");

    return {
        name,
        description: fields.description && stringValue(fields.description),
        authors: authors?.elements.map(e =>
            e?.type === "MemberExpression" && e.property.type === "Identifier" ? e.property.name : "?"
        ),
        tags: yield* strings("tags"),
        searchTerms: yield* strings("searchTerms"),
        dependencies: yield* strings("dependencies"),
        required: fields.required?.type === "Literal" && fields.required.value === true,
        enabledByDefault: fields.enabledByDefault?.type === "Literal" && fields.enabledByDefault.value === true,
        hasPatches: "patches" in fields,
        hasCommands: "commands" in fields
    } satisfies PluginDefinition;
});

/** Reads the `Devs` table from src/utils/constants.ts, keyed by property name. */
export const readDevs = Effect.fn("readDevs")(function* (constantsFile: string) {
    const fs = yield* FileSystem.FileSystem;
    const program = yield* parse(constantsFile, yield* fs.readFileString(constantsFile));
    const fail = (reason: string) =>
        new PluginParseError({ file: constantsFile, reason: `failed to parse Devs: ${reason}` });

    for (const node of program.body) {
        if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "VariableDeclaration") continue;

        const declarator = node.declaration.declarations.find(d => d.id.type === "Identifier" && d.id.name === "Devs");
        if (declarator?.init?.type !== "CallExpression") continue;

        const arg = declarator.init.arguments[0];
        const object = arg?.type === "TSSatisfiesExpression" ? arg.expression : arg;
        if (object?.type !== "ObjectExpression") return yield* fail("not an object literal");

        const devs: Record<string, { readonly name: string; readonly id: string }> = {};
        for (const prop of object.properties) {
            const key = propertyKey(prop);
            if (!key || prop.type !== "Property" || prop.value.type !== "ObjectExpression")
                return yield* fail(`${key ?? "?"} is not an object literal`);

            const value: Record<string, Expression> = {};
            for (const p of prop.value.properties)
                if (p.type === "Property" && propertyKey(p)) value[propertyKey(p)!] = p.value as Expression;

            const name = value.name && stringValue(value.name);
            const id = value.id?.type === "Literal" && "bigint" in value.id ? value.id.bigint : undefined;
            if (!name || !id) return yield* fail(`${key} needs a string name and a bigint id`);
            devs[key] = { name, id };
        }
        return devs;
    }

    return yield* fail("could not find Devs constant");
});

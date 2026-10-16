#!/usr/bin/env node
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Loads Discord's login page in headless Chrome with the reporter build (dist/browser.js from
// `vp run buildReporter`) injected, and reports every patch, webpack find and plugin start that
// failed. No Discord account is needed. Prints a Markdown report and exits 1 if anything broke.
//
//   node scripts/generateReport.ts [--branch stable|canary|both]
//
// CHROMIUM_BIN picks the browser; otherwise Chrome Headless Shell is downloaded into
// node_modules/.cache. WEBHOOK_URL (and optional WEBHOOK_SECRET) also posts the report to Discord.

import { createHmac } from "node:crypto";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
    Browser,
    computeExecutablePath,
    detectBrowserPlatform,
    getInstalledBrowsers,
    install,
    resolveBuildId
} from "@puppeteer/browsers";
import { Command, Flag } from "effect/cli";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import pup, { type ConsoleMessage, type JSHandle } from "puppeteer-core";

type Branch = "stable" | "canary";

interface PatchInfo {
    readonly plugin: string;
    readonly type: string;
    readonly id: string;
    readonly match: string;
    readonly error?: string;
}

/** What one run against one Discord branch found. */
interface Report {
    readonly branch: Branch;
    meta: { buildNumber: string; buildHash: string };
    readonly badPatches: PatchInfo[];
    readonly slowPatches: PatchInfo[];
    readonly badStarts: { plugin: string; error: string }[];
    readonly badWebpackFinds: string[];
    readonly otherErrors: string[];
    readonly ignoredErrors: string[];
}

export class ReporterError extends Schema.TaggedError<ReporterError>()("ReporterError", {
    branch: Schema.String,
    reason: Schema.String
}) {
    override get message() {
        return `${this.branch}: ${this.reason}`;
    }
}

const IGNORED_DISCORD_ERRORS: Array<string | RegExp> = [
    "KeybindStore: Looking for callback action",
    "Unable to process domain list delta: Client revision number is null",
    "Downloading the full bad domains file",
    /\[GatewaySocket\].{0,110}Cannot access '/,
    "search for 'name' in undefined",
    "Attempting to set fast connect zstd when unsupported"
];

const isBroken = (report: Report) =>
    report.badPatches.length + report.slowPatches.length + report.badStarts.length + report.badWebpackFinds.length > 0;

/** Uses CHROMIUM_BIN, or downloads Chrome Headless Shell into node_modules/.cache once. */
const resolveChrome = Effect.fn("resolveChrome")(function* (rootDir: string) {
    const fromEnv = (yield* Config.option(Config.String("CHROMIUM_BIN"))).pipe(Option.filter(bin => bin.length > 0));
    if (Option.isSome(fromEnv)) return fromEnv.value;

    const cacheDir = `${rootDir}/node_modules/.cache/chrome`;
    const browser = Browser.CHROMEHEADLESSSHELL;
    const installed = yield* Effect.promise(() => getInstalledBrowsers({ cacheDir }));
    const existing = installed.find(b => b.browser === browser);
    if (existing) return existing.executablePath;

    const platform = detectBrowserPlatform();
    if (!platform)
        return yield* new ReporterError({
            branch: "both",
            reason: "Unsupported platform for Chrome downloads, set CHROMIUM_BIN"
        });

    yield* Effect.logInfo("Downloading Chrome Headless Shell for the reporter...");
    const buildId = yield* Effect.promise(() => resolveBuildId(browser, platform, "stable"));
    yield* Effect.promise(() => install({ browser, buildId, cacheDir }));
    return computeExecutablePath({ browser, buildId, cacheDir });
});

const errorMessage = (handle: JSHandle | undefined) =>
    (handle as JSHandle<Error> | undefined)
        ?.getProperty("message")
        .then(m => m.jsonValue() as Promise<string | undefined>)
        .catch(() => undefined) ?? Promise.resolve(undefined);

const messageText = (message: ConsoleMessage, skipFirst = true) =>
    Effect.promise(() =>
        Promise.all(
            message
                .args()
                .slice(skipFirst ? 1 : 0)
                .map(async a => (await errorMessage(a)) || (await a.jsonValue()))
        )
            .then(a => a.join(" ").trim())
            .catch(() => message.text())
    );

type PageEvent =
    | { readonly kind: "console"; readonly message: ConsoleMessage }
    | { readonly kind: "pageerror"; readonly error: Error };

/** Handles one browser event. Returns "done" once the reporter says it finished. */
const handleEvent = Effect.fnUntraced(function* (report: Report, event: PageEvent) {
    const log = (...data: unknown[]) => Effect.logInfo(`${report.branch.toUpperCase()} ---`, ...data);

    if (event.kind === "pageerror") {
        const { message } = event.error;
        if (message.includes("Sentry successfully disabled")) return "continue";
        if (!message.startsWith("Object") && !message.includes("Cannot find module") && !/^.{1,2}$/.test(message)) {
            yield* log("[Page Error]", message);
            report.otherErrors.push(message);
        } else {
            report.ignoredErrors.push(message);
        }
        return "continue";
    }

    const { message } = event;
    const args = message.args();
    const first = yield* Effect.promise(
        () => args[0]?.jsonValue().catch(() => undefined) ?? Promise.resolve(undefined)
    );

    if (first === "[REPORTER_META]") {
        report.meta = yield* Effect.promise(() => args[1].jsonValue() as Promise<Report["meta"]>);
        return "continue";
    }
    if (first === "[PUP_DEBUG]") {
        yield* log(yield* messageText(message));
        return "continue";
    }

    if (first === "[Vencord]") {
        const values = yield* Effect.promise(() => Promise.all(args.map(a => a.jsonValue())).catch(() => null));
        const [, tag, text, other] = (values ?? []) as string[];

        switch (tag) {
            case "WebpackPatcher:": {
                const failed = text.match(
                    /Patch by (.+?) (had no effect|errored|found no module) \(Module id is (.+?)\): (.+)/
                );
                const slow = text.match(/Patch by (.+?) (took [\d.]+?ms) \(Module id is (.+?)\): (.+)/);
                const match = failed ?? slow;
                if (!match) break;

                yield* log(yield* messageText(message));
                const [, plugin, type, id, regex] = match;
                const error = yield* Effect.promise(() => errorMessage(args[3]));
                (failed ? report.badPatches : report.slowPatches).push({ plugin, type, id, match: regex, error });
                break;
            }
            case "PluginManager:": {
                const failedToStart = text.match(/Failed to start (.+)/);
                if (!failedToStart) break;

                yield* log(yield* messageText(message));
                const error = yield* Effect.promise(() => errorMessage(args[3]));
                report.badStarts.push({ plugin: failedToStart[1], error: error ?? "Unknown error" });
                break;
            }
            case "LazyChunkLoader:":
                yield* log(yield* messageText(message));
                if (text === "A fatal error occurred:")
                    return yield* new ReporterError({ branch: report.branch, reason: "the lazy chunk loader crashed" });
                break;
            case "Reporter:":
                yield* log(yield* messageText(message));
                if (text === "A fatal error occurred:")
                    return yield* new ReporterError({ branch: report.branch, reason: "the reporter crashed" });
                if (text === "Webpack Find Fail:") report.badWebpackFinds.push(other);
                if (text === "Finished test") return "done";
                break;
        }
        return "continue";
    }

    if (message.type() === "error") {
        const text = yield* messageText(message, false);
        if (
            text.length &&
            !text.startsWith("Failed to load resource: the server responded with a status of") &&
            !text.includes("Webpack")
        ) {
            if (IGNORED_DISCORD_ERRORS.some(e => text.match(e))) {
                report.ignoredErrors.push(text);
            } else {
                yield* log("[Unexpected Error]", text);
                report.otherErrors.push(text);
            }
        }
    }
    return "continue";
});

/** Runs the reporter build against one Discord branch and collects what it reports. */
const runBranch = Effect.fn("runBranch")(function* (branch: Branch, chrome: string, script: string) {
    const report: Report = {
        branch,
        meta: { buildNumber: "Unknown Build Number", buildHash: "Unknown Build Hash" },
        badPatches: [],
        slowPatches: [],
        badStarts: [],
        badWebpackFinds: [],
        otherErrors: [],
        ignoredErrors: []
    };

    const browser = yield* Effect.acquireRelease(
        Effect.promise(() => pup.launch({ headless: true, executablePath: chrome, args: ["--no-sandbox"] })),
        browser => Effect.promise(() => browser.close())
    );
    const page = yield* Effect.promise(() => browser.newPage());
    yield* Effect.promise(() =>
        page.setUserAgent({
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
        })
    );
    yield* Effect.promise(() => page.setBypassCSP(true));

    const events = Stream.callback<PageEvent>(queue =>
        Effect.sync(() => {
            page.on("console", message => Queue.offerUnsafe(queue, { kind: "console", message }));
            page.on("pageerror", error => Queue.offerUnsafe(queue, { kind: "pageerror", error: error as Error }));
        })
    );

    const finished = yield* events.pipe(
        Stream.mapEffect(event => handleEvent(report, event)),
        Stream.takeUntil(result => result === "done"),
        Stream.runDrain,
        Effect.forkScoped
    );

    yield* Effect.promise(() =>
        page.evaluateOnNewDocument(`if (location.host.endsWith("discord.com")) {\n${script};\n}`)
    );
    yield* Effect.promise(() =>
        page.goto(branch === "canary" ? "https://canary.discord.com/login" : "https://discord.com/login")
    );

    yield* Fiber.join(finished).pipe(
        Effect.timeoutOrElse({
            duration: "10 minutes",
            orElse: () =>
                Effect.fail(new ReporterError({ branch, reason: "timed out waiting for the reporter to finish" }))
        })
    );
    return report;
}, Effect.scoped);

const codeBlock = (s: string, indentation = 0, isDiscord = false) => {
    s = s.replace(/```/g, "`​`​`");
    const indent = " ".repeat(isDiscord ? 0 : indentation);
    return `\`\`\`\n${s
        .split("\n")
        .map(line => indent + line)
        .join("\n")}\n${indent}\`\`\``;
};

function toMarkdown(report: Report) {
    const lines = [`# Vencord Report${report.branch === "canary" ? " (Canary)" : ""}`, ""];
    const section = (title: string, items: string[]) => lines.push(`## ${title}`, ...items, "");

    section(
        "Bad Patches",
        report.badPatches.flatMap(p => [
            `- ${p.plugin} (${p.type})`,
            `  - ID: \`${p.id}\``,
            `  - Match: ${codeBlock(p.match, "  - Match: ".length)}`,
            ...(p.error ? [`  - Error: ${codeBlock(p.error, "  - Error: ".length)}`] : [])
        ])
    );
    section(
        "Slow Patches",
        report.slowPatches.map(p => `- ${p.plugin} (${p.type}): \`${p.id}\``)
    );
    section(
        "Bad Webpack Finds",
        report.badWebpackFinds.map(f => `- ${codeBlock(f, "- ".length)}`)
    );
    section(
        "Bad Starts",
        report.badStarts.flatMap(p => [`- ${p.plugin}`, `  - Error: ${codeBlock(p.error, "  - Error: ".length)}`])
    );
    section(
        "Discord Errors",
        report.otherErrors.map(e => `- ${codeBlock(e, "- ".length)}`)
    );
    section(
        "Ignored Discord Errors",
        report.ignoredErrors.map(e => `- ${codeBlock(e, "- ".length)}`)
    );
    return lines.join("\n");
}

function toWebhookBody(report: Report) {
    const canary = report.branch === "canary";
    const patchesEmbed = (title: string, patches: PatchInfo[], color: number) => ({
        title,
        color,
        description: patches
            .map(p =>
                [
                    `**__${p.plugin} (${p.type}):__**`,
                    `ID: \`${p.id}\``,
                    `Match: ${codeBlock(p.match, "Match: ".length, true)}`,
                    ...(p.error ? [`Error: ${codeBlock(p.error, "Error: ".length, true)}`] : [])
                ].join("\n")
            )
            .join("\n\n")
    });

    const embeds = [
        {
            author: {
                name: `Discord ${canary ? "Canary" : "Stable"} (${report.meta.buildNumber})`,
                url: `https://nelly.tools/builds/app/${report.meta.buildHash}`,
                icon_url: canary
                    ? "https://cdn.discordapp.com/emojis/1252721945699549327.png?size=128"
                    : "https://cdn.discordapp.com/emojis/1252721943463985272.png?size=128"
            },
            color: canary ? 0xfbb642 : 0x5865f2
        },
        report.badPatches.length > 0 && patchesEmbed("Bad Patches", report.badPatches, 0xff0000),
        report.slowPatches.length > 0 && patchesEmbed("Slow Patches", report.slowPatches, 0xf0b232),
        report.badWebpackFinds.length > 0 && {
            title: "Bad Webpack Finds",
            description: report.badWebpackFinds.map(f => codeBlock(f, 0, true)).join("\n"),
            color: 0xff0000
        },
        report.badStarts.length > 0 && {
            title: "Bad Starts",
            description: report.badStarts.map(p => `**__${p.plugin}:__**\n${codeBlock(p.error, 0, true)}`).join("\n\n"),
            color: 0xff0000
        },
        report.otherErrors.length > 0 && {
            title: "Discord Errors",
            description: codeBlock(report.otherErrors.join("\n"), 0, true),
            color: 0xff0000
        }
    ].filter(Boolean);

    if (embeds.length === 1)
        embeds.push({
            title: "No issues found",
            description: "Seems like everything is working fine (for now) <:shipit:1330992641466433556>",
            color: 0x00ff00
        });

    return JSON.stringify({ username: `Vencord Reporter${canary ? " (Canary)" : ""}`, embeds });
}

/** Posts to WEBHOOK_URL. WEBHOOK_SECRET signs the body the way GitHub signs webhook deliveries. */
const postWebhook = Effect.fn("postWebhook")(function* (url: string, report: Report) {
    const client = yield* HttpClient.HttpClient;
    const secret = yield* Config.option(Config.String("WEBHOOK_SECRET"));
    const body = toWebhookBody(report);

    const response = yield* HttpClientRequest.post(url).pipe(
        HttpClientRequest.bodyText(body, "application/json"),
        HttpClientRequest.setHeaders(
            Option.isSome(secret)
                ? { "X-Signature": "sha256=" + createHmac("sha256", secret.value).update(body).digest("hex") }
                : {}
        ),
        client.execute
    );
    if (response.status >= 300) yield* Effect.logError(`Webhook failed with status ${response.status}`);
});

const report = Command.make(
    "report",
    {
        branch: Flag.Literals("branch", ["stable", "canary", "both"]).pipe(
            Flag.withDescription("Discord branch to test against"),
            Flag.withDefault("both")
        )
    },
    Effect.fn(function* ({ branch }) {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const rootDir = path.resolve(import.meta.dirname, "..");

        const scriptPath = path.join(rootDir, "dist/browser.js");
        if (!(yield* fs.exists(scriptPath)))
            return yield* new ReporterError({
                branch,
                reason: "dist/browser.js is missing, run `vp run buildReporter` first"
            });
        const script = yield* fs.readFileString(scriptPath);
        const chrome = yield* resolveChrome(rootDir);

        const branches: Branch[] = branch === "both" ? ["stable", "canary"] : [branch];
        const reports = yield* Effect.forEach(branches, b => runBranch(b, chrome, script), {
            concurrency: "unbounded"
        });

        const webhook = (yield* Config.option(Config.String("WEBHOOK_URL"))).pipe(Option.filter(url => url.length > 0));
        for (const r of reports) {
            yield* Console.log(toMarkdown(r));
            if (Option.isSome(webhook)) yield* postWebhook(webhook.value, r);
        }

        if (reports.some(isBroken))
            return yield* new ReporterError({ branch, reason: "found broken patches, finds or plugins" });
    })
);

report.pipe(
    Command.run({ version: "1.0.0" }),
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
    Effect.provideService(Logger.LogToStderr, true),
    NodeRuntime.runMain
);

/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vite-plus/test";

import { PluginTargets } from "../../src/utils/pluginTargets.ts";
import { getPluginTarget } from "../lib/plugins.ts";
import { isExcluded, type RendererKind } from "./plugins.ts";

describe("plugin targets", () => {
    it("reads the suffix from files and folders", () => {
        expect(getPluginTarget("petpet")).toBe(null);
        expect(getPluginTarget("petpet.ts")).toBe(null);
        expect(getPluginTarget("webRichPresence.web.tsx")).toBe("web");
        expect(getPluginTarget("shikiCodeblocks.desktop/index.ts")).toBe("desktop");
        expect(getPluginTarget("plugins/devCompanion.dev/index.tsx")).toBe("dev");
    });

    it("ships each target only to the clients it names", () => {
        const kinds: RendererKind[] = ["web", "discordDesktop", "vesktop"];
        const shipsTo = (dev: boolean) =>
            Object.fromEntries(
                [null, ...PluginTargets].map(target => [
                    String(target),
                    kinds.filter(kind => !isExcluded(target, kind, { dev, reporter: false }))
                ])
            );

        expect(shipsTo(false)).toEqual({
            null: ["web", "discordDesktop", "vesktop"],
            web: ["web", "vesktop"],
            browser: ["web"],
            discordDesktop: ["discordDesktop"],
            vesktop: ["vesktop"],
            desktop: ["discordDesktop", "vesktop"],
            dev: []
        });
        expect(shipsTo(true).dev).toEqual(["web", "discordDesktop", "vesktop"]);
    });

    it("keeps every plugin in reporter builds", () => {
        for (const target of PluginTargets)
            expect(isExcluded(target, "web", { dev: false, reporter: true })).toBe(false);
    });
});

/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare module "~plugins" {
    import { PluginTarget } from "@utils/pluginTargets";
    const plugins: Record<string, import("./utils/types").Plugin>;

    export default plugins;
    export const PluginMeta: Record<
        string,
        {
            folderName: string;
            userPlugin: boolean;
        }
    >;
    export const ExcludedPlugins: Record<string, PluginTarget>;
}

declare module "~git-hash" {
    const hash: string;
    export default hash;
}
declare module "~git-remote" {
    const remote: string;
    export default remote;
}

declare module "file://*" {
    const content: string;
    export default content;
}

declare module "*.css";

declare module "*.css?managed" {
    const name: string;
    export default name;
}

// virtual-merge ships types, but its exports map has no "types" condition, so bundler resolution can't find them
declare module "virtual-merge" {
    type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

    export default function virtualMerge<O extends object[]>(...objects: O): UnionToIntersection<O[number]>;
}

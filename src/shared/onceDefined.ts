/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LiteralUnion } from "type-fest";

/**
 * Wait for a property to be defined on the target, then call the callback with
 * the value
 * @param target Object
 * @param property Property to be defined
 * @param callback Callback
 *
 * @example onceDefined(window, "webpackChunkdiscord_app", wpInstance => wpInstance.push(...));
 */
export function onceDefined<T extends object, P extends LiteralUnion<keyof T, PropertyKey>>(
    target: T,
    property: P,
    callback: (v: P extends keyof T ? T[P] : any) => void
): void {
    if (property in target) return void callback(Reflect.get(target, property));

    Object.defineProperty(target, property, {
        set(v) {
            Reflect.deleteProperty(target, property);
            Reflect.set(target, property, v);
            callback(v);
        },
        configurable: true,
        enumerable: false
    });
}

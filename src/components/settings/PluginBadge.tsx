/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

export function AddonBadge({ text, color }: { text: ReactNode; color: string }) {
    return (
        <div
            className="vc-addon-badge"
            style={{
                backgroundColor: color,
                justifySelf: "flex-end",
                marginLeft: "auto"
            }}
        >
            {text}
        </div>
    );
}

/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Heart } from "@components/Heart";
import { ButtonProps } from "@vencord/discord-types";
import { Button } from "@webpack/common";

export default function DonateButton({
    look = Button.Looks.LINK,
    color = Button.Colors.TRANSPARENT,
    ...props
}: Partial<ButtonProps>) {
    return (
        <Button
            {...props}
            look={look}
            color={color}
            onClick={() => VencordNative.native.openExternal("https://github.com/sponsors/Vendicated")}
            className="vc-donate-button"
        >
            <Heart />
            Donate
        </Button>
    );
}

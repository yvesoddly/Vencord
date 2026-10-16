/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@utils/margins";
import type { ReplaceFn } from "@utils/types";
import { Forms, Parser, TextInput, useEffect, useState } from "@webpack/common";
import type { SetStateAction } from "react";

const RegexGuide = {
    "\\i": "Special regex escape sequence that matches identifiers (varnames, classnames, etc.)",
    $$: "Insert a $",
    "$&": "Insert the entire match",
    "$`\u200b": "Insert the substring before the match",
    "$'": "Insert the substring after the match",
    $n: "Insert the nth capturing group ($1, $2...)",
    $self: "Insert the plugin instance"
} as const;

interface ReplacementInputProps {
    replacement: string | ReplaceFn;
    setReplacement(v: SetStateAction<string | ReplaceFn>): void;
    replacementError: string | undefined;
}

export function ReplacementInput({ replacement, setReplacement, replacementError }: ReplacementInputProps) {
    const [isFunc, setIsFunc] = useState(false);
    const [error, setError] = useState<string>();

    function onChange(v: string | ReplaceFn) {
        setError(void 0);

        if (isFunc) {
            try {
                // indirect eval returns non-string values as is
                const func = typeof v === "string" ? (0, eval)(v) : v;
                if (typeof func === "function") setReplacement(() => func);
                else setError("Replacement must be a function");
            } catch (e) {
                setReplacement(v);
                setError((e as Error).message);
            }
        } else {
            setReplacement(v);
        }
    }

    useEffect(() => {
        if (isFunc) onChange(replacement);
        else setError(void 0);
    }, [isFunc]);

    return (
        <>
            {/* FormTitle adds a class if className is not set, so we set it to an empty string to prevent that */}
            <Forms.FormTitle className="">Replacement</Forms.FormTitle>
            <TextInput value={replacement?.toString()} onChange={onChange} error={error ?? replacementError} />
            {!isFunc && (
                <div>
                    <Forms.FormTitle className={Margins.top8}>Cheat Sheet</Forms.FormTitle>

                    {Object.entries(RegexGuide).map(([placeholder, desc]) => (
                        <Forms.FormText key={placeholder}>
                            {Parser.parse("`" + placeholder + "`")}: {desc}
                        </Forms.FormText>
                    ))}
                </div>
            )}

            <FormSwitch
                className={Margins.top16}
                value={isFunc}
                onChange={setIsFunc}
                title={"Treat Replacement as function"}
                description='"Replacement" will be evaluated as a function if this is enabled'
                hideBorder
            />
        </>
    );
}

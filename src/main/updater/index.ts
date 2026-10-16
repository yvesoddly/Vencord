/*
 * Vencord, a Discord client mod
 * Copyright (c) 2022 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { registerUpdater } from "./common";
import { GitUpdater } from "./git";
import { HttpUpdater } from "./http";

if (!IS_UPDATER_DISABLED) registerUpdater(IS_STANDALONE ? HttpUpdater : GitUpdater);

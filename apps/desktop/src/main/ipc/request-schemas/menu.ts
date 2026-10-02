import { z } from 'zod';

import type { MenuCommandId } from '../../../shared/menu-commands';
import { MENU_COMMANDS } from '../../../shared/menu-commands';

const menuCommandIdSchema = z.enum(
	Object.keys(MENU_COMMANDS) as [MenuCommandId, ...MenuCommandId[]],
);

const menuDynamicEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
});

/**
 * Validates the menu context the renderer reports. Lenient in the sense that a
 * malformed report is rejected rather than thrown back: the handler keeps the
 * last good context, so a bad payload leaves the menu as it was instead of
 * failing an invoke the renderer does not await for a result.
 */
export const menuContextSchema = z.object({
	chatTabs: z.array(menuDynamicEntrySchema),
	checked: z.array(menuCommandIdSchema),
	commands: z.array(menuCommandIdSchema),
	openTargets: z.array(menuDynamicEntrySchema),
	recentProjects: z.array(menuDynamicEntrySchema),
	runScripts: z.array(menuDynamicEntrySchema),
});

/**
 * Validates a row the app-drawn menu bar reports the user picked. The id is
 * opaque — main resolves it against the revision that minted it — so nothing
 * beyond its shape can be checked here.
 */
export const menuBarInvokeRequestSchema = z.object({
	id: z.string(),
	revision: z.number().int().nonnegative(),
});

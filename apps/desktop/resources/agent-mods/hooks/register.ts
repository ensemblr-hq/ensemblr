/**
 * Ensemblr's Claude Code mods, registered together from the one hooks module
 * the plugin's `hooks/hooks.json` names. Each mod is UI-free: Ensemblr hosts
 * Claude Code over the SDK, where no pane, band, status line, or toast draws.
 */
import type { Register } from 'claude-code';

import { registerCompactKeeper } from './compact-keeper.ts';
import { registerGitGuard } from './git-guard.ts';
import { registerSecretRedact } from './secret-redact.ts';
import { registerTicketContext } from './ticket-context.ts';

/**
 * Registers every mod's hooks.
 * @param on - The plugin's registrar.
 */
export const register: Register = (on) => {
	registerGitGuard(on);
	registerSecretRedact(on);
	registerCompactKeeper(on);
	registerTicketContext(on);
};

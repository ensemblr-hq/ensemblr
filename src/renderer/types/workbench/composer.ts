import type {
	PiSlashCommandSource,
	PiSlashCommandSourceScope,
} from '@/shared/ipc/contracts/pi-session';

import type { ComposerModelOption } from './workspace';

/** One provider group inside the model selector menu. */
export interface GroupedOptions {
	provider: string;
	providerLabel: string;
	models: ComposerModelOption[];
}

/** Describes a slash command surfaced in the composer autocomplete. */
export interface SlashCommandDescriptor {
	/** Bare command name without the leading slash. */
	command: string;
	description: string;
	/** Source category used to label project/user Pi resources in autocomplete. */
	source: PiSlashCommandSource;
	/** Scope used to rank project skills before global skills in autocomplete. */
	sourceScope?: PiSlashCommandSourceScope;
	/** When true, command runs immediately on pick (no args expected). */
	autoSubmit: boolean;
}

/** Minimal linked-issue shape needed to seed the composer draft. */
export interface LinkedIssueComposerSeedInput {
	description?: string;
	reference: string;
	title: string;
	url?: string;
}

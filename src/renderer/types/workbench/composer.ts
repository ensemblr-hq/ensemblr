import type {
	PiSlashCommandSource,
	PiSlashCommandSourceScope,
} from '@/shared/ipc/contracts/agent-session';

import type { ComposerModelOption } from './workspace';

/**
 * One selectable row in the model selector: a model plus whether the chat's
 * agent-runtime pin locks it out. Locked rows stay in the list and render
 * disabled — dropping them would make the list silently shrink from one chat to
 * the next, which reads as a bug.
 */
export interface ModelPickerRow {
	locked: boolean;
	model: ComposerModelOption;
}

/** One provider group inside the model selector menu. */
export interface GroupedOptions {
	provider: string;
	providerLabel: string;
	models: ModelPickerRow[];
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

/** Discrete thinking-effort strength from 0 (off) to 5 (extra-high). */
export type ThinkingBarStrength = 0 | 1 | 2 | 3 | 4 | 5;

/** Minimal linked-issue shape needed to seed the composer draft. */
export interface LinkedIssueComposerSeedInput {
	description?: string;
	reference: string;
	title: string;
	url?: string;
}

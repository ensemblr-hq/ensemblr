import type { MatchRange } from '@/renderer/lib/workbench/fuzzy-score';
import type {
	AgentProviderSlashCommandScope,
	AgentProviderSlashCommandSource,
} from '@/shared/ipc/contracts/agent-provider';

import type { ComposerModelOption, WorkspaceFileSummary } from './workspace';

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
	/** What registered the command; unset for a runtime that reports no provenance. */
	source?: AgentProviderSlashCommandSource;
	/** Scope used to rank project skills before global skills in autocomplete. */
	sourceScope?: AgentProviderSlashCommandScope;
	/** When true, command runs immediately on pick (no args expected). */
	autoSubmit: boolean;
}

/** One ranked slash-command row plus the spans of its name that matched the query. */
export interface SlashCommandMatch {
	item: SlashCommandDescriptor;
	ranges: readonly MatchRange[];
}

/** One ranked mention row plus the spans of its name and path that matched the query. */
export interface MentionMatch {
	entry: WorkspaceFileSummary;
	nameRanges: readonly MatchRange[];
	pathRanges: readonly MatchRange[];
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

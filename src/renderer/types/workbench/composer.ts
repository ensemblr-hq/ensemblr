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

/**
 * Everything the composer can carry alongside the typed message, in one ordered
 * list. `id` is what dedupes an add and targets a remove; `label` is what the
 * chip reads. The variants differ only in where their content lives — a
 * repo-relative path, an absolute path outside the tree, or an in-memory file
 * awaiting its first write.
 */
export type ComposerAttachment =
	| {
			id: string;
			/** True when git ignores the file; the chip dims to match the file tree. */
			isIgnored?: boolean;
			kind: 'workspace-file';
			label: string;
			path: string;
	  }
	| {
			id: string;
			kind: 'workspace-directory';
			label: string;
			path: string;
	  }
	| {
			absolutePath: string;
			id: string;
			kind: 'external-file';
			label: string;
			sizeBytes: number;
	  }
	| {
			id: string;
			kind: 'pasted-text';
			label: string;
			/** How many lines the pasted block ran to, for the chip's meta row. */
			lineCount: number;
			path: string;
			/** Opening of the pasted text, capped so the chip can show what it holds. */
			preview: string;
	  }
	| {
			id: string;
			kind: 'issue';
			label: string;
			/** Path of the markdown document the issue was written out to. */
			path: string;
			/** Which tracker the issue came from; the chip wears its brand mark. */
			provider: 'github' | 'linear';
	  };

/**
 * A directory outside the workspace that a chat has been given access to. Unlike
 * a {@link ComposerAttachment} this is not cleared on send: it stays linked for
 * the chat until the user removes it, and rides every `openAgentSession` call so
 * the runtime can grant the agent real read access.
 */
export interface LinkedDirectory {
	/** Basename of the directory, shown as the chip's title. */
	name: string;
	/** Absolute path, exactly as the user picked it. */
	path: string;
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

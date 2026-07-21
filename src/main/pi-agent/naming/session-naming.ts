import type { DatabaseSync } from 'node:sqlite';

import type { AppSettingsService } from '../../config';
import type { PiExecutableSnapshot } from '../../pi-runtime';
import type { RenameWorkspaceService } from '../../repository';
import { parseMetadata } from '../../repository/metadata.ts';
import {
	getChatTabById,
	renameChatTab,
	setChatTabMetadata,
} from '../../storage/repositories/chat-tab-repository.ts';
import { listTurns } from '../../storage/repositories/pi-session-repository.ts';
import { selectWorkspaceWithRepositoryById } from '../../storage/repositories/workspace-repository.ts';
import { extractAgentMessageText } from '../agent-message-text.ts';
import {
	composeRenamedBranch,
	shouldAutoRenameWorkspace,
} from '../branch-name-slug.ts';
import type { PiAgentClient, PiAgentSession } from '../pi-agent-client.ts';
import {
	appendChatTitleMetadataEvent,
	appendWorkspaceRenamedMetadataEvent,
} from '../pi-session-persistence.ts';
import type { PiSessionEventSink } from '../pi-session-types.ts';
import { stripPromptScaffolding } from './derive-title-source.ts';
import { parseBranchSlug } from './parse-naming-response.ts';
import { sanitizeChatTitle } from './sanitize-title.ts';

/** Time budget for the single ephemeral naming session. */
export const NAMING_TIMEOUT_MS = 20000;

/**
 * Per-session payload for one naming attempt. Built at session open (with the
 * user's first prompt) and again on each turn-idle (with `initialPrompt` null,
 * so the coordinator recovers the prompt from the first persisted turn).
 */
export interface SessionNamingInput {
	branchId: string;
	chatTabId: string;
	database: DatabaseSync;
	eventSink: PiSessionEventSink | undefined;
	executable: PiExecutableSnapshot;
	/** The first user prompt when known; null on idle retries. */
	initialPrompt: string | null;
	/** Live Pi session for the tab, polled for its user-set name; null when unavailable. */
	liveSession: PiAgentSession | null;
	/** Chat model mirrored in the ephemeral branch-naming session; null = Pi default. */
	model: string | null;
	sessionId: string;
	workspaceCwd: string;
	workspaceId: string;
}

/** Dependencies for {@link createSessionNaming}. */
interface SessionNamingDeps {
	appSettingsService: AppSettingsService;
	piAgentClient: PiAgentClient;
	renameWorkspace: RenameWorkspaceService['rename'];
	timeoutMs?: number;
}

/** Title provenance/naming flags read from a chat tab's metadata blob. */
interface TitleNamingState {
	autoNamed: boolean;
	userOwned: boolean;
}

/** The workspace branch + metadata consulted by the branch-rename gate. */
interface WorkspaceRenameTarget {
	branchName: string | null;
	metadataJson: string;
}

/**
 * Builds the unified naming coordinator that owns both chat-tab titling and
 * auto branch renaming. The title is derived deterministically (Pi's session
 * name, else the first message) with no LLM; a throwaway Pi session
 * (`ensemblr-session-naming`) is spawned only when a branch slug is still
 * needed, so a tab with branch rename off never opens an agent. Each field is
 * persisted behind its own idempotent gate — produced only while still
 * auto-owned and unset — so firing at open and again at every turn-idle can
 * never clobber a settled name; it simply retries fields that failed or were
 * skipped. Bad, partial, or timed-out branch output is discarded (never
 * persisted) and retried next turn. An in-flight guard keyed by chat tab drops
 * overlapping attempts (the open-time fire and the first turn-idle fire race for
 * the same tab).
 * @param deps - Settings reader, Pi client, workspace-rename entry point.
 * @returns A fire-and-forget `queueNaming(input)` to call from open and idle.
 */
export function createSessionNaming({
	appSettingsService,
	piAgentClient,
	renameWorkspace,
	timeoutMs = NAMING_TIMEOUT_MS,
}: SessionNamingDeps): (input: SessionNamingInput) => void {
	const inFlight = new Set<string>();
	return (input) => {
		if (inFlight.has(input.chatTabId)) {
			return;
		}
		inFlight.add(input.chatTabId);
		void runNaming({
			appSettingsService,
			input,
			piAgentClient,
			renameWorkspace,
			timeoutMs,
		})
			.catch((cause: unknown) => {
				console.warn('[pi-session] session naming failed', {
					cause: cause instanceof Error ? cause.message : String(cause),
					chatTabId: input.chatTabId,
				});
			})
			.finally(() => {
				inFlight.delete(input.chatTabId);
			});
	};
}

/** Runs one gated naming attempt: derive+persist the title, then the branch slug. */
async function runNaming({
	appSettingsService,
	input,
	piAgentClient,
	renameWorkspace,
	timeoutMs,
}: {
	appSettingsService: AppSettingsService;
	input: SessionNamingInput;
	piAgentClient: PiAgentClient;
	renameWorkspace: RenameWorkspaceService['rename'];
	timeoutMs: number;
}): Promise<void> {
	const prompt = resolvePrompt(input);
	if (!prompt) {
		return;
	}

	const wantTitle = titleNeedsNaming(input.database, input.chatTabId);
	const target = readRenameTarget(input.database, input.workspaceId);
	const wantBranch =
		target !== null &&
		shouldAutoRenameWorkspace({
			metadata: parseMetadata(target.metadataJson),
			prompt,
			renameEnabled: appSettingsService.read().git.renameWorkspaceOnBranch,
		});

	if (!wantTitle && !wantBranch) {
		return;
	}

	if (wantTitle) {
		const title = await deriveDeterministicTitle(input, prompt);
		if (title) {
			persistTitle({ input, title });
		}
	}

	if (wantBranch && target) {
		const slug = await generateBranchSlug({
			executable: input.executable,
			model: input.model,
			piAgentClient,
			prompt,
			timeoutMs,
			workspaceCwd: input.workspaceCwd,
		});
		if (slug) {
			await persistBranch({ input, renameWorkspace, slug, target });
		}
	}
}

/**
 * Resolves the deterministic tab title without an LLM: Pi's user-set session
 * name when present, else the user's first message with the composer/master-
 * prompt scaffolding stripped. A `get_state` miss/error falls back to the
 * message and never blocks or spawns a session.
 * @param input - The naming payload carrying the live session and first prompt.
 * @param prompt - The already-resolved first user prompt.
 * @returns A sanitized title, or null when nothing usable remains.
 */
async function deriveDeterministicTitle(
	input: SessionNamingInput,
	prompt: string,
): Promise<string | null> {
	const sessionName = (
		await input.liveSession?.getState().catch(() => null)
	)?.sessionName?.trim();
	if (sessionName) {
		return sanitizeChatTitle(sessionName);
	}
	return sanitizeChatTitle(stripPromptScaffolding(prompt));
}

/** Uses the passed first prompt, else recovers it from the first persisted turn. */
function resolvePrompt(input: SessionNamingInput): string | null {
	const passed = input.initialPrompt?.trim();
	if (passed) {
		return passed;
	}
	const firstTurn = listTurns({
		branchId: input.branchId,
		database: input.database,
	}).at(0);
	const recovered = firstTurn?.promptText.trim();
	return recovered && recovered.length > 0 ? recovered : null;
}

/** True when the tab still carries an auto title that has not yet been set. */
function titleNeedsNaming(database: DatabaseSync, chatTabId: string): boolean {
	const state = readTitleNamingState(database, chatTabId);
	if (!state) {
		return false;
	}
	return !state.autoNamed && !state.userOwned;
}

/** Reads the title provenance flags from a tab, or null when the tab is gone. */
function readTitleNamingState(
	database: DatabaseSync,
	chatTabId: string,
): TitleNamingState | null {
	const tab = getChatTabById({ database, id: chatTabId });
	if (!tab) {
		return null;
	}
	return {
		autoNamed: tab.metadata.titleAutoNamed === true,
		userOwned: tab.metadata.titleProvenance === 'user',
	};
}

/** Reads the current branch + metadata JSON for the workspace, or null. */
function readRenameTarget(
	database: DatabaseSync,
	workspaceId: string,
): WorkspaceRenameTarget | null {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId });
	if (!row || typeof row !== 'object') {
		return null;
	}
	const record = row as Record<string, unknown>;
	const metadataJson =
		typeof record.metadataJson === 'string' ? record.metadataJson : '';
	const branchName =
		typeof record.branchName === 'string' ? record.branchName : null;
	return { branchName, metadataJson };
}

/**
 * Persists a generated title, re-checking the gate at write time so a title
 * that landed (or a user edit that arrived) between the pre-flight check and
 * now is never overwritten. Stamps auto-provenance and broadcasts the rename.
 */
function persistTitle({
	input,
	title,
}: {
	input: SessionNamingInput;
	title: string;
}): void {
	if (!titleNeedsNaming(input.database, input.chatTabId)) {
		return;
	}
	const tab = getChatTabById({ database: input.database, id: input.chatTabId });
	if (!tab) {
		return;
	}
	renameChatTab({ database: input.database, id: input.chatTabId, title });
	setChatTabMetadata({
		database: input.database,
		id: input.chatTabId,
		metadata: {
			...tab.metadata,
			titleAutoNamed: true,
			titleProvenance: 'auto',
		},
	});
	const event = appendChatTitleMetadataEvent({
		branchId: input.branchId,
		database: input.database,
		title,
	});
	input.eventSink?.({
		event,
		sessionId: input.sessionId,
		workspaceId: input.workspaceId,
	});
}

/**
 * Renames the workspace + git branch to the generated slug. The rename service
 * re-checks the placeholder gate inside its own critical section
 * (`requirePlaceholderName`), so a user rename that races this write is honored
 * and this no-ops instead of clobbering it.
 */
async function persistBranch({
	input,
	renameWorkspace,
	slug,
	target,
}: {
	input: SessionNamingInput;
	renameWorkspace: RenameWorkspaceService['rename'];
	slug: string;
	target: WorkspaceRenameTarget;
}): Promise<void> {
	const result = await renameWorkspace({
		branchName: composeRenamedBranch(target.branchName ?? '', slug),
		name: slug,
		requirePlaceholderName: true,
		workspaceId: input.workspaceId,
	});
	// A blocked/no-op rename returns the unchanged workspace; only broadcast when
	// the new name actually took, so a raced-out attempt does not trigger a
	// needless renderer refetch.
	if (result.status !== 'success' || result.workspace?.name !== slug) {
		return;
	}
	const event = appendWorkspaceRenamedMetadataEvent({
		branchId: input.branchId,
		database: input.database,
	});
	input.eventSink?.({
		event,
		sessionId: input.sessionId,
		workspaceId: input.workspaceId,
	});
}

/**
 * Runs the throwaway naming session for a git branch slug and returns it. Waits
 * for the turn to settle (`status: 'idle'`); on timeout it discards whatever was
 * streamed and returns null so the caller keeps the placeholder and retries — a
 * partial chunk is never accepted as a branch name.
 */
async function generateBranchSlug({
	executable,
	model,
	piAgentClient,
	prompt,
	timeoutMs,
	workspaceCwd,
}: {
	executable: PiExecutableSnapshot;
	model: string | null;
	piAgentClient: PiAgentClient;
	prompt: string;
	timeoutMs: number;
	workspaceCwd: string;
}): Promise<string | null> {
	const session = await piAgentClient.createSession({
		executable,
		label: 'ensemblr-session-naming',
		modelOverride: model,
		workspaceCwd,
	});
	const chunks: string[] = [];
	let resolveDone: () => void = () => undefined;
	const done = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const subscription = session.subscribe((event) => {
		if (event.type === 'message' && event.role === 'agent') {
			const text = extractAgentMessageText(event);
			if (text) {
				chunks.push(text);
			}
			return;
		}
		if (
			(event.type === 'status' && event.status === 'idle') ||
			event.type === 'shutdown'
		) {
			resolveDone();
		}
	});

	try {
		await session.submit({ prompt: buildBranchNamingPrompt(prompt) });
		const settled = await raceTimeout(done, timeoutMs);
		if (!settled) {
			return null;
		}
		return parseBranchSlug(chunks.join(' '));
	} finally {
		subscription.unsubscribe();
		await session.close().catch(() => undefined);
	}
}

/** Builds the branch-naming instruction for the throwaway session. */
function buildBranchNamingPrompt(prompt: string): string {
	return [
		'Name the work described in the user request below.',
		'',
		'Output rules:',
		'- Emit a line `BRANCH: <name>` — a kebab-case git branch name, 2 to 5 words, 40 characters max.',
		'- Output only the requested labelled line. No quotes, markdown, code fences, reasoning, or explanation.',
		'',
		'USER REQUEST:',
		prompt,
	].join('\n');
}

/** Resolves true when `done` settles first, or false after `timeoutMs`. */
async function raceTimeout(
	done: Promise<void>,
	timeoutMs: number,
): Promise<boolean> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), timeoutMs);
	});
	try {
		return await Promise.race([done.then(() => true), timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

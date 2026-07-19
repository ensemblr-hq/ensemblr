import type { AppSettingsService } from '../config';
import type { PiExecutableSnapshot } from '../pi-runtime';
import type { RenameWorkspaceService } from '../repository';
import { parseMetadata } from '../repository/metadata.ts';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';
import { extractAgentMessageText } from './agent-message-text.ts';
import {
	composeRenamedBranch,
	sanitizeBranchSlug,
	shouldAutoRenameWorkspace,
} from './branch-name-slug.ts';
import type { PiAgentClient } from './pi-agent-client.ts';
import { appendWorkspaceRenamedMetadataEvent } from './pi-session-persistence.ts';
import type { QueueChatTitleInput } from './session/session-open.ts';

export const BRANCH_NAME_TIMEOUT_MS = 20000;

/** Dependencies for {@link createBranchNameQueue}. */
interface BranchNameQueueDeps {
	appSettingsService: AppSettingsService;
	renameWorkspace: RenameWorkspaceService['rename'];
}

/** Minimal projection of the workspace row needed for the rename decision. */
interface WorkspaceRenameTarget {
	branchName: string | null;
	metadataJson: string;
}

/**
 * Builds the post-first-turn auto branch-naming step. Mirrors the chat-title
 * service: on the first prompt of a fresh session it runs a throwaway pi session
 * (label `ensemblr-branch-name`) to suggest a kebab-case branch name, then
 * renames the workspace + its git branch via {@link RenameWorkspaceService} —
 * but only when `renameWorkspaceOnBranch` is enabled and the workspace still
 * carries its auto-generated composer placeholder name. Entirely best-effort:
 * failures are logged and never surface to the user or block the chat.
 * @param deps - The settings reader and the workspace-rename entry point.
 * @returns A queue function slotted in beside the chat-title queue.
 */
export function createBranchNameQueue({
	appSettingsService,
	renameWorkspace,
}: BranchNameQueueDeps): (input: QueueChatTitleInput) => void {
	return (input) => {
		void runBranchNaming({ appSettingsService, input, renameWorkspace }).catch(
			(cause: unknown) => {
				console.warn('[pi-session] branch name generation failed', {
					cause: cause instanceof Error ? cause.message : String(cause),
					workspaceId: input.workspaceId,
				});
			},
		);
	};
}

/** Runs the gated branch-naming + rename flow for one fresh session. */
async function runBranchNaming({
	appSettingsService,
	input,
	renameWorkspace,
}: {
	appSettingsService: AppSettingsService;
	input: QueueChatTitleInput;
	renameWorkspace: RenameWorkspaceService['rename'];
}): Promise<void> {
	const prompt = (input.initialPrompt ?? '').trim();
	const target = readRenameTarget(input);
	if (!target) {
		return;
	}
	const metadata = parseMetadata(target.metadataJson);
	// Single gate: non-empty prompt + setting on + an un-renamed placeholder.
	// Never overrides a name the user (or a prior auto-rename) already set.
	if (
		!shouldAutoRenameWorkspace({
			metadata,
			prompt,
			renameEnabled: appSettingsService.read().git.renameWorkspaceOnBranch,
		})
	) {
		return;
	}

	// The gate guarantees a non-empty prompt here.
	const slug = await generateBranchSlug({
		executable: input.executable,
		model: input.model,
		piAgentClient: input.piAgentClient,
		prompt,
		timeoutMs: BRANCH_NAME_TIMEOUT_MS,
		workspaceCwd: input.workspaceCwd,
	});
	if (!slug) {
		return;
	}

	const result = await renameWorkspace({
		branchName: composeRenamedBranch(target.branchName ?? '', slug),
		name: slug,
		workspaceId: input.workspaceId,
	});
	if (result.status !== 'success') {
		return;
	}

	// Push a metadata event so the renderer refetches the workspace list
	// immediately instead of waiting for the next natural refetch.
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

/** Reads the current branch + metadata for the workspace, or null when absent. */
function readRenameTarget(
	input: QueueChatTitleInput,
): WorkspaceRenameTarget | null {
	const row = selectWorkspaceWithRepositoryById({
		database: input.database,
		workspaceId: input.workspaceId,
	});
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

/** Asks pi for a kebab-case branch name based on the user's first message. */
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
		label: 'ensemblr-branch-name',
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
		if (event.type === 'status' && event.status === 'idle') {
			resolveDone();
			return;
		}
		if (event.type === 'shutdown') {
			resolveDone();
		}
	});

	try {
		await session.submit({ prompt: buildBranchNamePrompt(prompt) });
		await waitForBranchName(done, timeoutMs);
		return sanitizeBranchSlug(chunks.join(' '));
	} finally {
		subscription.unsubscribe();
		await session.close().catch(() => undefined);
	}
}

/** Builds the LLM instruction for a terse kebab-case branch name. */
function buildBranchNamePrompt(prompt: string): string {
	return [
		'Suggest a short, descriptive git branch name for the request below.',
		'',
		'Output rules:',
		'- kebab-case (lowercase words joined by single hyphens).',
		'- 2 to 5 words, no more than 40 characters.',
		'- No prefixes, slashes, quotes, markdown, or explanation.',
		'- Reply with the branch name only on a single line.',
		'',
		'REQUEST:',
		prompt,
	].join('\n');
}

/** Resolves once the session goes idle, or after the timeout, whichever is first. */
async function waitForBranchName(
	done: Promise<void>,
	timeoutMs: number,
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, timeoutMs);
	});
	try {
		await Promise.race([done, timeout]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

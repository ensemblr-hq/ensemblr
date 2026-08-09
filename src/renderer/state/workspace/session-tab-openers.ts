import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { PullRequestCommentSummary } from '@/renderer/types/workbench';
import type { SessionTabPlacement } from '@/renderer/types/workbench-shell';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

import {
	buildCommentTabTitle,
	toCommentPreviewMetadata,
} from './comment-preview-tab';
import { basenameOf, diffTabTitle } from './session-tab-titles';

/** The id a newly opened tab reports back, or null when the open failed. */
interface OpenedTabResult {
	chatTabId: string;
}

/** Opens a non-chat tab; resolves without a `tab` when the row was not written. */
type OpenAuxiliaryTab = (input: {
	kind: 'diff' | 'document' | 'file' | 'terminal';
	metadata: Record<string, unknown>;
	preview?: boolean;
	title: string;
}) => Promise<{ tab?: { id: string } | null }>;

/** Opens a chat tab, optionally placing it after a named tab. */
type OpenChatTab = (input?: {
	insertAfterChatTabId: string | null;
}) => Promise<{ tab: { id: string } }>;

/**
 * Every way a workspace opens a tab, over the two persistence mutations behind
 * them. Auxiliary tabs (file, diff, document, terminal) share one open path, so
 * each opener differs only in the kind, metadata, and title it stamps.
 *
 * A failed open is already surfaced as a toast by the mutation, so every opener
 * resolves to null rather than throwing and callers treat it as a no-op.
 * @param insertAnchorTabId - Tab a spawned chat lands after, or null to append
 * @param openAuxiliaryTab - Persists a non-chat tab row
 * @param openChatTab - Persists a chat tab row
 * @param workspaceId - Workspace a launched harness belongs to
 * @returns The opener callbacks the session-tab contract exposes
 */
export function useSessionTabOpeners({
	insertAnchorTabId,
	openAuxiliaryTab,
	openChatTab,
	workspaceId,
}: {
	insertAnchorTabId: string | null;
	openAuxiliaryTab: OpenAuxiliaryTab;
	openChatTab: OpenChatTab;
	workspaceId: string;
}) {
	const { t } = useTranslation();
	const openAuxiliary = useCallback(
		async (
			input: Parameters<OpenAuxiliaryTab>[0],
		): Promise<OpenedTabResult | null> => {
			try {
				const result = await openAuxiliaryTab(input);
				return result.tab ? { chatTabId: result.tab.id } : null;
			} catch {
				return null;
			}
		},
		[openAuxiliaryTab],
	);

	/**
	 * Opens a chat tab. Spawned chats (review actions, setup-script prompts, the
	 * ⌘W reset) land right of the active tab; only the strip's new-tab button asks
	 * for `append`.
	 */
	const openSessionTab = useCallback(
		async ({
			placement = 'after-active',
		}: {
			placement?: SessionTabPlacement;
		} = {}): Promise<OpenedTabResult | null> => {
			try {
				const result = await openChatTab(
					placement === 'append'
						? undefined
						: { insertAfterChatTabId: insertAnchorTabId },
				);
				return { chatTabId: result.tab.id };
			} catch {
				// Surfaced as a toast by the mutation; callers treat as no-op.
				return null;
			}
		},
		[insertAnchorTabId, openChatTab],
	);

	/**
	 * Launches an agent harness in a new terminal session and opens a terminal
	 * tab bound to it. The launch command is assembled in the main process from
	 * the trusted harness registry; this only forwards the selected id. Each
	 * launch starts a fresh conversation, so opening the same harness more than
	 * once yields independent instances rather than reusing one tab. (Only the
	 * post-restart resume path is cwd-scoped.)
	 */
	const openTerminalTab = useCallback(
		async ({
			harnessId,
			harnessLabel,
		}: {
			harnessId: string;
			harnessLabel: string;
		}): Promise<OpenedTabResult | null> => {
			const launch = await window.ensemblr?.launchAgentHarness({
				harnessId,
				workspaceId,
			});
			const session = launch?.session ?? null;
			if (!session) {
				const message = launch?.diagnostics.find(
					(diagnostic) => diagnostic.severity === 'error',
				)?.message;
				toast.error(
					t('errors:agent-launch.failed.title', 'Could not launch agent'),
					{
						description:
							message ??
							t(
								'errors:agent-launch.failed.description',
								'{{harness}} is not available.',
								{ harness: harnessLabel },
							),
					},
				);
				return null;
			}
			const opened = await openAuxiliary({
				kind: 'terminal',
				metadata: { harnessId, harnessLabel, terminalId: session.id },
				title: harnessLabel,
			});
			if (!opened) {
				// The tab row failed to persist; kill the orphaned PTY so it does not
				// linger without a surface. Surfaced as a toast by the mutation.
				void window.ensemblr?.killTerminalSession({ terminalId: session.id });
			}
			return opened;
		},
		[openAuxiliary, t, workspaceId],
	);

	return {
		/**
		 * Opens (or re-focuses) a read-only preview tab for a PR comment. The comment
		 * rides in `metadata` as a `document` tab so the body survives reloads without
		 * a re-fetch (and avoids widening the `chat_tabs.kind` CHECK constraint).
		 */
		openCommentPreviewTab: useCallback(
			({
				comment,
				preview = true,
				prNumber,
			}: {
				comment: PullRequestCommentSummary;
				preview?: boolean;
				prNumber?: number;
			}) =>
				openAuxiliary({
					kind: 'document',
					metadata: {
						commentPreview: toCommentPreviewMetadata(comment, prNumber),
					},
					preview,
					title: buildCommentTabTitle(comment),
				}),
			[openAuxiliary],
		),
		/**
		 * Opens (or re-focuses) a file-preview tab for a workspace-relative path.
		 * Ephemeral by default, so browsing files reuses one preview slot; pass
		 * `preview: false` for a gesture that means "keep this open".
		 */
		openFilePreviewTab: useCallback(
			({ filePath, preview = true }: { filePath: string; preview?: boolean }) =>
				openAuxiliary({
					kind: 'file',
					metadata: { filePath },
					preview,
					title: basenameOf(filePath),
				}),
			[openAuxiliary],
		),
		openSessionTab,
		openTerminalTab,
		/** Opens (or re-focuses) a turn-diff tab for a checkpointed turn. */
		openTurnDiffTab: useCallback(
			({
				label,
				preview = true,
				turnId,
			}: {
				label: string;
				preview?: boolean;
				turnId: string;
			}) =>
				openAuxiliary({
					kind: 'diff',
					metadata: { turnId },
					preview,
					title: label,
				}),
			[openAuxiliary],
		),
		/**
		 * Opens (or re-focuses) a diff tab for a changed file at the given scope. The
		 * scope is persisted in metadata so the same file viewed at the working tree,
		 * in a commit, and across the branch each get their own tab.
		 */
		openWorkspaceFileDiffTab: useCallback(
			({
				filePath,
				preview = true,
				scope,
			}: {
				filePath: string;
				preview?: boolean;
				scope?: WorkspaceGitDiffScope;
			}) =>
				openAuxiliary({
					kind: 'diff',
					metadata: { filePath, ...(scope ? { diffScope: scope } : {}) },
					preview,
					title: diffTabTitle(filePath, scope),
				}),
			[openAuxiliary],
		),
	};
}

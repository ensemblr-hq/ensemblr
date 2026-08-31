import { useQuery } from '@tanstack/react-query';
import { useAtomValue, useStore } from 'jotai';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { settingsResolutionQuery } from '@/renderer/api/ensemblr';
import { writeWorkspaceActionPrompt } from '@/renderer/api/ensemblr-queries';
import {
	resolveActionPreference,
	sharedActionPreference,
} from '@/renderer/lib/workbench/action-preference';
import {
	ACTION_KEY_BY_KIND,
	ACTION_TRIGGER_MESSAGE,
	composeActionPrompt,
	resolvePullRequestAction,
} from '@/renderer/lib/workbench/action-prompts';
import { resolvePrDetails } from '@/renderer/lib/workbench/pr-details-draft';
import {
	type PrimedAction,
	primedActionAtomFamily,
} from '@/renderer/state/composer';
import {
	chatModelOverrideAtomFamily,
	chatThinkingOverrideAtomFamily,
	prDetailsDraftAtomFamily,
	prDetailsLiveDraftAtomFamily,
	repoSettingsOverrideAtomFamily,
	reviewModelAtom,
	reviewThinkingLevelAtom,
} from '@/renderer/state/preferences';
import type {
	AgentActionKind,
	ProjectShellModel,
	SessionTabModel,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { useChatTabTarget } from './use-chat-tab-target';

/** Jotai store slice used to prime a tab and set its overrides imperatively. */
type ActionStore = ReturnType<typeof useStore>;

/**
 * Primes a freshly-opened Review tab: pins it to the configured review model and
 * thinking level (so the whole review chat runs on them), then queues the
 * composed prompt for its composer to send.
 */
function primeReviewTab({
	chatTabId,
	primed,
	reviewModel,
	reviewThinkingLevel,
	store,
}: {
	chatTabId: string;
	primed: PrimedAction;
	reviewModel: string | null | undefined;
	reviewThinkingLevel: string | null | undefined;
	store: ActionStore;
}): void {
	if (reviewModel) {
		store.set(chatModelOverrideAtomFamily(chatTabId), reviewModel);
	}
	if (reviewThinkingLevel) {
		store.set(chatThinkingOverrideAtomFamily(chatTabId), reviewThinkingLevel);
	}
	store.set(primedActionAtomFamily(chatTabId), primed);
}

/**
 * Builds the agent-action runner: composes the action's prompt (built-in base
 * prompt + workspace context + the user's per-action preferences), persists it
 * to `.context/attachments/`, and primes a chat tab to send a short trigger
 * message with that prompt inlined. Review opens a fresh tab on the configured
 * review model; every other action goes to the chat {@link useChatTabTarget}
 * resolves, and says so rather than opening one when there is none — a
 * workspace always keeps a chat tab open, so an empty strip means the tab rows
 * have not arrived yet and opening on that reading spawns a spurious "New chat".
 *
 * Every surface fires `create-pr` for its pull-request button, so the runner
 * resolves that against the workspace's live PR: an open one turns it into
 * `update-pr`, which is what keeps the "Update PR" button from asking for a
 * second pull request.
 */
export function useAgentActionRunner({
	activeProject,
	activeSession,
	activeWorkspace,
	openSessionTab,
	selectChat,
	sessionTabs,
}: {
	activeProject: ProjectShellModel;
	activeSession: SessionTabModel;
	activeWorkspace: WorkspaceShellModel;
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	selectChat: (chatTabId: string) => void;
	sessionTabs: readonly SessionTabModel[];
}): (action: AgentActionKind) => void {
	const store = useStore();
	const { t } = useTranslation();
	const overrides = useAtomValue(
		repoSettingsOverrideAtomFamily(activeProject.id),
	);
	const { data: resolution } = useQuery(
		settingsResolutionQuery({
			repositoryId: activeProject.id,
			repositoryPath: activeProject.pathLabel,
		}),
	);
	const liveDraft = useAtomValue(
		prDetailsLiveDraftAtomFamily(activeWorkspace.id),
	);
	const savedDraft = useAtomValue(prDetailsDraftAtomFamily(activeWorkspace.id));
	const deliverToChat = useChatTabTarget({
		activeSession,
		selectChat,
		sessionTabs,
		workspaceId: activeWorkspace.id,
	});
	const reviewModel = useAtomValue(reviewModelAtom);
	const reviewThinkingLevel = useAtomValue(reviewThinkingLevelAtom);

	return useCallback(
		(requestedAction: AgentActionKind) => {
			void (async () => {
				const action =
					requestedAction === 'create-pr'
						? resolvePullRequestAction(activeWorkspace)
						: requestedAction;
				const prDetails = resolvePrDetails({
					live: liveDraft,
					saved: savedDraft,
					workspace: activeWorkspace,
				});
				const actionKey = ACTION_KEY_BY_KIND[action];
				const content = composeActionPrompt({
					action,
					preferences: resolveActionPreference(
						overrides.actionPreferences?.[actionKey] ?? '',
						sharedActionPreference(resolution, actionKey),
					),
					prDescription: prDetails.description,
					prTitle: prDetails.title,
					workspace: activeWorkspace,
				});
				const writeResult = await writeWorkspaceActionPrompt({
					action,
					content,
					workspaceCwd: activeWorkspace.pathLabel,
				});
				if (writeResult.error || !writeResult.file) {
					toast.error(
						t(
							'errors:agent-action.prompt-failed.title',
							'Could not prepare the action prompt.',
						),
						{ description: writeResult.error?.message },
					);
					return;
				}
				const primed: PrimedAction = {
					attachmentContent: content,
					attachmentPath: writeResult.file.path,
					autoSubmit: true,
					message: ACTION_TRIGGER_MESSAGE[action] ?? '',
				};

				if (action === 'review') {
					const opened = await openSessionTab();
					if (opened) {
						primeReviewTab({
							chatTabId: opened.chatTabId,
							primed,
							reviewModel,
							reviewThinkingLevel,
							store,
						});
						selectChat(opened.chatTabId);
					}
					return;
				}

				const delivered = deliverToChat((chatTabId) => {
					store.set(primedActionAtomFamily(chatTabId), primed);
				});
				if (!delivered) {
					toast.error(
						t(
							'errors:composer.chat-tab-not-ready.title',
							'This workspace has no chat ready yet. Try again in a moment.',
						),
					);
				}
			})();
		},
		[
			activeWorkspace,
			deliverToChat,
			liveDraft,
			openSessionTab,
			overrides.actionPreferences,
			resolution,
			reviewModel,
			reviewThinkingLevel,
			savedDraft,
			selectChat,
			store,
			t,
		],
	);
}

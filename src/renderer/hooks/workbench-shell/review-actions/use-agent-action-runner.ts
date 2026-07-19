import { useQuery } from '@tanstack/react-query';
import { useAtomValue, useStore } from 'jotai';
import { useCallback } from 'react';
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

/** Jotai store slice used to prime a tab and set its overrides imperatively. */
type ActionStore = ReturnType<typeof useStore>;

/** True for chat tabs (placeholder sessions predate `kind` and count as chat). */
function isChatTab(tab: SessionTabModel): boolean {
	return tab.kind === undefined || tab.kind === 'chat';
}

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
 * Resolves the chat tab an action should target: the active tab when it is a
 * chat, otherwise the last-active chat tab (so an action fired while viewing a
 * file or diff routes to the most recent chat). Returns null when no chat tab is
 * open, letting the caller open a fresh one.
 */
function resolveTargetChatTabId({
	activeSession,
	sessionTabs,
}: {
	activeSession: SessionTabModel;
	sessionTabs: readonly SessionTabModel[];
}): string | null {
	if (isChatTab(activeSession)) {
		return activeSession.chatTabId;
	}
	const chatTabs = sessionTabs.filter(isChatTab);
	return chatTabs.at(-1)?.chatTabId ?? null;
}

/**
 * Builds the agent-action runner: composes the action's prompt (built-in base
 * prompt + workspace context + the user's per-action preferences), persists it
 * to `.context/attachments/`, and primes a chat tab to send a short trigger
 * message with that prompt inlined. Review opens a fresh tab on the configured
 * review model; the other actions target the active (or last-active) chat tab.
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
	const reviewModel = useAtomValue(reviewModelAtom);
	const reviewThinkingLevel = useAtomValue(reviewThinkingLevelAtom);

	return useCallback(
		(action: AgentActionKind) => {
			void (async () => {
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
					toast.error('Could not prepare the action prompt.', {
						description: writeResult.error?.message,
					});
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

				const targetChatTabId =
					resolveTargetChatTabId({ activeSession, sessionTabs }) ??
					(await openSessionTab())?.chatTabId ??
					null;
				if (!targetChatTabId) {
					return;
				}
				store.set(primedActionAtomFamily(targetChatTabId), primed);
				if (targetChatTabId !== activeSession.chatTabId) {
					selectChat(targetChatTabId);
				}
			})();
		},
		[
			activeSession,
			activeWorkspace,
			liveDraft,
			openSessionTab,
			overrides.actionPreferences,
			resolution,
			reviewModel,
			reviewThinkingLevel,
			savedDraft,
			selectChat,
			sessionTabs,
			store,
		],
	);
}

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useComposerInsert } from '@/renderer/state/composer';

/**
 * Composer seed for the setup-tab "Ask agent" affordance: directs the agent to
 * author the repository's `.ensemblr/settings.toml` scripts after inspecting the
 * project's tooling. Seeded for review, never auto-submitted.
 *
 * The schema itself is deliberately absent: the `ensemblr` skill ships the full
 * `settings.toml` reference to the sessions Ensemblr launches, so restating it
 * here would be a second copy to keep in sync with the loader.
 */
const ASK_AGENT_SETUP_PROMPT = `Set up this repository's Ensemblr config so a fresh workspace can install its dependencies and start its common tasks.

Read the \`ensemblr\` skill's \`.ensemblr/settings.toml\` reference for the schema — the \`[scripts]\` setup command, the \`[scripts.run.<name>]\` tables and their icon list, and the \`ENSEMBLR_*\` variables every script is handed.

Then inspect this project — package manager, language toolchain, lockfiles, existing scripts — and create or update \`.ensemblr/settings.toml\` with the setup command plus one run script per task worth a one-click button: the dev server, the test suite, lint/typecheck, a build.

Use the commands that actually apply to this repo, then tell me what you chose and why.`;

/**
 * Builds the setup-tab "Ask agent" handler: opens a brand-new chat (fresh agent
 * context) and seeds its composer with {@link ASK_AGENT_SETUP_PROMPT}.
 *
 * The seed is deferred until the new chat is the active session — only the
 * active chat mounts a composer, so enqueueing before the navigation lands would
 * drain the prompt into the previous chat. A ref carries the pending chat id
 * across the navigation; the effect fires the insert once that chat is active.
 * @param options - New-chat opener, chat selector, and the active chat id.
 * @returns A stable callback for {@link WorkbenchDockActions.onAskAgentSetupScript}.
 */
export function useAskAgentSetupScript({
	activeChatTabId,
	openSessionTab,
	selectChat,
}: {
	activeChatTabId: string;
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	selectChat: (chatTabId: string) => void;
}): () => void {
	const insertIntoComposer = useComposerInsert();
	const { t } = useTranslation();
	const pendingChatIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (pendingChatIdRef.current !== activeChatTabId) {
			return;
		}
		pendingChatIdRef.current = null;
		insertIntoComposer(ASK_AGENT_SETUP_PROMPT);
		toast.success(
			t('errors:setup-script.chat-ready.title', 'New chat ready for setup.'),
			{
				description: t(
					'errors:setup-script.chat-ready.description',
					'Send the prompt to have the agent create .ensemblr/settings.toml — edit it first if needed.',
				),
			},
		);
	}, [activeChatTabId, insertIntoComposer, t]);

	return useCallback(() => {
		void openSessionTab()
			.then((opened) => {
				if (!opened) {
					throw new Error('New chat did not open.');
				}
				pendingChatIdRef.current = opened.chatTabId;
				selectChat(opened.chatTabId);
			})
			.catch(() => {
				// A null result or rejection means the new chat never opened, so nothing
				// is pending to seed — surface it and stop.
				toast.error(
					t(
						'errors:setup-script.chat-failed.title',
						'Could not open a new chat.',
					),
					{
						description: t(
							'errors:setup-script.chat-failed.description',
							'Try the "Ask agent" action again from the setup tab.',
						),
					},
				);
			});
	}, [openSessionTab, selectChat, t]);
}

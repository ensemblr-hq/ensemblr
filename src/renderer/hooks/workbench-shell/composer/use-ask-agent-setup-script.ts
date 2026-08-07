import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { useComposerInsert } from '@/renderer/state/composer';

/**
 * Composer seed for the setup-tab "Ask agent" affordance: directs the agent to
 * author the repository's `.ensemblr/settings.toml` scripts after inspecting the
 * project's tooling. Seeded for review, never auto-submitted.
 */
const ASK_AGENT_SETUP_PROMPT = `Set up this repository's Ensemblr config so a fresh workspace can install its dependencies and start its common tasks.

Inspect the project first (package manager, language toolchain, lockfiles, existing scripts), then create or update \`.ensemblr/settings.toml\`:

- \`[scripts]\` \`setup\`: the command that installs dependencies / prepares a new workspace.
- One \`[scripts.run.<name>]\` table per task worth a one-click button — the dev server, the test suite, lint/typecheck, a build. Each takes a \`command\`, and optionally an \`icon\`, \`default = true\` (the ⌘R target, at most one), and \`available_in = ["local"]\`.

Every workspace gets its own \`$ENSEMBLR_PORT\`, so pass it to anything that binds a port instead of hardcoding one.

Example:

    [scripts]
    setup = "<install command>"

    [scripts.run.dev]
    command = "<dev command using $ENSEMBLR_PORT>"
    icon = "play"
    default = true

    [scripts.run.test]
    command = "<test command>"
    icon = "test-tube"

Pick icon names from Ensemblr's set (play, server, terminal, test-tube, flask-conical, list-checks, hammer, rocket, bug, database, globe, zap, ...); an unknown name falls back to the default icon.

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
	const pendingChatIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (pendingChatIdRef.current !== activeChatTabId) {
			return;
		}
		pendingChatIdRef.current = null;
		insertIntoComposer(ASK_AGENT_SETUP_PROMPT);
		toast.success('New chat ready for setup.', {
			description:
				'Send the prompt to have the agent create .ensemblr/settings.toml — edit it first if needed.',
		});
	}, [activeChatTabId, insertIntoComposer]);

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
				toast.error('Could not open a new chat.', {
					description: 'Try the "Ask agent" action again from the setup tab.',
				});
			});
	}, [openSessionTab, selectChat]);
}

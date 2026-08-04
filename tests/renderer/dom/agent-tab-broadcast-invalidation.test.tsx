// @vitest-environment happy-dom

/**
 * A tab an agent spawned gains its Pi session after the tab row already exists,
 * and the timeline resolves that session out of the workspace session list — not
 * off the tab. So the tabs-changed broadcast has to invalidate the session list
 * too, or a spawned tab holds an empty branch id and renders blank while its
 * child works.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr-queries';
import { useSessionTabState } from '../../../src/renderer/state/workspace';
import type {
	SessionTabModel,
	WorkspaceShellModel,
} from '../../../src/renderer/types/workbench';
import { createTestQueryClient, installEnsemblrApi } from '../support/dom';

const WORKSPACE_ID = 'ws-1';

const activeSession: SessionTabModel = {
	chatTabId: 'tab-1',
	id: 'tab-1',
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Chat',
	piSessionId: null,
	status: 'idle',
	summary: '',
	updatedLabel: 'Chat',
};

const activeWorkspace = {
	id: WORKSPACE_ID,
	sessions: [activeSession],
} as unknown as WorkspaceShellModel;

describe('agent tab broadcast invalidation', () => {
	test('invalidates the session list so a spawned tab can resolve its branch', () => {
		const listeners: ((broadcast: { workspaceId: string }) => void)[] = [];
		installEnsemblrApi({
			onAgentControlTabsChanged: (
				listener: (broadcast: { workspaceId: string }) => void,
			) => {
				listeners.push(listener);
				return () => undefined;
			},
			onPiSessionEvent: vi.fn(() => () => undefined),
			onTerminalLifecycle: vi.fn(() => () => undefined),
		});
		const client = createTestQueryClient();
		const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);

		renderHook(
			() =>
				useSessionTabState({
					activeSession,
					activeWorkspace,
					onSessionTabChange: () => undefined,
				}),
			{ wrapper },
		);
		invalidateQueries.mockClear();
		for (const listener of listeners) {
			listener({ workspaceId: WORKSPACE_ID });
		}

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ensemblrQueryKeys.piSessionsForWorkspace(WORKSPACE_ID),
		});
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ensemblrQueryKeys.chatTabs(WORKSPACE_ID),
		});
	});
});

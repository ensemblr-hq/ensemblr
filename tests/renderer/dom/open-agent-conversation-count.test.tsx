// @vitest-environment happy-dom

/**
 * The review panel's Agents badge was counted from the full row model, which
 * `useAgentsPanelState` rebuilt in the workspace shell on every agent event. The
 * badge only needs how many conversations are open, so it reads that from the
 * chat-tab list and re-renders when the number moves, not when a tab is renamed.
 */

import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';

import { ensemblrQueryKeys } from '../../../src/renderer/api/ensemblr/query-keys';
import { useOpenAgentConversationCount } from '../../../src/renderer/state/agents';
import type { ChatTabWire } from '../../../src/shared/ipc/contracts/chat-tab';
import {
	clearEnsemblrApi,
	createTestQueryClient,
	renderWithProviders,
} from '../support/dom';

let renders = 0;

/** Produces one open chat tab that has started its own session. */
function openChat(id: string, title = id): ChatTabWire {
	return {
		agentSessionId: `session-${id}`,
		closedAt: null,
		fullTitle: title,
		id,
		isPreview: false,
		kind: 'chat',
		metadata: {},
		openedAt: '2026-01-01T00:00:00.000Z',
		position: 0,
		title,
		workspaceId: 'workspace-1',
	};
}

/** Renders the count the way the tab header does, tallying every render. */
function Badge() {
	renders += 1;
	return (
		<span data-testid='badge'>
			{useOpenAgentConversationCount('workspace-1')}
		</span>
	);
}

/** Mounts the badge over a seeded chat-tab list. */
function renderBadge(open: readonly ChatTabWire[]) {
	const client = createTestQueryClient();
	client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
		closed: [],
		open,
	});
	renders = 0;
	renderWithProviders(<Badge />, { client });
	return client;
}

afterEach(() => {
	clearEnsemblrApi();
});

describe('useOpenAgentConversationCount', () => {
	test('reads the open conversation count from the chat tabs', () => {
		renderBadge([openChat('a'), openChat('b')]);

		expect(screen.getByTestId('badge')).toHaveTextContent('2');
	});

	test('is zero before the chat tabs load', () => {
		const client = createTestQueryClient();
		renders = 0;
		renderWithProviders(<Badge />, { client });

		expect(screen.getByTestId('badge')).toHaveTextContent('0');
	});

	test('does not render again when a tab changes but the count does not', async () => {
		const client = renderBadge([openChat('a'), openChat('b')]);
		const rendersAfterMount = renders;

		act(() => {
			client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
				closed: [],
				open: [openChat('a', 'Renamed'), openChat('b')],
			});
		});
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(renders).toBe(rendersAfterMount);
	});

	test('renders again when the count moves', async () => {
		const client = renderBadge([openChat('a')]);

		act(() => {
			client.setQueryData(ensemblrQueryKeys.chatTabs('workspace-1'), {
				closed: [],
				open: [openChat('a'), openChat('b')],
			});
		});

		await waitFor(() => {
			expect(screen.getByTestId('badge')).toHaveTextContent('2');
		});
	});
});

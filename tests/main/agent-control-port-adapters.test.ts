import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createAgentControlPorts,
	type PortAdapterDeps,
} from '../../src/main/agent-control/index.ts';

vi.mock('../../src/main/storage/repositories/chat-tab-repository.ts', () => ({
	getChatTabById: vi.fn(() => ({ workspaceId: 'ws' })),
	setChatTabMetadata: vi.fn(),
}));

/**
 * Builds port-adapter deps with the collaborators the tab port touches; the
 * remaining ports are constructed but never exercised here, so their deps stay
 * as light stand-ins.
 */
const makeDeps = (): {
	deps: PortAdapterDeps;
	broadcastTabsChanged: ReturnType<typeof vi.fn>;
	openTab: ReturnType<typeof vi.fn>;
} => {
	const broadcastTabsChanged = vi.fn();
	const openTab = vi.fn((input: { metadata?: unknown }) => ({
		id: 'tab-1',
		metadata: input.metadata ?? {},
	}));
	const deps = {
		databaseService: { getConnection: () => ({ database: {} }) },
		chatTabService: { openTab, closeTab: vi.fn(), listTabs: vi.fn() },
		piSessionService: {},
		terminalService: {},
		scriptLifecycleService: {},
		harnessDetectionService: {},
		piExecutableService: {},
		getPermissionMode: () => 'workspace-trusted',
		broadcastFocus: vi.fn(),
		broadcastTabsChanged,
		confirm: { confirm: vi.fn() },
	} as unknown as PortAdapterDeps;
	return { deps, broadcastTabsChanged, openTab };
};

describe('agent-control port adapters: tab-change broadcast', () => {
	let deps: PortAdapterDeps;
	let broadcastTabsChanged: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		const built = makeDeps();
		deps = built.deps;
		broadcastTabsChanged = built.broadcastTabsChanged;
	});

	it('broadcasts the workspace after spawning a chat tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.spawnChatTab({ workspaceId: 'ws', title: 'New' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('broadcasts the workspace after opening a non-chat tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.openNonChatTab({
			workspaceId: 'ws',
			variant: 'file',
			filePath: 'src/a.ts',
		});
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});

	it('broadcasts the owning workspace after closing a tab', async () => {
		const ports = createAgentControlPorts(deps);
		await ports.tabs.closeTab({ chatTabId: 'tab-1' });
		expect(broadcastTabsChanged).toHaveBeenCalledWith({ workspaceId: 'ws' });
	});
});

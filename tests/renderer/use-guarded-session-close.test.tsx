// @vitest-environment happy-dom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { SessionTabModel } from '../../src/renderer/types/workbench';

const { menuHandlers, stopAgentSessionById } = vi.hoisted(() => ({
	menuHandlers: new Map<string, () => void>(),
	stopAgentSessionById: vi.fn(async () => undefined),
}));

vi.mock('@/renderer/state/composer', () => ({
	useStopAgentSession: () => stopAgentSessionById,
}));

vi.mock('@/renderer/state/menu-commands', () => ({
	useMenuCommand: (commandId: string, handler: () => void) => {
		menuHandlers.set(commandId, handler);
	},
}));

// The resolver and the guard stay real: this file exists to prove the hook
// honours `isRefused`, which a mocked resolver would decide for it.
vi.mock('@/renderer/state/workspace', async () => {
	const [closeTarget, guard] = await Promise.all([
		import('@/renderer/state/workspace/session-tab-close'),
		import('@/renderer/state/workspace/use-close-running-chat-guard'),
	]);
	return {
		resolveRunningCloseTarget: closeTarget.resolveRunningCloseTarget,
		useCloseRunningChatGuard: guard.useCloseRunningChatGuard,
	};
});

import { useGuardedSessionClose } from '../../src/renderer/hooks/workbench-shell/route-layout/use-guarded-session-close';

function chatTab(
	id: string,
	overrides: Partial<Pick<SessionTabModel, 'isSubAgent' | 'status'>> = {},
): SessionTabModel {
	return {
		agentSessionId: `session-${id}`,
		chatTabId: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		status: 'idle',
		summary: '',
		updatedLabel: '',
		...overrides,
	};
}

function setup({
	activeSessionId,
	isStreaming = false,
	tabs,
}: {
	activeSessionId: string;
	isStreaming?: boolean;
	tabs: SessionTabModel[];
}) {
	const closeActiveOrReset = vi.fn();
	const closeSessionTab = vi.fn();
	const onStop = vi.fn(async () => undefined);
	const sessionNavigation = {
		closeActiveOrReset,
		closeSessionTab,
		sessionTabs: tabs,
	};
	const rendered = renderHook(() =>
		useGuardedSessionClose({
			activeSessionId,
			agentComposer: { isStreaming, onStop } as unknown as Parameters<
				typeof useGuardedSessionClose
			>[0]['agentComposer'],
			sessionNavigation: sessionNavigation as unknown as Parameters<
				typeof useGuardedSessionClose
			>[0]['sessionNavigation'],
			workspaceId: 'workspace-1',
		}),
	);
	return { closeActiveOrReset, closeSessionTab, onStop, rendered };
}

/** Fires the ⌘W menu command the hook registered. */
function pressCloseTabShortcut() {
	const handler = menuHandlers.get('tab.close');
	if (!handler) {
		throw new Error('tab.close was never registered');
	}
	act(() => handler());
}

beforeEach(() => {
	menuHandlers.clear();
	stopAgentSessionById.mockClear();
});

describe('useGuardedSessionClose refuses a running sub-agent', () => {
	test('⌘W leaves a streaming sub-agent tab open and unconfirmed', () => {
		const { closeActiveOrReset, onStop, rendered } = setup({
			activeSessionId: 'child',
			isStreaming: true,
			tabs: [chatTab('root'), chatTab('child', { isSubAgent: true })],
		});

		pressCloseTabShortcut();

		expect(closeActiveOrReset).not.toHaveBeenCalled();
		expect(onStop).not.toHaveBeenCalled();
		expect(rendered.result.current.closeGuard.isConfirming).toBe(false);
	});

	test('⌘W refuses while only the persisted snapshot still reads working', () => {
		const { closeActiveOrReset, rendered } = setup({
			activeSessionId: 'child',
			isStreaming: false,
			tabs: [
				chatTab('root'),
				chatTab('child', { isSubAgent: true, status: 'working' }),
			],
		});

		pressCloseTabShortcut();

		expect(closeActiveOrReset).not.toHaveBeenCalled();
		expect(rendered.result.current.closeGuard.isConfirming).toBe(false);
	});

	test('the tab strip leaves a working background sub-agent open', () => {
		const { closeSessionTab, rendered } = setup({
			activeSessionId: 'root',
			tabs: [
				chatTab('root'),
				chatTab('child', { isSubAgent: true, status: 'working' }),
			],
		});

		act(() =>
			rendered.result.current.guardedSessionNavigation.closeSessionTab('child'),
		);

		expect(closeSessionTab).not.toHaveBeenCalled();
		expect(rendered.result.current.closeGuard.isConfirming).toBe(false);
	});
});

describe('useGuardedSessionClose still closes everything else', () => {
	test('the tab strip closes an idle sub-agent straight through', () => {
		const { closeSessionTab, rendered } = setup({
			activeSessionId: 'root',
			tabs: [chatTab('root'), chatTab('child', { isSubAgent: true })],
		});

		act(() =>
			rendered.result.current.guardedSessionNavigation.closeSessionTab('child'),
		);

		expect(closeSessionTab).toHaveBeenCalledWith('child');
	});

	test('⌘W on a streaming root chat still raises the confirmation', () => {
		const { closeActiveOrReset, rendered } = setup({
			activeSessionId: 'root',
			isStreaming: true,
			tabs: [chatTab('root', { status: 'working' }), chatTab('other')],
		});

		pressCloseTabShortcut();

		expect(rendered.result.current.closeGuard.isConfirming).toBe(true);
		expect(closeActiveOrReset).not.toHaveBeenCalled();
	});
});

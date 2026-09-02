// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchLayoutModel } from '@/renderer/types/workbench-shell';

const navigateSpy = vi.fn();
const model: {
	current: Pick<WorkbenchLayoutModel, 'displayProjects' | 'displaySelection'>;
} = { current: { displayProjects: [], displaySelection: null } };
/** Child router matches the mocked `useChildMatches` hands to the selector. */
const childMatches: { current: { params: Record<string, unknown> }[] } = {
	current: [],
};
/** The `chatId` the layout last passed down to the route content. */
const renderedChatId: { current: string | undefined } = { current: undefined };

vi.mock('@tanstack/react-router', () => ({
	getRouteApi: () => ({
		useParams: () => ({ projectId: 'repo-1', workspaceId: 'ws-a' }),
		useSearch: () => ({}),
	}),
	useChildMatches: (options: { select?: (matches: unknown[]) => unknown }) =>
		options.select
			? options.select(childMatches.current)
			: childMatches.current,
	useNavigate: () => navigateSpy,
}));

vi.mock('@/renderer/components/workbench-shell/shell-contexts', () => ({
	useWorkbenchLayoutRouteModel: () => model.current,
}));

vi.mock(
	'@/renderer/components/workbench-shell/route-layout/workspace-route-content',
	() => ({
		WorkspaceRouteContent: ({ chatId }: { chatId?: string }) => {
			renderedChatId.current = chatId;
			return null;
		},
	}),
);

vi.mock('@/renderer/lib/instrumentation', () => ({
	useRouteProfilerMount: () => {},
}));

const { WorkspaceWorkbenchLayout } = await import(
	'@/renderer/components/workbench-shell/route-layout/workspace-workbench-layout'
);

describe('WorkspaceWorkbenchLayout missing-selection redirect', () => {
	beforeEach(() => {
		navigateSpy.mockClear();
		model.current = { displayProjects: [], displaySelection: null };
		childMatches.current = [];
		renderedChatId.current = undefined;
	});

	// Removing the active workspace drops it from live nav data while this
	// layout is still mounted, and every router-state notification re-renders
	// the layout while its own redirect is still pending. Rendering `<Navigate>`
	// re-fired navigation per render (fresh props identity each time), which
	// superseded the pending `/` load forever and pegged the renderer in a
	// synchronous navigate/render loop. The redirect must fire exactly once no
	// matter how often the pending transition re-renders the layout.
	it('navigates to Welcome once across re-renders while the selection is missing', () => {
		const { rerender } = render(<WorkspaceWorkbenchLayout />);

		rerender(<WorkspaceWorkbenchLayout />);
		rerender(<WorkspaceWorkbenchLayout />);
		rerender(<WorkspaceWorkbenchLayout />);

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith({ replace: true, to: '/' });
	});

	// The shell resolves `displaySelection` from its own router subscription, so
	// while an archive tears this workspace down it can already name a sibling.
	// Substituting it here rendered that sibling's whole workspace view under
	// this URL — and `useActiveWorkspaceChatId` then refused the routed chat id
	// as belonging to another workspace, which is the pairing that overwrites
	// what the sibling remembered. A workspace the nav data no longer holds is
	// gone, and the redirect is the answer to that.
	it('redirects rather than rendering the shell selection under another URL', () => {
		model.current = {
			displayProjects: [
				{
					id: 'repo-1',
					name: 'repo-1',
					workspaces: [{ id: 'ws-b', name: 'ws-b' }],
				},
			] as unknown as WorkbenchLayoutModel['displayProjects'],
			displaySelection: {
				project: { id: 'repo-1', name: 'repo-1' },
				source: 'route',
				workspace: { id: 'ws-b', name: 'ws-b' },
			} as unknown as WorkbenchLayoutModel['displaySelection'],
		};

		render(<WorkspaceWorkbenchLayout />);

		expect(navigateSpy).toHaveBeenCalledWith({ replace: true, to: '/' });
		expect(renderedChatId.current).toBeUndefined();
	});

	it('does not navigate when the selection resolves', () => {
		const workspace = { id: 'ws-a', name: 'ws-a' };
		model.current = {
			displayProjects: [
				{ id: 'repo-1', name: 'repo-1', workspaces: [workspace] },
			] as unknown as WorkbenchLayoutModel['displayProjects'],
			displaySelection: null,
		};

		const { rerender } = render(<WorkspaceWorkbenchLayout />);
		rerender(<WorkspaceWorkbenchLayout />);

		expect(navigateSpy).not.toHaveBeenCalled();
	});
});

describe('WorkspaceWorkbenchLayout routed chat id', () => {
	/** Puts `ws-a` in the nav data so the layout resolves a selection for it. */
	function selectWorkspaceA() {
		model.current = {
			displayProjects: [
				{
					id: 'repo-1',
					name: 'repo-1',
					workspaces: [{ id: 'ws-a', name: 'ws-a' }],
				},
			] as unknown as WorkbenchLayoutModel['displayProjects'],
			displaySelection: null,
		};
	}

	beforeEach(() => {
		navigateSpy.mockClear();
		childMatches.current = [];
		renderedChatId.current = undefined;
		selectWorkspaceA();
	});

	it('passes the chat id down when the match names the rendered workspace', () => {
		childMatches.current = [
			{
				params: { chatId: 'chat-1', projectId: 'repo-1', workspaceId: 'ws-a' },
			},
		];

		render(<WorkspaceWorkbenchLayout />);

		expect(renderedChatId.current).toBe('chat-1');
	});

	// The workspace id and the chat id arrive on two independent router
	// subscriptions, so a pending transition can surface the incoming
	// workspace's chat beside the outgoing workspace's model. Trusting that
	// pairing made the route substitute this workspace's first tab and persist
	// it over the tab the workspace actually remembered.
	it('ignores a chat id belonging to another workspace', () => {
		childMatches.current = [
			{
				params: { chatId: 'chat-b', projectId: 'repo-2', workspaceId: 'ws-b' },
			},
		];

		render(<WorkspaceWorkbenchLayout />);

		expect(renderedChatId.current).toBeUndefined();
	});

	it('takes the deepest match that agrees on the workspace', () => {
		childMatches.current = [
			{ params: { projectId: 'repo-1', workspaceId: 'ws-a' } },
			{
				params: { chatId: 'chat-1', projectId: 'repo-1', workspaceId: 'ws-a' },
			},
			{
				params: { chatId: 'chat-b', projectId: 'repo-2', workspaceId: 'ws-b' },
			},
		];

		render(<WorkspaceWorkbenchLayout />);

		expect(renderedChatId.current).toBe('chat-1');
	});
});

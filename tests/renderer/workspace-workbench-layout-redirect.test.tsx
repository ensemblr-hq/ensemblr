// @vitest-environment happy-dom

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchLayoutModel } from '@/renderer/types/workbench-shell';

const navigateSpy = vi.fn();
const model: {
	current: Pick<WorkbenchLayoutModel, 'displayProjects' | 'displaySelection'>;
} = { current: { displayProjects: [], displaySelection: null } };

vi.mock('@tanstack/react-router', () => ({
	getRouteApi: () => ({
		useParams: () => ({ projectId: 'repo-1', workspaceId: 'ws-a' }),
		useSearch: () => ({}),
	}),
	useChildMatches: (options: { select?: (matches: unknown[]) => unknown }) =>
		options.select ? options.select([]) : [],
	useNavigate: () => navigateSpy,
}));

vi.mock('@/renderer/components/workbench-shell/shell-contexts', () => ({
	useWorkbenchLayoutRouteModel: () => model.current,
}));

vi.mock(
	'@/renderer/components/workbench-shell/route-layout/workspace-route-content',
	() => ({
		WorkspaceRouteContent: () => null,
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

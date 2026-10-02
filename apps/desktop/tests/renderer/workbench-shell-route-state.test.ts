import { describe, expect, it } from 'vitest';

import {
	packWorkbenchShellRouteState,
	unpackWorkbenchShellRouteState,
} from '@/renderer/lib/workbench';
import type { WorkbenchChildMatch } from '@/renderer/types/components';

/** Builds the reduced child match the selector reads. */
function match(
	params: Record<string, unknown>,
	workbenchView?: string,
): WorkbenchChildMatch {
	return {
		params,
		staticData: workbenchView ? { workbenchView } : {},
	};
}

const WORKSPACE_MATCHES: WorkbenchChildMatch[] = [
	match({}, 'welcome'),
	match({ projectId: 'repo-1', workspaceId: 'ws-a' }, 'workspace'),
	match({ chatId: 'chat-1', projectId: 'repo-1', workspaceId: 'ws-a' }),
];

describe('packWorkbenchShellRouteState', () => {
	// This selector runs on EVERY router-state notification and its result is
	// compared by shallow equality, with `defaultStructuralSharing` off. The
	// `matches.map(...)` it replaced returned a fresh array of fresh objects each
	// call, so the whole workbench shell — frame, sidebar, every workspace row —
	// re-rendered for router activity that changed nothing, which is what made a
	// burst of workspace switches during an archive read as the chrome coming
	// apart. The packed value has to compare equal to itself across calls.
	it('returns an identical value for matches that describe the same route', () => {
		const first = packWorkbenchShellRouteState(WORKSPACE_MATCHES);
		const second = packWorkbenchShellRouteState(
			WORKSPACE_MATCHES.map((entry) => match(entry.params, 'workspace')),
		);

		expect(first).toBe(packWorkbenchShellRouteState(WORKSPACE_MATCHES));
		expect(typeof first).toBe('string');
		expect(second).not.toBe('');
	});

	it('changes when the routed workspace changes', () => {
		const onA = packWorkbenchShellRouteState(WORKSPACE_MATCHES);
		const onB = packWorkbenchShellRouteState([
			match({ projectId: 'repo-1', workspaceId: 'ws-b' }, 'workspace'),
		]);

		expect(onA).not.toBe(onB);
	});

	it('round-trips the routed ids through the packed string', () => {
		expect(
			unpackWorkbenchShellRouteState(
				packWorkbenchShellRouteState(WORKSPACE_MATCHES),
			),
		).toEqual({
			routeProjectId: 'repo-1',
			routeWorkspaceId: 'ws-a',
			view: 'workspace',
		});
	});

	it('takes the innermost match that names a view', () => {
		expect(
			unpackWorkbenchShellRouteState(
				packWorkbenchShellRouteState([
					match({}, 'welcome'),
					match({}, 'dashboard'),
				]),
			),
		).toEqual({ view: 'dashboard' });
	});

	it('holds on Welcome when no match names a workbench view', () => {
		expect(
			unpackWorkbenchShellRouteState(
				packWorkbenchShellRouteState([match({ chatId: 'chat-1' })]),
			),
		).toEqual({ view: 'welcome' });
	});

	// A workspace view whose match carries no ids must not report a half-pair the
	// selection resolver would then treat as a route.
	it('reports no ids for a workspace view whose match carries none', () => {
		expect(
			unpackWorkbenchShellRouteState(
				packWorkbenchShellRouteState([match({}, 'workspace')]),
			),
		).toEqual({
			routeProjectId: undefined,
			routeWorkspaceId: undefined,
			view: 'workspace',
		});
	});
});

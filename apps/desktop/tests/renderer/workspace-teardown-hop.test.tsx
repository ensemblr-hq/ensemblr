// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateSpy = vi.fn(async () => {});
/** The href `router.state.location` reports, moved by the fake navigations. */
const currentHref = { value: '/projects/repo-1/workspaces/ws-a/chats/chat-1' };

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => navigateSpy,
	useRouter: () => ({
		state: {
			get location() {
				return { href: currentHref.value };
			},
		},
	}),
}));

const { useWorkspaceTeardownHop } = await import(
	'@/renderer/hooks/workbench-shell/use-workspace-teardown-hop'
);

/** Renders the hook for a shell standing in `ws-a`. */
function renderHop(activeWorkspaceId: string | null = 'ws-a') {
	return renderHook(() => useWorkspaceTeardownHop({ activeWorkspaceId }))
		.result;
}

describe('useWorkspaceTeardownHop', () => {
	beforeEach(() => {
		navigateSpy.mockClear();
		currentHref.value = '/projects/repo-1/workspaces/ws-a/chats/chat-1';
		navigateSpy.mockImplementation(async () => {
			currentHref.value = '/projects/repo-1/workspaces/ws-b/chats/chat-2';
		});
	});

	it('runs without hopping when the teardown is not the active workspace', async () => {
		const { current: hop } = renderHop('ws-other');

		await hop('ws-a', async () => ({ status: 'success' as const }));

		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it('leaves the workspace before a teardown of the active one', async () => {
		const { current: hop } = renderHop();

		await hop('ws-a', async () => ({ status: 'success' as const }));

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith({ replace: true, to: '/' });
	});

	it('puts the user back when the teardown did not happen', async () => {
		const returnHref = currentHref.value;
		const { current: hop } = renderHop();

		await hop('ws-a', async () => ({ status: 'aborted' as const }));

		expect(navigateSpy).toHaveBeenNthCalledWith(2, {
			href: returnHref,
			replace: true,
		});
	});

	// The restore is only theirs to want while they are still standing where the
	// hop left them. A teardown can fail long after the hop, and yanking a user
	// out of a workspace they opened in the meantime is the "app can't decide
	// which workspace to activate" the hop exists to prevent, not cause.
	it('declines to restore once the user has navigated somewhere else', async () => {
		const { current: hop } = renderHop();

		await hop('ws-a', async () => {
			currentHref.value = '/projects/repo-1/workspaces/ws-c/chats/chat-3';
			return { status: 'failure' as const };
		});

		expect(navigateSpy).toHaveBeenCalledTimes(1);
		expect(navigateSpy).toHaveBeenCalledWith({ replace: true, to: '/' });
	});

	it('restores after a rejected teardown and rethrows it', async () => {
		const returnHref = currentHref.value;
		const { current: hop } = renderHop();

		await expect(
			hop('ws-a', async () => {
				throw new Error('main refused');
			}),
		).rejects.toThrow('main refused');
		expect(navigateSpy).toHaveBeenNthCalledWith(2, {
			href: returnHref,
			replace: true,
		});
	});

	it('runs the teardown anyway when the hop itself fails', async () => {
		navigateSpy.mockImplementation(async () => {
			throw new Error('navigation blocked');
		});
		const run = vi.fn(async () => ({ status: 'success' as const }));
		const { current: hop } = renderHop();

		await hop('ws-a', run);

		expect(run).toHaveBeenCalledTimes(1);
	});
});

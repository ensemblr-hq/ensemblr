import { describe, expect, test } from 'vitest';

import { resolveBoardDrop } from '../../src/renderer/components/workbench-shell/dashboard/use-board-drag';

describe('resolveBoardDrop', () => {
	test('returns null when the source has no workspace id', () => {
		expect(resolveBoardDrop({ type: 'workspace-card' }, [])).toBeNull();
	});

	test('resolves a card target as a reorder drop', () => {
		const drop = resolveBoardDrop({ workspaceId: 'a' }, [
			{ data: { type: 'workspace-card', workspaceId: 'b' } },
		]);
		expect(drop).toMatchObject({
			sourceId: 'a',
			targetCardId: 'b',
			targetColumnStatus: null,
		});
	});

	test('prefers a card target over the enclosing column target', () => {
		const drop = resolveBoardDrop({ workspaceId: 'a' }, [
			{ data: { type: 'workspace-card', workspaceId: 'b' } },
			{ data: { status: 'done', type: 'board-column' } },
		]);
		expect(drop?.targetCardId).toBe('b');
	});

	test('resolves a column target as a cross-column drop', () => {
		const drop = resolveBoardDrop({ workspaceId: 'a' }, [
			{ data: { status: 'in-review', type: 'board-column' } },
		]);
		expect(drop).toEqual({
			edge: null,
			sourceId: 'a',
			targetCardId: null,
			targetColumnStatus: 'in-review',
		});
	});

	test('returns null for an unknown column status', () => {
		expect(
			resolveBoardDrop({ workspaceId: 'a' }, [
				{ data: { status: 'archived', type: 'board-column' } },
			]),
		).toBeNull();
	});
});

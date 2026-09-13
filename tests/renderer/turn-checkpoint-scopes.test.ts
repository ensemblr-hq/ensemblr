import { expect, test } from 'vitest';

import {
	latestTurnCheckpointScope,
	turnCheckpointScopes,
} from '@/renderer/lib/workbench';
import { diffTabTitle } from '@/renderer/state/workspace/session-tab-titles';
import type { CheckpointWire } from '@/shared/ipc/contracts/checkpoint';

/** A checkpoint row as the listing IPC returns it. */
function checkpoint(
	overrides: Partial<CheckpointWire> & { id: string },
): CheckpointWire {
	return {
		agentSessionId: 'session-1',
		createdAt: '2026-09-13T15:48:00.000Z',
		gitHash: overrides.id.repeat(40).slice(0, 40),
		gitRef: `refs/ensemblr/checkpoints/ws-1/${overrides.id}`,
		label: overrides.id,
		turnId: `turn-${overrides.id}`,
		workspaceId: 'ws-1',
		...overrides,
	};
}

test("a turn diffs to the next turn's checkpoint, the newest to the working tree", () => {
	const scopes = turnCheckpointScopes([
		checkpoint({ id: 'a' }),
		checkpoint({ id: 'b' }),
		checkpoint({ id: 'c' }),
	]);

	expect(scopes.get('turn-a')?.scope).toEqual({
		fromRef: 'a'.repeat(40),
		kind: 'turn',
		toRef: 'b'.repeat(40),
	});
	// The newest turn has nothing after it, so it stays live.
	expect(scopes.get('turn-c')?.scope).toEqual({
		fromRef: 'c'.repeat(40),
		kind: 'turn',
	});
	expect(
		latestTurnCheckpointScope([
			checkpoint({ id: 'a' }),
			checkpoint({ id: 'c' }),
		])?.turnId,
	).toBe('turn-c');
});

test('a capture that failed is skipped rather than pairing the wrong turns', () => {
	const scopes = turnCheckpointScopes([
		checkpoint({ id: 'a' }),
		checkpoint({ gitHash: null, id: 'b' }),
		checkpoint({ id: 'c' }),
	]);

	expect(scopes.has('turn-b')).toBe(false);
	// `a` pairs with `c` because `b` never produced a commit to diff against.
	expect(scopes.get('turn-a')?.scope.toRef).toBe('c'.repeat(40));
});

test('nothing captured yields no latest turn', () => {
	expect(latestTurnCheckpointScope([])).toBeNull();
	expect(
		latestTurnCheckpointScope([checkpoint({ gitHash: null, id: 'a' })]),
	).toBeNull();
});

test('two turns viewing one file get distinguishable tab titles', () => {
	// Diff-tab identity already keys on the serialized scope; the title is what
	// lets the user tell the two resulting tabs apart in the strip.
	const first = 'a'.repeat(40);
	const second = 'b'.repeat(40);

	expect(diffTabTitle('src/app.ts', { fromRef: first, kind: 'turn' })).toBe(
		`app.ts (${first.slice(0, 7)})`,
	);
	expect(
		diffTabTitle('src/app.ts', { fromRef: second, kind: 'turn' }),
	).not.toBe(diffTabTitle('src/app.ts', { fromRef: first, kind: 'turn' }));
});

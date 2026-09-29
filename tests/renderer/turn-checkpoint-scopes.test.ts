import type { UIMessage } from 'ai';
import { expect, test } from 'vitest';

import {
	currentTurnScope,
	latestTurnCheckpointScope,
	turnActionOwners,
	turnCheckpointScopes,
} from '@/renderer/lib/workbench';
import { diffTabTitle } from '@/renderer/state/workspace/session-tab-titles';
import type { TurnCheckpointWire } from '@/shared/ipc/contracts/checkpoint';

/** A checkpoint row as the listing IPC returns it, live unless told otherwise. */
function checkpoint(
	overrides: Partial<TurnCheckpointWire> & { id: string },
): TurnCheckpointWire {
	return {
		agentSessionId: 'session-1',
		createdAt: '2026-09-13T15:48:00.000Z',
		end: { kind: 'working-tree' },
		gitHash: hashOf(overrides.id),
		gitRef: `refs/ensemblr/checkpoints/ws-1/${overrides.id}`,
		label: overrides.id,
		turnId: `turn-${overrides.id}`,
		workspaceId: 'ws-1',
		...overrides,
	};
}

/** The fake commit hash a test checkpoint carries. */
function hashOf(id: string): string {
	return id.repeat(40).slice(0, 40);
}

/** An assistant row the timeline projector produced for a turn. */
function assistantRow(id: string, turnId: string | null): UIMessage {
	return {
		id,
		metadata: {
			firstEventAt: '2026-09-13T15:48:00.000Z',
			lastEventAt: '2026-09-13T15:49:00.000Z',
			lastOrdinal: 1,
			turnId,
		},
		parts: [{ state: 'done', text: id, type: 'text' }],
		role: 'assistant',
	};
}

/** A user bubble, which carries no turn metadata of its own. */
function userRow(id: string): UIMessage {
	return {
		id,
		parts: [{ state: 'done', text: id, type: 'text' }],
		role: 'user',
	};
}

test('each turn takes the end main resolved for it', () => {
	const scopes = turnCheckpointScopes([
		checkpoint({ end: { gitHash: hashOf('b'), kind: 'checkpoint' }, id: 'a' }),
		checkpoint({ id: 'b' }),
	]);

	expect(scopes.get('turn-a')?.scope).toEqual({
		fromRef: hashOf('a'),
		kind: 'turn',
		toRef: hashOf('b'),
	});
	expect(scopes.get('turn-b')?.scope).toEqual({
		fromRef: hashOf('b'),
		kind: 'turn',
	});
});

test('a turn whose end is unknown keeps its restore point but no diff', () => {
	const scopes = turnCheckpointScopes([
		checkpoint({ end: { kind: 'unknown' }, id: 'a' }),
	]);

	expect(scopes.get('turn-a')).toEqual({
		label: 'a',
		scope: null,
		turnId: 'turn-a',
	});
});

test('a checkpoint without a commit or a turn opens no range', () => {
	const scopes = turnCheckpointScopes([
		checkpoint({ gitHash: null, id: 'a' }),
		checkpoint({ id: 'b', turnId: null }),
	]);

	expect(scopes.size).toBe(0);
});

test('the latest turn is the newest captured checkpoint', () => {
	expect(
		latestTurnCheckpointScope([
			checkpoint({
				end: { gitHash: hashOf('c'), kind: 'checkpoint' },
				id: 'a',
			}),
			checkpoint({ id: 'c' }),
		])?.turnId,
	).toBe('turn-c');
	expect(latestTurnCheckpointScope([])).toBeNull();
	expect(
		latestTurnCheckpointScope([checkpoint({ gitHash: null, id: 'a' })]),
	).toBeNull();
});

test('a diff tab opened on the newest turn follows it once the next turn closes it', () => {
	const opened = { fromRef: hashOf('a'), kind: 'turn' } as const;

	expect(currentTurnScope(opened, [checkpoint({ id: 'a' })])).toEqual(opened);
	expect(
		currentTurnScope(opened, [
			checkpoint({
				end: { gitHash: hashOf('b'), kind: 'checkpoint' },
				id: 'a',
			}),
			checkpoint({ id: 'b' }),
		]),
	).toEqual({ fromRef: hashOf('a'), kind: 'turn', toRef: hashOf('b') });
});

test('a diff tab follows a turn that moved past the end it stored', () => {
	const stored = {
		fromRef: hashOf('a'),
		kind: 'turn',
		toRef: hashOf('b'),
	} as const;

	// Claude paused on an SDK result, the tab opened, then the turn resumed.
	expect(currentTurnScope(stored, [checkpoint({ id: 'a' })])).toEqual({
		fromRef: hashOf('a'),
		kind: 'turn',
	});
	expect(
		currentTurnScope(stored, [
			checkpoint({
				end: { gitHash: hashOf('b'), kind: 'checkpoint' },
				id: 'a',
			}),
		]),
	).toBe(stored);
});

test('a diff tab withholds a live scope whose turn end was lost, and keeps a closed one', () => {
	const live = { fromRef: hashOf('a'), kind: 'turn' } as const;
	const closed = {
		fromRef: hashOf('a'),
		kind: 'turn',
		toRef: hashOf('b'),
	} as const;
	const lost = [checkpoint({ end: { kind: 'unknown' }, id: 'a' })];

	// Diffing on against the live tree would report later work as this turn's.
	expect(currentTurnScope(live, lost)).toBeNull();
	expect(currentTurnScope(closed, lost)).toBe(closed);
});

test('a diff tab leaves an unlisted or non-turn scope as it was', () => {
	const live = { fromRef: hashOf('a'), kind: 'turn' } as const;

	expect(currentTurnScope(live, [])).toBe(live);
	expect(currentTurnScope({ kind: 'working-tree' }, [])).toEqual({
		kind: 'working-tree',
	});
	expect(currentTurnScope(undefined, [])).toBeUndefined();
});

test('a steered turn lists its files once, under its last row, and restores from its first', () => {
	const owners = turnActionOwners([
		userRow('prompt-1'),
		assistantRow('reply-1', 'turn-1'),
		userRow('steer'),
		assistantRow('reply-1b', 'turn-1'),
		userRow('prompt-2'),
		assistantRow('reply-2', 'turn-2'),
		assistantRow('orphan', null),
	]);

	expect([...owners.diffOwnerIds]).toEqual(['reply-1b', 'reply-2']);
	expect([...owners.restoreOwnerIds]).toEqual(['reply-1', 'reply-2']);
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

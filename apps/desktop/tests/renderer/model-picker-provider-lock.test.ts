/**
 * The per-chat provider pin, at the pure-function boundary. A chat pinned to one
 * agent runtime must still *show* every other runtime's models — marked `locked`
 * — because a list that silently shrinks once a chat has a session reads as a
 * bug. Every assertion here therefore checks group membership and row counts
 * alongside the lock flags; a count-only test would pass against a hide
 * implementation.
 */

import { describe, expect, test } from 'vitest';

import { buildModelGroups } from '../../src/renderer/lib/workbench/model-picker-groups';
import type {
	ComposerModelOption,
	GroupedOptions,
} from '../../src/renderer/types/workbench';
import type { AgentProviderId } from '../../src/shared/agent-provider';
import { asModelVendorId } from '../../src/shared/ipc/contracts/agent-models';

function model(
	id: string,
	vendor: string,
	agentProvider: AgentProviderId,
): ComposerModelOption {
	return {
		agentProvider,
		contextWindow: 200_000,
		displayName: id,
		id,
		isDefault: false,
		vendor: asModelVendorId(vendor),
	};
}

const PI_ANTHROPIC = 'pi/anthropic-haiku';
const CLAUDE_ANTHROPIC = 'claude/anthropic-opus';
const PI_GEMINI = 'pi/gemini';
const CLAUDE_CODE = 'claude/code-sonnet';

/**
 * Two runtimes crossed with three inference providers. `PI_ANTHROPIC` and
 * `CLAUDE_ANTHROPIC` deliberately share the `anthropic` group: the lock keys off
 * the runtime axis, so a group holding one of each proves the two axes stay
 * independent and that locking never moves a row out of its group.
 */
const OPTIONS: readonly ComposerModelOption[] = [
	model(PI_ANTHROPIC, 'anthropic', 'pi'),
	model(CLAUDE_ANTHROPIC, 'anthropic', 'claude'),
	model(PI_GEMINI, 'google', 'pi'),
	model(CLAUDE_CODE, 'claude-code', 'claude'),
];

const PI_IDS = [PI_ANTHROPIC, PI_GEMINI];
const CLAUDE_IDS = [CLAUDE_ANTHROPIC, CLAUDE_CODE];

/** Flattens groups to `{ groupKey, ids, providerLabel }`, the shape the lock must not disturb. */
function membershipOf(groups: readonly GroupedOptions[]) {
	return groups.map((group) => ({
		ids: group.models.map((row) => row.model.id),
		provider: group.provider,
		providerLabel: group.providerLabel,
	}));
}

/** Ids of every row the pin greys out, in flattened picker order. */
function lockedIdsOf(groups: readonly GroupedOptions[]): string[] {
	return groups.flatMap((group) =>
		group.models.flatMap((row) => (row.locked ? [row.model.id] : [])),
	);
}

/** Ids of every row that stays selectable, in flattened picker order. */
function selectableIdsOf(groups: readonly GroupedOptions[]): string[] {
	return groups.flatMap((group) =>
		group.models.flatMap((row) => (row.locked ? [] : [row.model.id])),
	);
}

/** Every row across every group, for count assertions. */
function rowsOf(groups: readonly GroupedOptions[]) {
	return groups.flatMap((group) => group.models);
}

describe('buildModelGroups provider lock — unlocked', () => {
	test('an explicit null lock leaves every row selectable', () => {
		const groups = buildModelGroups(OPTIONS, [], [], null);

		expect(rowsOf(groups)).toHaveLength(OPTIONS.length);
		expect(rowsOf(groups).every((row) => row.locked === false)).toBe(true);
	});

	test('the three-argument call defaults to no lock', () => {
		const groups = buildModelGroups(OPTIONS, [], []);

		expect(lockedIdsOf(groups)).toEqual([]);
		expect(rowsOf(groups)).toHaveLength(OPTIONS.length);
	});

	test('the two-argument call defaults to no lock', () => {
		const groups = buildModelGroups(OPTIONS, [CLAUDE_CODE]);

		expect(lockedIdsOf(groups)).toEqual([]);
		expect(rowsOf(groups)).toHaveLength(OPTIONS.length);
	});
});

describe('buildModelGroups provider lock — pinned to Pi', () => {
	test('locks every Claude row and leaves the Pi rows selectable', () => {
		const groups = buildModelGroups(OPTIONS, [], [], 'pi');

		expect(lockedIdsOf(groups)).toEqual(CLAUDE_IDS);
		expect(selectableIdsOf(groups)).toEqual(PI_IDS);
	});

	test('keeps every row and every group membership intact', () => {
		const unlocked = buildModelGroups(OPTIONS, [], [], null);
		const locked = buildModelGroups(OPTIONS, [], [], 'pi');

		expect(rowsOf(locked)).toHaveLength(rowsOf(unlocked).length);
		expect(rowsOf(locked)).toHaveLength(OPTIONS.length);
		expect(membershipOf(locked)).toEqual(membershipOf(unlocked));
	});

	test('a locked row stays inside its inference-provider group', () => {
		const groups = buildModelGroups(OPTIONS, [], [], 'pi');
		const anthropic = groups.find((group) => group.provider === 'anthropic');

		expect(anthropic?.models.map((row) => row.model.id)).toEqual([
			PI_ANTHROPIC,
			CLAUDE_ANTHROPIC,
		]);
		expect(anthropic?.models.map((row) => row.locked)).toEqual([false, true]);
	});
});

describe('buildModelGroups provider lock — pinned to Claude', () => {
	test('locks every Pi row and leaves the Claude rows selectable', () => {
		const groups = buildModelGroups(OPTIONS, [], [], 'claude');

		expect(lockedIdsOf(groups)).toEqual(PI_IDS);
		expect(selectableIdsOf(groups)).toEqual(CLAUDE_IDS);
	});

	test('keeps every row and every group membership intact', () => {
		const unlocked = buildModelGroups(OPTIONS, [], [], null);
		const locked = buildModelGroups(OPTIONS, [], [], 'claude');

		expect(rowsOf(locked)).toHaveLength(OPTIONS.length);
		expect(membershipOf(locked)).toEqual(membershipOf(unlocked));
	});
});

describe('buildModelGroups provider lock — favourites and hiding', () => {
	test('the lock crosses into the Favourites group', () => {
		const groups = buildModelGroups(OPTIONS, [CLAUDE_CODE], [], 'pi');
		const favourites = groups[0];

		expect(favourites?.providerLabel).toBe('Favourites');
		expect(favourites?.models.map((row) => row.model.id)).toEqual([
			CLAUDE_CODE,
		]);
		expect(favourites?.models.map((row) => row.locked)).toEqual([true]);
	});

	test('a favourited row is not duplicated back into its provider group', () => {
		const groups = buildModelGroups(OPTIONS, [CLAUDE_CODE], [], 'pi');

		expect(rowsOf(groups)).toHaveLength(OPTIONS.length);
		expect(lockedIdsOf(groups)).toEqual([CLAUDE_CODE, CLAUDE_ANTHROPIC]);
	});

	test('hiding still beats locking for a model of the locked runtime', () => {
		const groups = buildModelGroups(OPTIONS, [], [PI_GEMINI], 'pi');
		const ids = rowsOf(groups).map((row) => row.model.id);

		expect(ids).not.toContain(PI_GEMINI);
		expect(ids).toEqual([PI_ANTHROPIC, CLAUDE_ANTHROPIC, CLAUDE_CODE]);
	});

	test('hiding still beats locking for a model of a locked-out runtime', () => {
		const groups = buildModelGroups(OPTIONS, [], [CLAUDE_CODE], 'pi');
		const ids = rowsOf(groups).map((row) => row.model.id);

		expect(ids).not.toContain(CLAUDE_CODE);
		expect(lockedIdsOf(groups)).toEqual([CLAUDE_ANTHROPIC]);
	});
});

describe('buildModelGroups provider lock — group shape', () => {
	test('group order and provider labels are identical locked and unlocked', () => {
		const unlocked = buildModelGroups(OPTIONS, [CLAUDE_ANTHROPIC], []);
		const pinnedToPi = buildModelGroups(OPTIONS, [CLAUDE_ANTHROPIC], [], 'pi');
		const pinnedToClaude = buildModelGroups(
			OPTIONS,
			[CLAUDE_ANTHROPIC],
			[],
			'claude',
		);
		const shapeOf = (groups: readonly GroupedOptions[]) =>
			groups.map((group) => [group.provider, group.providerLabel]);

		expect(shapeOf(pinnedToPi)).toEqual(shapeOf(unlocked));
		expect(shapeOf(pinnedToClaude)).toEqual(shapeOf(unlocked));
		expect(shapeOf(unlocked)).toEqual([
			['__favourites__', 'Favourites'],
			['anthropic', 'Anthropic'],
			['google', 'Gemini'],
			['claude-code', 'Claude Code'],
		]);
	});
});

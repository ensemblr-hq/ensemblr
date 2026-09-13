import { expect, test } from 'vitest';
import {
	parseWorkspaceGitDiffScope,
	serializeWorkspaceGitDiffScope,
} from '../../src/shared/ipc/contracts/workspace-git';

const FROM_REF = 'a'.repeat(40);
const TO_REF = 'b'.repeat(40);

test('a frozen turn and a live turn serialize to different keys', () => {
	// The key backs both the query cache and diff-tab identity, so the two legs
	// of one turn must not collapse onto each other.
	expect(
		serializeWorkspaceGitDiffScope({
			fromRef: FROM_REF,
			kind: 'turn',
			toRef: TO_REF,
		}),
	).toBe(`turn:${FROM_REF}..${TO_REF}`);
	expect(
		serializeWorkspaceGitDiffScope({ fromRef: FROM_REF, kind: 'turn' }),
	).toBe(`turn:${FROM_REF}..working-tree`);
});

test('a turn scope round-trips through persisted tab metadata', () => {
	// A diff tab stores its scope as an untyped record; losing the turn arm here
	// would silently reopen the tab against the working tree instead. The inputs
	// are written untyped because that is what comes back off the tab row.
	expect(
		parseWorkspaceGitDiffScope({ fromRef: FROM_REF, kind: 'turn' }),
	).toEqual({ fromRef: FROM_REF, kind: 'turn' });
	expect(
		parseWorkspaceGitDiffScope({
			fromRef: FROM_REF,
			kind: 'turn',
			toRef: TO_REF,
		}),
	).toEqual({ fromRef: FROM_REF, kind: 'turn', toRef: TO_REF });
	// Extra keys a future writer might add are dropped rather than carried.
	expect(
		parseWorkspaceGitDiffScope({
			fromRef: FROM_REF,
			kind: 'turn',
			stray: 'ignored',
		}),
	).toEqual({ fromRef: FROM_REF, kind: 'turn' });
});

test('a malformed turn scope is refused rather than half-parsed', () => {
	expect(parseWorkspaceGitDiffScope({ kind: 'turn' })).toBeUndefined();
	expect(
		parseWorkspaceGitDiffScope({ fromRef: 7, kind: 'turn' }),
	).toBeUndefined();
	// A malformed toRef is refused rather than read as the live working tree —
	// that reading would widen a historical turn to every edit made since.
	expect(
		parseWorkspaceGitDiffScope({ fromRef: FROM_REF, kind: 'turn', toRef: 7 }),
	).toBeUndefined();
	expect(
		parseWorkspaceGitDiffScope({
			fromRef: FROM_REF,
			kind: 'turn',
			toRef: null,
		}),
	).toBeUndefined();
});

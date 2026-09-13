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
	// A diff tab stores its scope as untyped metadata; losing the turn arm here
	// would silently reopen the tab against the working tree instead.
	for (const scope of [
		{ fromRef: FROM_REF, kind: 'turn' as const },
		{ fromRef: FROM_REF, kind: 'turn' as const, toRef: TO_REF },
	]) {
		expect(
			parseWorkspaceGitDiffScope(JSON.parse(JSON.stringify(scope))),
		).toEqual(scope);
	}
});

test('a malformed turn scope is refused rather than half-parsed', () => {
	expect(parseWorkspaceGitDiffScope({ kind: 'turn' })).toBeUndefined();
	expect(
		parseWorkspaceGitDiffScope({ fromRef: 7, kind: 'turn' }),
	).toBeUndefined();
	// A non-string toRef is dropped, leaving the live-working-tree reading.
	expect(
		parseWorkspaceGitDiffScope({ fromRef: FROM_REF, kind: 'turn', toRef: 7 }),
	).toEqual({ fromRef: FROM_REF, kind: 'turn' });
});

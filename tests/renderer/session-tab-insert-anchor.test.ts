import { expect, test } from 'vitest';

import { resolveInsertAnchorId } from '../../src/renderer/state/workspace/session-tab-insert-anchor';
import type { SessionTabModel } from '../../src/renderer/types/workbench';

/** Builds a minimal chat strip tab for anchor resolution. */
function createTab(id: string): SessionTabModel {
	return {
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		piSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

test('resolveInsertAnchorId anchors on the active strip tab', () => {
	const tabs = [createTab('a'), createTab('b')];

	expect(resolveInsertAnchorId(tabs, 'b')).toBe('b');
});

test('resolveInsertAnchorId returns null for a session outside the strip', () => {
	expect(resolveInsertAnchorId([createTab('a')], 'ws-1:overview')).toBeNull();
});

test('resolveInsertAnchorId returns null for an empty strip', () => {
	expect(resolveInsertAnchorId([], 'ws-1:overview')).toBeNull();
});

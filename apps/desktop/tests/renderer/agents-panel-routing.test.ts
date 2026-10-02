import { describe, expect, test } from 'vitest';

import { normalizeWorkbenchSearch } from '../../src/renderer/lib/workbench/route-search';
import { getPreferredReviewTab } from '../../src/renderer/state/workspace/panel-tabs';

describe('Agents panel routing', () => {
	test('accepts agents in route search without changing the default', () => {
		expect(normalizeWorkbenchSearch({ review: 'agents' }).review).toBe(
			'agents',
		);
		expect(normalizeWorkbenchSearch({ review: 'invalid' }).review).toBe(
			'changes',
		);
	});

	test('persists agents as a workspace panel preference', () => {
		expect(
			getPreferredReviewTab({
				reviewTabsByWorkspace: { workspace: 'agents' },
				workspaceId: 'workspace',
			}),
		).toBe('agents');
	});
});

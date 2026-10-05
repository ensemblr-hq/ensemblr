import { describe, expect, test } from 'vitest';

import { conciergeToggleHost } from '@/renderer/lib/workbench';

describe('which part of the workspace screen carries the Concierge toggle', () => {
	test('the rail, while it sits open beside the content', () => {
		expect(
			conciergeToggleHost({
				isNarrowViewport: false,
				isRightSidebarCollapsed: false,
			}),
		).toBe('rail');
	});

	// Collapsed, the rail stays mounted at zero width, so a toggle left in it
	// would still be in the tab order beside the one the content column shows.
	test('the content column, once the rail is collapsed', () => {
		expect(
			conciergeToggleHost({
				isNarrowViewport: false,
				isRightSidebarCollapsed: true,
			}),
		).toBe('footer');
	});

	// The narrow sheet is modal, so a panel opened from inside it would open
	// behind its overlay — whether or not the sheet is showing right now.
	test('the content column on a narrow window, sheet open or shut', () => {
		expect(
			conciergeToggleHost({
				isNarrowViewport: true,
				isRightSidebarCollapsed: false,
			}),
		).toBe('footer');
		expect(
			conciergeToggleHost({
				isNarrowViewport: true,
				isRightSidebarCollapsed: true,
			}),
		).toBe('footer');
	});
});

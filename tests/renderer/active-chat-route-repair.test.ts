import { describe, expect, test } from 'vitest';

import { resolveChatRouteRepair } from '@/renderer/state/workspace/active-chat-route-repair';

describe('resolveChatRouteRepair', () => {
	test('leaves a route alone once its chat id resolves', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				resolvedChatId: 'tab-2',
				visitOrder: ['tab-1'],
			}),
		).toBeNull();
	});

	// A mid-refetch snapshot reads as empty, and repairing off it would yank the
	// user onto another tab and back.
	test('waits for the tab list to settle before repairing', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: false,
				openTabIds: ['tab-1'],
				resolvedChatId: null,
				visitOrder: ['tab-1'],
			}),
		).toBeNull();
	});

	test('repairs onto the most recently visited tab still open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2', 'tab-3'],
				rememberedChatId: 'tab-1',
				resolvedChatId: null,
				visitOrder: ['closed-tab', 'tab-3', 'tab-1'],
			}),
		).toBe('tab-3');
	});

	test('falls back to the remembered tab when nothing visited is open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				rememberedChatId: 'tab-2',
				resolvedChatId: null,
				visitOrder: ['closed-tab'],
			}),
		).toBe('tab-2');
	});

	test('ignores a remembered tab that is no longer open', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: ['tab-1', 'tab-2'],
				rememberedChatId: 'closed-tab',
				resolvedChatId: null,
				visitOrder: [],
			}),
		).toBe('tab-1');
	});

	test('reports no target for a workspace whose strip is empty', () => {
		expect(
			resolveChatRouteRepair({
				hasSettledTabList: true,
				openTabIds: [],
				rememberedChatId: 'closed-tab',
				resolvedChatId: null,
				visitOrder: ['closed-tab'],
			}),
		).toBeNull();
	});
});

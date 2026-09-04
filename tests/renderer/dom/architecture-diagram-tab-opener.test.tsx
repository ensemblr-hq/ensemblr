// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSessionTabOpeners } from '@/renderer/state/workspace/session-tab-openers';

const openers = (findOpenDiagramTabId: () => string | null) => {
	const openAuxiliaryTab = vi.fn(async () => ({ tab: { id: 'new-tab' } }));
	const { result } = renderHook(() =>
		useSessionTabOpeners({
			findOpenDiagramTabId,
			insertAnchorTabId: null,
			openAuxiliaryTab,
			openChatTab: vi.fn(async () => ({ tab: { id: 'chat' } })),
			workspaceId: 'ws-1',
		}),
	);
	return { openAuxiliaryTab, result };
};

// A workspace has exactly one architecture, so a second tab for it is a
// duplicate rather than a different subject. The preview slot only retargets an
// *ephemeral* tab, which is why a pinned diagram tab used to get a twin.
describe('openArchitectureDiagramTab', () => {
	it('opens a pinned diagram tab when the workspace has none', async () => {
		const { openAuxiliaryTab, result } = openers(() => null);

		expect(await result.current.openArchitectureDiagramTab()).toEqual({
			chatTabId: 'new-tab',
		});
		expect(openAuxiliaryTab).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'diagram', preview: false }),
		);
	});

	it('returns the tab already showing the diagram, pinned or not', async () => {
		const { openAuxiliaryTab, result } = openers(() => 'existing-tab');

		expect(await result.current.openArchitectureDiagramTab()).toEqual({
			chatTabId: 'existing-tab',
		});
		expect(openAuxiliaryTab).not.toHaveBeenCalled();
	});
});

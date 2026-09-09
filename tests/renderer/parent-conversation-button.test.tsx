// @vitest-environment happy-dom
import { createStore, Provider } from 'jotai';
import { expect, test, vi } from 'vitest';

import { ParentConversationButton } from '../../src/renderer/components/workbench-shell/conversation-panel/parent-conversation-button';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const parent: SessionTabModel = {
	agentSessionId: 'parent-session',
	chatTabId: 'parent-tab',
	id: 'parent-tab',
	isPreview: false,
	isSubAgent: false,
	kind: 'chat',
	label: 'Orchestrator',
	status: 'idle',
	summary: '',
	updatedLabel: '',
};

test('parent navigation names and selects the persisted open parent tab', async () => {
	const onNavigate = vi.fn();
	const { getByRole } = renderWithProviders(
		<Provider store={createStore()}>
			<ParentConversationButton onNavigate={onNavigate} parent={parent} />
		</Provider>,
	);
	const button = getByRole('button', {
		name: 'Go to parent chat: Orchestrator',
	});

	button.click();
	expect(onNavigate).toHaveBeenCalledOnce();
	expect(button.className).toContain('focus-visible:ring-2');
});

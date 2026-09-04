// @vitest-environment happy-dom

import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { SessionTabs } from '../../src/renderer/components/workbench-shell/conversation-panel/session-tabs';
import type { SessionTabModel } from '../../src/renderer/types/workbench';
import type { SessionTabPlacement } from '../../src/renderer/types/workbench-shell';
import {
	clearEnsemblrApi,
	installEnsemblrApi,
	installLocalStorage,
	renderWithProviders,
} from './support/dom';

/** Builds a chat strip tab whose label doubles as its id. */
function createTab(id: string): SessionTabModel {
	return {
		chatTabId: id,
		fullLabel: id,
		id,
		isPreview: false,
		isSubAgent: false,
		kind: 'chat',
		label: id,
		agentSessionId: null,
		status: 'idle',
		summary: '',
		updatedLabel: '',
	};
}

const INITIAL_IDS = ['a', 'b', 'c'];
const IDS_AFTER_INSERT = ['a', 'inserted', 'b', 'c'];

/**
 * Drives the strip through a tab list change the way the workspace does, so the
 * assertion covers the reconcile that runs when new ids arrive as props.
 */
function StripHarness({ onSwap }: { onSwap: (swap: () => void) => void }) {
	const [ids, setIds] = useState(INITIAL_IDS);
	useEffect(() => {
		onSwap(() => {
			setIds(IDS_AFTER_INSERT);
		});
	}, [onSwap]);
	const sessions = ids.map(createTab);
	return (
		<SessionTabs
			activeSession={sessions[0]}
			closedSessions={[]}
			onLaunchHarness={() => Promise.resolve(null)}
			onOpenArchitectureDiagram={async () => null}
			onSessionTabChange={() => undefined}
			onSessionTabClose={() => undefined}
			onSessionTabOpen={() => Promise.resolve(null)}
			onSessionTabPin={() => undefined}
			onSessionTabRestore={() => undefined}
			onSessionTabsReorder={() => undefined}
			sessions={sessions}
			unreadKeys={new Set()}
		/>
	);
}

/** Reads the strip's rendered left-to-right tab order. */
function readStripOrder(container: HTMLElement): (string | null)[] {
	return [...container.querySelectorAll('[data-tab-key]')].map((element) =>
		element.getAttribute('data-tab-key'),
	);
}

beforeEach(() => {
	installLocalStorage();
	installEnsemblrApi({
		listAgentHarnesses: () => Promise.resolve({ harnesses: [] }),
	});
});

afterEach(() => {
	clearEnsemblrApi();
});

test('asks for append placement from the strip new-tab button', async () => {
	const placements: (SessionTabPlacement | undefined)[] = [];
	const sessions = INITIAL_IDS.map(createTab);
	const { getByRole } = renderWithProviders(
		<SessionTabs
			activeSession={sessions[0]}
			closedSessions={[]}
			onLaunchHarness={() => Promise.resolve(null)}
			onOpenArchitectureDiagram={async () => null}
			onSessionTabChange={() => undefined}
			onSessionTabClose={() => undefined}
			onSessionTabOpen={(options) => {
				placements.push(options?.placement);
				return Promise.resolve(null);
			}}
			onSessionTabPin={() => undefined}
			onSessionTabRestore={() => undefined}
			onSessionTabsReorder={() => undefined}
			sessions={sessions}
			unreadKeys={new Set()}
		/>,
	);

	await userEvent.click(getByRole('button', { name: 'New chat tab' }));

	expect(placements).toEqual(['append']);
});

test('renders a tab inserted mid-strip in its persisted slot', () => {
	let swap: () => void = () => undefined;
	const { container } = renderWithProviders(
		<StripHarness
			onSwap={(next) => {
				swap = next;
			}}
		/>,
	);

	expect(readStripOrder(container)).toEqual(INITIAL_IDS);

	act(() => swap());

	expect(readStripOrder(container)).toEqual(IDS_AFTER_INSERT);
});

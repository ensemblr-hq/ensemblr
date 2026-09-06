// @vitest-environment happy-dom

import { waitFor } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { appSettingsAtom } from '@/renderer/state/preferences';
import { useTerminalTabAutoResume } from '@/renderer/state/workspace/terminal-tab-resume';
import type { SessionTabModel } from '@/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from '../support/dom';

const store = getDefaultStore();

/** Writes the Experimental harness switch into the shared settings mirror. */
function setHarnessesEnabled(enabled: boolean) {
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		experimental: {
			...DEFAULT_APP_SETTINGS.experimental,
			tuiHarnesses: enabled,
		},
	});
}

/** A live harness tab whose PTY the previous app process owned and killed. */
const DEAD_HARNESS_TAB = {
	closedAt: null,
	harnessId: 'claude',
	harnessLabel: 'Claude Code',
	harnessSessionId: 'sess-1',
	id: 'tab-1',
	kind: 'terminal',
	terminalId: 'term-1',
	title: 'Claude Code',
} as unknown as SessionTabModel;

/** Mounts the auto-resume hook over one dead harness tab and returns its spies. */
function renderAutoResume() {
	const closeSessionTabAsync = vi.fn(async () => undefined);
	const resumeAgentHarness = vi.fn(() =>
		Promise.resolve({ diagnostics: [], session: { id: 'term-2' } }),
	);
	installEnsemblrApi({
		resumeAgentHarness,
		terminalSnapshot: () => Promise.resolve({ session: null }),
	});

	/** Host component, so the hook runs under the providers the app gives it. */
	function Host() {
		useTerminalTabAutoResume({
			closeSessionTabAsync,
			invalidateChatTabs: () => undefined,
			sessionTabs: [DEAD_HARNESS_TAB],
			workspaceId: 'ws-1',
		});
		return null;
	}

	renderWithProviders(<Host />);
	return { closeSessionTabAsync, resumeAgentHarness };
}

beforeEach(() => {
	setHarnessesEnabled(false);
});

afterEach(() => {
	clearEnsemblrApi();
	setHarnessesEnabled(false);
});

// The switch can be flipped while tabs from an earlier session sit on disk, so a
// restart that quietly relaunched Claude Code would undo the user's choice.
test('archives a dead harness tab instead of respawning it while the switch is off', async () => {
	const { closeSessionTabAsync, resumeAgentHarness } = renderAutoResume();

	await waitFor(() =>
		expect(closeSessionTabAsync).toHaveBeenCalledWith('tab-1'),
	);
	expect(resumeAgentHarness).not.toHaveBeenCalled();
});

test('respawns a dead harness tab while the switch is on', async () => {
	setHarnessesEnabled(true);
	const { closeSessionTabAsync, resumeAgentHarness } = renderAutoResume();

	await waitFor(() => expect(resumeAgentHarness).toHaveBeenCalled());
	expect(closeSessionTabAsync).not.toHaveBeenCalled();
});

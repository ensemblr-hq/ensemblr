// @vitest-environment happy-dom

import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { HarnessLauncherMenu } from '@/renderer/components/workbench-shell/conversation-panel/harness-launcher/harness-launcher-menu';
import { appSettingsAtom } from '@/renderer/state/preferences';
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

/** Renders the launcher with a stub bridge, returning the harness-list spy. */
function renderLauncher() {
	const listAgentHarnesses = vi.fn(() =>
		Promise.resolve({
			harnesses: [
				{ available: true, id: 'claude', label: 'Claude Code', version: null },
			],
		}),
	);
	installEnsemblrApi({ listAgentHarnesses });
	const rendered = renderWithProviders(
		<HarnessLauncherMenu
			onLaunchHarness={() => Promise.resolve(null)}
			onSessionTabChange={() => undefined}
		/>,
	);
	return { listAgentHarnesses, ...rendered };
}

beforeEach(() => {
	setHarnessesEnabled(false);
});

afterEach(() => {
	clearEnsemblrApi();
	setHarnessesEnabled(false);
});

test('renders nothing while the Experimental switch is off', () => {
	const { container } = renderLauncher();

	expect(container).toBeEmptyDOMElement();
});

// The probe shells out to PATH detection in main, so an unmounted launcher must
// not reach it — a disabled-but-mounted button would still pay for the lookup.
test('never probes for installed harnesses while the switch is off', () => {
	const { listAgentHarnesses } = renderLauncher();

	expect(listAgentHarnesses).not.toHaveBeenCalled();
});

test('renders the launcher once the switch is on', async () => {
	setHarnessesEnabled(true);
	const { findByText, listAgentHarnesses } = renderLauncher();

	expect(await findByText('Launch coding agent')).toBeInTheDocument();
	expect(listAgentHarnesses).toHaveBeenCalled();
});

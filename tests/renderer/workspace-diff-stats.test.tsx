// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { describe, expect, test } from 'vitest';

import { WorkspaceDiffStats } from '../../src/renderer/components/workbench-shell/workspace-sidebar-item/diff-stats';
import { appSettingsAtom } from '../../src/renderer/state/preferences';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/config/app-settings';

const workspace = {
	changeSummary: { additions: 3, deletions: 2 },
} as unknown as WorkspaceShellModel;

/** Renders the stats with the given colored-diffs pref and active state. */
function renderStats(opts: {
	coloredSidebarDiffs: boolean;
	isActive: boolean;
}) {
	const store = createStore();
	store.set(appSettingsAtom, {
		...DEFAULT_APP_SETTINGS,
		appearance: {
			...DEFAULT_APP_SETTINGS.appearance,
			coloredSidebarDiffs: opts.coloredSidebarDiffs,
		},
	});
	return render(
		<Provider store={store}>
			<WorkspaceDiffStats isActive={opts.isActive} workspace={workspace} />
		</Provider>,
	);
}

describe('WorkspaceDiffStats', () => {
	test('mutes counts on an inactive row when colored diffs are off', () => {
		renderStats({ coloredSidebarDiffs: false, isActive: false });
		expect(screen.getByText('+3')).toHaveClass('text-muted-foreground');
		expect(screen.getByText('-2')).toHaveClass('text-muted-foreground');
	});

	test('colors counts on the active row', () => {
		renderStats({ coloredSidebarDiffs: false, isActive: true });
		expect(screen.getByText('+3')).toHaveClass('text-status-ok');
		expect(screen.getByText('-2')).toHaveClass('text-status-danger');
	});

	test('always colors when the pref is on, even for inactive rows', () => {
		renderStats({ coloredSidebarDiffs: true, isActive: false });
		expect(screen.getByText('+3')).toHaveClass('text-status-ok');
		expect(screen.getByText('-2')).toHaveClass('text-status-danger');
	});
});

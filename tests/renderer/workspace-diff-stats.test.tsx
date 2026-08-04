// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { WorkspaceDiffStats } from '../../src/renderer/components/workbench-shell/workspace-sidebar-item/diff-stats';
import type { WorkspaceShellModel } from '../../src/renderer/types/workbench';

const workspace = {
	changeSummary: { additions: 3, deletions: 2 },
} as unknown as WorkspaceShellModel;

/** Renders the workspace diff stats fixture. */
function renderStats() {
	return render(<WorkspaceDiffStats workspace={workspace} />);
}

describe('WorkspaceDiffStats', () => {
	test('hues additions and deletions from the shared diff tokens', () => {
		renderStats();
		expect(screen.getByText('+3').className).toContain(
			'text-diff-addition-foreground',
		);
		expect(screen.getByText('-2').className).toContain(
			'text-diff-deletion-foreground',
		);
	});
});

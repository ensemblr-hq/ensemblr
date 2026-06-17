import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TooltipProvider } from '../../src/renderer/components/ui/tooltip';
import {
	type ReviewFileActions,
	ReviewFileActionsProvider,
} from '../../src/renderer/components/workbench-shell/review-files/review-file-actions-context';
import { ReviewFileEmptyState } from '../../src/renderer/components/workbench-shell/review-files/review-file-empty-state';
import { ReviewFileRow } from '../../src/renderer/components/workbench-shell/review-files/review-file-row';
import type {
	ReviewFileSummary,
	WorkspaceOpenTarget,
} from '../../src/renderer/types/workbench';

const launchTarget: WorkspaceOpenTarget = {
	behavior: 'launch-app',
	iconName: 'lucide:file-code',
	id: 'vscode',
	installed: true,
	kind: 'app',
	label: 'VS Code',
	numberShortcutLabel: '1',
};

const copyTarget: WorkspaceOpenTarget = {
	behavior: 'copy-path',
	iconName: 'lucide:copy',
	id: 'copy-path',
	installed: true,
	kind: 'utility',
	label: 'Copy path',
	numberShortcutLabel: '',
};

function makeActions(
	overrides: Partial<ReviewFileActions> = {},
): ReviewFileActions {
	return {
		copyTarget: undefined,
		invokeTarget: async () => {},
		isDiscardable: () => true,
		onDiscardFile: () => {},
		openDiff: () => {},
		openInTargets: [],
		...overrides,
	};
}

function renderRow(
	file: ReviewFileSummary,
	props: { ariaLevel?: number; level?: number; showPath: boolean },
	actions: ReviewFileActions = makeActions(),
) {
	return renderToStaticMarkup(
		<TooltipProvider>
			<ReviewFileActionsProvider value={actions}>
				<ReviewFileRow file={file} {...props} />
			</ReviewFileActionsProvider>
		</TooltipProvider>,
	);
}

const modifiedFile: ReviewFileSummary = {
	additions: 10,
	deletions: 3,
	id: 'f1',
	path: 'src/main/ipc/handlers/workspace-files.ts',
	status: 'modified',
};

test('list mode renders the full path with a dimmed directory prefix in mono', () => {
	const markup = renderRow(modifiedFile, { showPath: true });

	// Directory prefix rendered as a dimmed span, basename plain.
	expect(markup).toContain('>src/main/ipc/handlers/</span>');
	expect(markup).toContain('workspace-files.ts');
	// Mono font requested to match the All files tab.
	expect(markup).toContain('font-mono');
	// Whole row is addressable for the shared right-click menu.
	expect(markup).toContain(
		'data-row-path="src/main/ipc/handlers/workspace-files.ts"',
	);
	expect(markup).toContain('data-row-kind="file"');
});

test('a modified file shows +/- counts and no status letter', () => {
	const markup = renderRow(modifiedFile, { showPath: true });

	expect(markup).toContain('+10');
	expect(markup).toContain('-3');
	// Modified is the implicit default — no leading A/D/M/R/U badge.
	expect(markup).not.toContain('>M<');
});

test('an untracked file surfaces its status letter', () => {
	const markup = renderRow(
		{
			additions: 4,
			deletions: 0,
			id: 'f2',
			path: 'notes.md',
			status: 'untracked',
		},
		{ showPath: true },
	);

	expect(markup).toContain('>U<');
	expect(markup).toContain('+4');
	// Zero deletions are omitted (no "-0" diff span).
	expect(markup).not.toContain('text-status-danger');
});

test('each row shows a Conductor-style status square for its git state', () => {
	expect(renderRow(modifiedFile, { showPath: true })).toContain(
		'aria-label="Modified"',
	);
	expect(
		renderRow(
			{
				additions: 4,
				deletions: 0,
				id: 'n',
				path: 'new.ts',
				status: 'untracked',
			},
			{ showPath: true },
		),
	).toContain('aria-label="Untracked"');
	expect(
		renderRow(
			{
				additions: 0,
				deletions: 9,
				id: 'd',
				path: 'gone.ts',
				status: 'deleted',
			},
			{ showPath: true },
		),
	).toContain('aria-label="Deleted"');
});

test('tree mode renders only the basename and tree semantics', () => {
	const markup = renderRow(modifiedFile, {
		ariaLevel: 3,
		level: 2,
		showPath: false,
	});

	expect(markup).toContain('workspace-files.ts');
	// In tree mode the directory chain is conveyed by folder rows, not the file —
	// no dimmed directory prefix span in the label.
	expect(markup).not.toContain('>src/main/ipc/handlers/</span>');
	expect(markup).toContain('role="treeitem"');
	expect(markup).toContain('aria-level="3"');
});

test('every row exposes a Discard affordance regardless of open targets', () => {
	const markup = renderRow(modifiedFile, { showPath: true });

	expect(markup).toContain(
		'Discard changes to src/main/ipc/handlers/workspace-files.ts',
	);
});

test('a non-discardable file (commit/branch view) hides the Discard affordance', () => {
	const markup = renderRow(
		modifiedFile,
		{ showPath: true },
		makeActions({ isDiscardable: () => false }),
	);

	expect(markup).not.toContain(
		'Discard changes to src/main/ipc/handlers/workspace-files.ts',
	);
});

test('the open-in chevron only appears when targets are available', () => {
	const without = renderRow(modifiedFile, { showPath: true });
	expect(without).not.toContain('in…');

	const withTargets = renderRow(
		modifiedFile,
		{ showPath: true },
		makeActions({ copyTarget, openInTargets: [launchTarget] }),
	);
	expect(withTargets).toContain(
		'Open src/main/ipc/handlers/workspace-files.ts in…',
	);
});

test('empty state explains that changes will appear here', () => {
	const markup = renderToStaticMarkup(<ReviewFileEmptyState />);

	expect(markup).toContain('No file changes yet');
	expect(markup).toContain('Changes appear here.');
	expect(markup).toContain('<svg');
});

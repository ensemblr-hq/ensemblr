// @vitest-environment happy-dom

import { fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { OpenTargetSplitButton } from '../../src/renderer/components/workbench-shell/open-target-split-button';
import type { WorkspaceOpenTarget } from '../../src/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const PRIMARY: WorkspaceOpenTarget = {
	behavior: 'launch-app',
	iconName: 'vscode-icons:file-type-vscode',
	id: 'vscode',
	installed: true,
	isPrimary: true,
	kind: 'editor',
	label: 'VS Code',
	numberShortcutLabel: '1',
	shortcutLabel: '⌘O',
};

const COPY: WorkspaceOpenTarget = {
	behavior: 'copy-path',
	iconName: 'lucide:copy',
	id: 'copy-path',
	installed: true,
	kind: 'utility',
	label: 'Copy path',
	numberShortcutLabel: '2',
	shortcutLabel: '⌘⇧C',
};

test('labelled split button invokes the primary target and shows its label', () => {
	const onInvoke = vi.fn();
	const { getByRole, queryByText } = renderWithProviders(
		<OpenTargetSplitButton
			menuAriaLabel='Edit in config.json — choose an app'
			onInvoke={onInvoke}
			openTargets={[PRIMARY, COPY]}
			primaryAriaLabel='Edit in config.json in VS Code'
			primaryLabel='Edit in config.json'
			primaryTarget={PRIMARY}
		/>,
	);

	expect(queryByText('Edit in config.json')).not.toBeNull();

	fireEvent.click(
		getByRole('button', { name: 'Edit in config.json in VS Code' }),
	);
	expect(onInvoke).toHaveBeenCalledWith(PRIMARY);
});

test('selecting a non-primary menu target invokes it and requests close', () => {
	const onInvoke = vi.fn();
	const onOpenChange = vi.fn();
	const { getByRole } = renderWithProviders(
		<OpenTargetSplitButton
			menuAriaLabel='Edit in config.json — choose an app'
			onInvoke={onInvoke}
			onOpenChange={onOpenChange}
			open
			openTargets={[PRIMARY, COPY]}
			primaryAriaLabel='Edit in config.json in VS Code'
			primaryLabel='Edit in config.json'
			primaryTarget={PRIMARY}
		/>,
	);

	fireEvent.click(getByRole('menuitem', { name: /Copy path/ }));

	expect(onInvoke).toHaveBeenCalledWith(COPY);
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('icon-only split button keeps a dedicated chevron trigger', () => {
	const onInvoke = vi.fn();
	const { getByRole } = renderWithProviders(
		<OpenTargetSplitButton
			menuAriaLabel='Open current workspace app options'
			onInvoke={onInvoke}
			openTargets={[PRIMARY]}
			primaryAriaLabel='Open current workspace in VS Code'
			primaryTarget={PRIMARY}
		/>,
	);

	expect(
		getByRole('button', { name: 'Open current workspace app options' }),
	).not.toBeNull();
	fireEvent.click(
		getByRole('button', { name: 'Open current workspace in VS Code' }),
	);
	expect(onInvoke).toHaveBeenCalledWith(PRIMARY);
});

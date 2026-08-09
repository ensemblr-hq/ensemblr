// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { SetupCheckRow } from '@/renderer/components/setup-diagnostics/setup-check-row';
import type {
	SetupCheckSnapshot,
	SetupRemediationAction,
} from '@/shared/ipc/contracts/setup';

import { renderWithProviders } from '../support/dom';

/**
 * Builds a check snapshot; the caller overrides only the fields under test.
 * @param overrides - Fields to replace on the baseline snapshot.
 * @returns The snapshot to render.
 */
function makeCheck(
	overrides: Partial<SetupCheckSnapshot> = {},
): SetupCheckSnapshot {
	return {
		blocking: true,
		description: 'Detects a runnable git executable.',
		detail: 'Git is available: git 2.44.0.',
		group: 'github',
		id: 'git-executable',
		logs: [],
		remediationActions: [],
		status: 'success',
		title: 'Git executable',
		updatedAt: '2026-08-09T00:00:00.000Z',
		...overrides,
	};
}

/** Installs a clipboard stub and returns the spy the test asserts on. */
function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});

	return writeText;
}

describe('SetupCheckRow', () => {
	test('renders the title and detail from the catalogue, not the English wire text', () => {
		renderWithProviders(
			<SetupCheckRow
				check={makeCheck({
					detail: 'EN SOURCE ONLY',
					detailMessage: {
						code: 'git-available',
						params: { version: 'git 2.44.0' },
					},
				})}
			/>,
		);

		expect(screen.getByText('Git executable')).toBeInTheDocument();
		expect(
			screen.getByText('Git is available: git 2.44.0.'),
		).toBeInTheDocument();
		expect(screen.queryByText('EN SOURCE ONLY')).not.toBeInTheDocument();
	});

	test('passes an upstream detail through when the check authored no code', () => {
		renderWithProviders(
			<SetupCheckRow check={makeCheck({ detail: 'spawn ENOENT' })} />,
		);

		expect(screen.getByText('spawn ENOENT')).toBeInTheDocument();
	});

	test('marks a non-blocking check optional', () => {
		renderWithProviders(
			<SetupCheckRow check={makeCheck({ blocking: false })} />,
		);

		expect(screen.getByText('Optional')).toBeInTheDocument();
	});

	test('a run-command action copies to the clipboard instead of calling the handler', async () => {
		const writeText = stubClipboard();
		const onRemediationAction = vi.fn();
		const action: SetupRemediationAction = {
			command: 'gh auth login',
			id: 'run-gh-auth-login',
			kind: 'run-command',
			label: 'EN',
		};

		renderWithProviders(
			<SetupCheckRow
				check={makeCheck({ remediationActions: [action], status: 'failure' })}
				onRemediationAction={onRemediationAction}
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Run gh auth login/ }),
		);

		expect(writeText).toHaveBeenCalledWith('gh auth login');
		expect(onRemediationAction).not.toHaveBeenCalled();
		expect(await screen.findByText('Copied')).toBeInTheDocument();
	});

	test('a run-command action with no command does nothing', async () => {
		const writeText = stubClipboard();
		const onRemediationAction = vi.fn();

		renderWithProviders(
			<SetupCheckRow
				check={makeCheck({
					remediationActions: [
						{ id: 'run-gh-auth-login', kind: 'run-command', label: 'EN' },
					],
					status: 'failure',
				})}
				onRemediationAction={onRemediationAction}
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Run gh auth login/ }),
		);

		expect(writeText).not.toHaveBeenCalled();
		expect(onRemediationAction).not.toHaveBeenCalled();
	});

	test('a failed clipboard write leaves the button unflashed', async () => {
		const writeText = stubClipboard(
			vi.fn().mockRejectedValue(new Error('denied')),
		);
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		renderWithProviders(
			<SetupCheckRow
				check={makeCheck({
					remediationActions: [
						{
							command: 'gh auth login',
							id: 'run-gh-auth-login',
							kind: 'run-command',
							label: 'EN',
						},
					],
					status: 'failure',
				})}
			/>,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Run gh auth login/ }),
		);

		expect(writeText).toHaveBeenCalled();
		expect(screen.queryByText('Copied')).not.toBeInTheDocument();
		consoleError.mockRestore();
	});

	test('a non-command action delegates to the handler with its check', async () => {
		const onRemediationAction = vi.fn();
		const action: SetupRemediationAction = {
			id: 'retry-git-executable',
			kind: 'retry',
			label: 'EN',
		};
		const check = makeCheck({
			remediationActions: [action],
			status: 'failure',
		});

		renderWithProviders(
			<SetupCheckRow check={check} onRemediationAction={onRemediationAction} />,
		);

		await userEvent.click(
			screen.getByRole('button', { name: /Retry git check/ }),
		);

		expect(onRemediationAction).toHaveBeenCalledWith(action, check);
	});

	test('an uncatalogued retry id falls back to the generic label', async () => {
		const onRemediationAction = vi.fn();

		renderWithProviders(
			<SetupCheckRow
				check={makeCheck({
					remediationActions: [
						{ id: 'retry-brand-new', kind: 'retry', label: 'EN' },
					],
					status: 'failure',
				})}
				onRemediationAction={onRemediationAction}
			/>,
		);

		await userEvent.click(screen.getByRole('button', { name: 'Retry check' }));

		expect(onRemediationAction).toHaveBeenCalled();
	});
});

// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { SecretPromptBar } from '../../src/renderer/components/workbench-shell/dock-panel/secret-prompt-bar';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

afterEach(() => {
	clearEnsemblrApi();
});

/** Renders the bar over a stub bridge whose terminal write the test controls. */
function renderBar(
	writeTerminalSession = vi.fn().mockResolvedValue(undefined),
) {
	installEnsemblrApi({ writeTerminalSession });
	renderWithProviders(
		<SecretPromptBar
			prompt='[sudo] password for philipp:'
			terminalId='setup-1'
		/>,
	);
	return { writeTerminalSession };
}

test('shows the prompt the script printed beside a masked field', () => {
	renderBar();

	expect(screen.getByText('[sudo] password for philipp:')).toBeInTheDocument();
	expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
});

// A chat draft typed into a field that grabbed focus on its own would be handed
// to `sudo` as a password, so the field waits to be clicked.
test('never takes focus on its own', () => {
	renderBar();

	expect(screen.getByLabelText('Password')).not.toHaveFocus();
});

test('sends the password with Enter to the script and clears the field', async () => {
	const user = userEvent.setup();
	const { writeTerminalSession } = renderBar();
	const field = screen.getByLabelText('Password');

	await user.type(field, 'hunter2{Enter}');

	expect(writeTerminalSession).toHaveBeenCalledTimes(1);
	expect(writeTerminalSession).toHaveBeenCalledWith({
		data: 'hunter2\r',
		terminalId: 'setup-1',
	});
	expect(field).toHaveValue('');
});

test('says so when the password could not reach the script', async () => {
	const user = userEvent.setup();
	renderBar(vi.fn().mockRejectedValue(new Error('gone')));

	await user.type(screen.getByLabelText('Password'), 'hunter2');
	await user.click(screen.getByRole('button', { name: 'Send' }));

	expect(await screen.findByRole('alert')).toHaveTextContent(
		'Could not reach the script. Try again.',
	);
	expect(screen.getByLabelText('Password')).toHaveValue('');
});

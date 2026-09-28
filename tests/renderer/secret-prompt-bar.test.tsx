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

/** Renders the bar over a stub bridge whose prompt answer the test controls. */
function renderBar(
	answerTerminalSecretPrompt = vi.fn().mockResolvedValue({ answered: true }),
) {
	installEnsemblrApi({ answerTerminalSecretPrompt });
	renderWithProviders(
		<SecretPromptBar
			prompt='[sudo] password for philipp:'
			terminalId='setup-1'
		/>,
	);
	return { answerTerminalSecretPrompt };
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

test('answers the prompt with the typed password and clears the field', async () => {
	const user = userEvent.setup();
	const { answerTerminalSecretPrompt } = renderBar();
	const field = screen.getByLabelText('Password');

	await user.type(field, 'hunter2{Enter}');

	expect(answerTerminalSecretPrompt).toHaveBeenCalledTimes(1);
	expect(answerTerminalSecretPrompt).toHaveBeenCalledWith({
		answer: 'hunter2',
		terminalId: 'setup-1',
	});
	expect(field).toHaveValue('');
	expect(screen.queryByRole('alert')).toBeNull();
});

// sudo counts a bare Enter as a wrong password, and a quick second Enter lands
// on a field the first one already emptied.
test('sends nothing while the field is empty', async () => {
	const user = userEvent.setup();
	const { answerTerminalSecretPrompt } = renderBar();

	await user.type(screen.getByLabelText('Password'), 'hunter2{Enter}{Enter}');

	expect(answerTerminalSecretPrompt).toHaveBeenCalledTimes(1);
	expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
});

test('says so when the script was no longer waiting for the answer', async () => {
	const user = userEvent.setup();
	renderBar(vi.fn().mockResolvedValue({ answered: false }));

	await user.type(screen.getByLabelText('Password'), 'hunter2{Enter}');

	expect(await screen.findByRole('alert')).toHaveTextContent(
		'Could not reach the script. Try again.',
	);
	expect(screen.getByLabelText('Password')).toHaveValue('');
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

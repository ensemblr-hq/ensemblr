// @vitest-environment happy-dom

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';

import { OnboardingLanguagePicker } from '../../src/renderer/components/onboarding/onboarding-language-picker';
import { LANGUAGE_ENDONYMS } from '../../src/shared/i18n';
import { renderWithProviders } from './support/dom';

/**
 * Renders the picker and returns its trigger, whose `aria-expanded` is what
 * "open" means here — the popover portals its content and unmounts it closed.
 * @returns The trigger button.
 */
function renderPicker(): HTMLElement {
	renderWithProviders(<OnboardingLanguagePicker />);
	return screen.getByRole('button', { name: /change interface language/i });
}

test('rests closed, naming the language on screen', () => {
	const trigger = renderPicker();

	expect(trigger).toHaveAttribute('aria-expanded', 'false');
	expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});

test('the trigger’s accessible name carries the endonym a user can see', () => {
	const trigger = renderPicker();

	expect(trigger).toHaveAccessibleName(
		expect.stringContaining(LANGUAGE_ENDONYMS.en),
	);
});

test('expanding offers every language by its own name', async () => {
	const trigger = renderPicker();

	fireEvent.click(trigger);

	const options = await screen.findByRole('navigation');
	expect(trigger).toHaveAttribute('aria-expanded', 'true');
	for (const endonym of Object.values(LANGUAGE_ENDONYMS)) {
		expect(options).toHaveTextContent(endonym);
	}
});

test('picking a language closes the row and the trigger names the new one', async () => {
	const trigger = renderPicker();
	fireEvent.click(trigger);
	await screen.findByRole('navigation');

	fireEvent.click(screen.getByRole('button', { name: LANGUAGE_ENDONYMS.ru }));

	await waitFor(() => {
		expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
	});
	expect(trigger).toHaveTextContent(LANGUAGE_ENDONYMS.ru);
});

test('Escape dismisses the row and hands focus back to the trigger', async () => {
	const trigger = renderPicker();
	fireEvent.click(trigger);
	const options = await screen.findByRole('navigation');

	fireEvent.keyDown(options, { code: 'Escape', key: 'Escape' });

	await waitFor(() => {
		expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
	});
	expect(trigger).toHaveFocus();
});

test('picking a language hands focus back to the trigger', async () => {
	const trigger = renderPicker();
	fireEvent.click(trigger);
	await screen.findByRole('navigation');

	fireEvent.click(screen.getByRole('button', { name: LANGUAGE_ENDONYMS.el }));

	await waitFor(() => {
		expect(trigger).toHaveFocus();
	});
});

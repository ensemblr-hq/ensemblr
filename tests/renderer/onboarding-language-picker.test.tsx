// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { OnboardingLanguagePicker } from '../../src/renderer/components/onboarding/onboarding-language-picker';
import { LANGUAGE_ENDONYMS } from '../../src/shared/i18n';
import { renderWithProviders } from './support/dom';

/**
 * Renders the picker and returns its collapsible root, whose `data-state` is
 * what "open" means here — Radix keeps closed content mounted and hidden.
 * @returns The collapsible root element.
 */
function renderPicker(): HTMLElement {
	const { container } = renderWithProviders(<OnboardingLanguagePicker />);
	return container.querySelector('[data-slot="collapsible"]') as HTMLElement;
}

test('rests closed, naming the language on screen', () => {
	const collapsible = renderPicker();

	expect(collapsible).toHaveAttribute('data-state', 'closed');
	expect(
		screen.getByRole('button', { name: /interface language/i }),
	).toHaveTextContent(LANGUAGE_ENDONYMS.en);
});

test('expanding offers every language by its own name', () => {
	const collapsible = renderPicker();

	fireEvent.click(screen.getByRole('button', { name: /interface language/i }));

	expect(collapsible).toHaveAttribute('data-state', 'open');
	for (const endonym of Object.values(LANGUAGE_ENDONYMS)) {
		expect(screen.getByRole('navigation')).toHaveTextContent(endonym);
	}
});

test('picking a language closes the row and the trigger names the new one', () => {
	const collapsible = renderPicker();
	const trigger = screen.getByRole('button', { name: /interface language/i });
	fireEvent.click(trigger);

	fireEvent.click(screen.getByRole('button', { name: LANGUAGE_ENDONYMS.ru }));

	expect(collapsible).toHaveAttribute('data-state', 'closed');
	expect(trigger).toHaveTextContent(LANGUAGE_ENDONYMS.ru);
});

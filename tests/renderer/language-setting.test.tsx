// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import { useAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { i18n } from '@/renderer/lib/i18n';
import { languageAtom } from '@/renderer/state/preferences';
import { APP_LANGUAGES, LANGUAGE_ENDONYMS } from '@/shared/i18n';

import {
	clearEnsemblrApi,
	installEnsemblrApi,
	renderWithProviders,
} from './support/dom';

const updateAppSettings = vi.fn(async () => undefined);

/** Minimal harness exercising the language setting's read and write paths. */
function LanguagePicker() {
	const [language, setLanguage] = useAtom(languageAtom);
	return (
		<div>
			<span data-testid='current'>{language}</span>
			{APP_LANGUAGES.map((code) => (
				<button key={code} onClick={() => setLanguage(code)} type='button'>
					{LANGUAGE_ENDONYMS[code]}
				</button>
			))}
		</div>
	);
}

beforeEach(() => {
	updateAppSettings.mockClear();
	installEnsemblrApi({ getAppSettings: vi.fn(), updateAppSettings });
});

afterEach(() => {
	clearEnsemblrApi();
});

describe('language setting', () => {
	test('defaults to following the system language', () => {
		renderWithProviders(<LanguagePicker />);
		expect(screen.getByTestId('current')).toHaveTextContent('system');
	});

	test('picking a language persists a general.language patch', () => {
		renderWithProviders(<LanguagePicker />);
		fireEvent.click(screen.getByText('Русский'));

		expect(updateAppSettings).toHaveBeenCalledWith({
			general: { language: 'ru' },
		});
		expect(screen.getByTestId('current')).toHaveTextContent('ru');
	});

	// An endonym reads identically in every UI language — that is the point of
	// using one, and why these are a const table rather than catalogue keys.
	test('endonyms render untranslated whatever the active language', async () => {
		renderWithProviders(<LanguagePicker />);
		expect(screen.getByText('Ελληνικά')).toBeInTheDocument();

		await i18n.changeLanguage('ru');
		expect(screen.getByText('English')).toBeInTheDocument();
		expect(screen.getByText('Ελληνικά')).toBeInTheDocument();
	});
});

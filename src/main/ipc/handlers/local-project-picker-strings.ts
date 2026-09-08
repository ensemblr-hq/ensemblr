import { type AppLanguage, FALLBACK_LANGUAGE } from '../../../shared/i18n.ts';

/** Localized labels for the native Open Local Project directory picker. */
const LOCAL_PROJECT_PICKER_STRINGS = {
	en: {
		buttonLabel: 'Open project',
		message: 'Select an existing local git project to open in Ensemblr.',
		title: 'Open local project',
	},
	ru: {
		buttonLabel: 'Открыть проект',
		message:
			'Выберите существующий локальный git-проект, чтобы открыть его в Ensemblr.',
		title: 'Открыть локальный проект',
	},
	el: {
		buttonLabel: 'Άνοιγμα έργου',
		message:
			'Επιλέξτε ένα υπάρχον τοπικό έργο git για να το ανοίξετε στο Ensemblr.',
		title: 'Άνοιγμα τοπικού έργου',
	},
} as const satisfies Record<AppLanguage, Record<string, string>>;

/** The complete native picker copy in one language. */
type LocalProjectPickerStrings = Record<
	keyof (typeof LOCAL_PROJECT_PICKER_STRINGS)['en'],
	string
>;

/**
 * Reads the Open Local Project picker copy for the resolved app language.
 * @param language - The app's resolved UI language.
 * @returns Localized picker copy, falling back to English.
 */
export function localProjectPickerStrings(
	language: AppLanguage,
): LocalProjectPickerStrings {
	return (
		LOCAL_PROJECT_PICKER_STRINGS[language] ??
		LOCAL_PROJECT_PICKER_STRINGS[FALLBACK_LANGUAGE]
	);
}

import assert from 'node:assert/strict';
import test from 'node:test';

import { localProjectPickerStrings } from '../../src/main/ipc/handlers/local-project-picker-strings.ts';
import { APP_LANGUAGES } from '../../src/shared/i18n.ts';

test('local-project picker strings define every label in every language', () => {
	const english = Object.keys(localProjectPickerStrings('en')).sort();
	for (const language of APP_LANGUAGES) {
		const strings = localProjectPickerStrings(language);
		assert.deepEqual(Object.keys(strings).sort(), english);
		for (const value of Object.values(strings)) {
			assert.ok(value.length > 0);
		}
	}
});

test('local-project picker strings select localized copy', () => {
	assert.equal(localProjectPickerStrings('ru').buttonLabel, 'Открыть проект');
	assert.equal(localProjectPickerStrings('el').title, 'Άνοιγμα τοπικού έργου');
	assert.match(localProjectPickerStrings('en').message, /Ensemblr/);
});

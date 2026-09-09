import { describe, expect, test } from 'vitest';

import { languageForFilePath } from '../../src/renderer/lib/language-from-path';

describe('file path language detection', () => {
	test('highlights TypeScript ES modules as TypeScript', () => {
		expect(languageForFilePath('vite.config.mts')).toBe('typescript');
	});
});

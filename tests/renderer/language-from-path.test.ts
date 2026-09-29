import { describe, expect, test } from 'vitest';

import {
	languageForFilePath,
	toBundledLanguage,
} from '../../src/renderer/lib/language-from-path';

describe('file path language detection', () => {
	test('highlights TypeScript ES modules as TypeScript', () => {
		expect(languageForFilePath('vite.config.mts')).toBe('typescript');
	});

	test('highlights Nix expressions as Nix', () => {
		expect(languageForFilePath('flake.nix')).toBe('nix');
		expect(languageForFilePath('modules/home/default.nix')).toBe('nix');
	});

	test('highlights a flake lockfile as JSON', () => {
		expect(languageForFilePath('flake.lock')).toBe('json');
		expect(languageForFilePath('nix/flake.lock')).toBe('json');
	});

	test('leaves other lockfiles as plain text', () => {
		expect(languageForFilePath('Cargo.lock')).toBe('text');
	});
});

describe('fence tag language resolution', () => {
	test('resolves a nix fence to the bundled Nix grammar', () => {
		expect(toBundledLanguage('nix')).toBe('nix');
		expect(toBundledLanguage('Nix')).toBe('nix');
	});
});

import { describe, expect, it } from 'vitest';

import { buildLanguageDirective } from '@/shared/agent-control';
import {
	APP_LANGUAGES,
	FALLBACK_LANGUAGE,
	LANGUAGE_ENDONYMS,
} from '@/shared/i18n';

describe('buildLanguageDirective', () => {
	it('renders no directive for English so the model keeps mirroring the user', () => {
		expect(buildLanguageDirective(FALLBACK_LANGUAGE)).toBeNull();
	});

	it('names the endonym of every non-English language it ships', () => {
		const translated = APP_LANGUAGES.filter(
			(language) => language !== FALLBACK_LANGUAGE,
		);
		expect(translated.length).toBeGreaterThan(0);
		for (const language of translated) {
			expect(buildLanguageDirective(language)).toContain(
				LANGUAGE_ENDONYMS[language],
			);
		}
	});

	it('exempts code, paths, and commands from translation', () => {
		const directive = buildLanguageDirective('ru') ?? '';
		for (const exemption of [
			'Code',
			'file paths',
			'shell commands',
			'commit messages',
		]) {
			expect(directive).toContain(exemption);
		}
	});

	it('names the surfaces whose text the user actually reads', () => {
		const directive = buildLanguageDirective('el') ?? '';
		for (const surface of [
			'tab title',
			'workspace summary',
			'review comments',
		]) {
			expect(directive).toContain(surface);
		}
	});

	it('stays a single appendable block with no trailing newline', () => {
		const directive = buildLanguageDirective('ru') ?? '';
		expect(directive).not.toContain('\n');
		expect(directive.trim()).toBe(directive);
	});
});

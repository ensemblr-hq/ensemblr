/**
 * The one-line instruction that puts an agent's user-facing prose into the
 * language the app renders in. The role playbooks are English and stay English:
 * this block rides alongside whichever one a caller received and names the
 * language the reader actually wants.
 *
 * It is a separate block rather than a line inside the playbooks because the
 * shipped Pi extension carries byte-identical copies of those playbooks that a
 * parity test polices, and the copies must stay flat literals — a value resolved
 * from a live setting has no literal to compare against. So the app renders the
 * finished sentence and every surface appends a string it never authors, the
 * same arrangement `session-brief.ts` uses for the per-turn upkeep block. It is
 * also why Plan Mode cannot lose it: the plan-mode playbooks replace the role
 * playbook, and this block is appended after whichever one won.
 *
 * English resolves to no directive at all rather than to "reply in English".
 * English is both the default and the fallback, so a directive there would fire
 * for every user who has never opened the language setting, and it would
 * override the model's own habit of answering in whatever language it was
 * addressed in — turning an English-defaulted app into an English-only agent for
 * a user who types Russian.
 */

import {
	type AppLanguage,
	FALLBACK_LANGUAGE,
	LANGUAGE_ENDONYMS,
} from '../i18n.ts';

/**
 * Renders the language directive for the language the app is rendering in.
 * @param language - The app's resolved UI language.
 * @returns The block to append to a playbook, or null when none is needed.
 */
export function buildLanguageDirective(language: AppLanguage): string | null {
	if (language === FALLBACK_LANGUAGE) {
		return null;
	}
	const endonym = LANGUAGE_ENDONYMS[language];
	return `LANGUAGE: the user has set this app to ${endonym}, so write every word they read in ${endonym} — your replies, the tab title you choose, the workspace summary you record, the review comments you leave, and the questions you put to them — no matter what language they type in themselves. Code, identifiers, file paths, shell commands, commit messages, branch and workspace slugs, and quoted tool output are not prose and stay exactly as they are; translating any of them breaks the thing it names.`;
}

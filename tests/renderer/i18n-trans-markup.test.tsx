// @vitest-environment happy-dom

/**
 * `<Trans>` parses the *already interpolated* string as markup, so a branch or
 * repository name carrying tags re-materialises them. react-i18next's default
 * `transKeepBasicHtmlNodesFor` is `['br', 'strong', 'i', 'p']`, which is enough
 * to put a line break and a bold run into a merge-confirmation dialog — copy
 * the app did not write, in the one surface whose whole job is to be read
 * before an irreversible action.
 *
 * No attribute survives either way, so this is markup injection rather than
 * script injection. The catalogues use named `components` keys, never bare
 * tags, so emptying the list costs nothing.
 */

import { render, screen } from '@testing-library/react';
import { Trans } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/renderer/lib/i18n';

/** A valid git ref — no spaces, no empty path component — carrying markup. */
const HOSTILE_BRANCH = '<br/><strong>Verified-by-Ensemblr</strong>';

function renderDescription(branch: string) {
	return render(
		<Trans
			components={{ mono: <span className='font-mono' data-testid='mono' /> }}
			defaults='Merges <mono>{{branch}}</mono> through <mono>{{command}}</mono>.'
			i18n={i18n}
			i18nKey='git:merge-dialog.description'
			values={{ branch, command: 'gh pr merge' }}
		/>,
	);
}

describe('Trans interpolation of untrusted names', () => {
	it('keeps no basic HTML node type', () => {
		expect(i18n.options.react?.transKeepBasicHtmlNodesFor).toEqual([]);
	});

	it('renders a branch name carrying markup as text', () => {
		const { container } = renderDescription(HOSTILE_BRANCH);

		expect(container.querySelector('br')).toBeNull();
		expect(container.querySelector('strong')).toBeNull();
		expect(container.textContent).toContain(HOSTILE_BRANCH);
	});

	// The option governs bare HTML, not a tag the call site's own `components`
	// map names. What is left of that vector is a styling span around part of
	// the name — no tag the app did not declare, no attribute, no extra copy.
	it('adds no markup beyond the call site for a value naming a components key', () => {
		const { container } = renderDescription('<mono>injected</mono>');

		expect(container.textContent).toContain('injected');
		expect(container.querySelector('br')).toBeNull();
		expect(container.querySelector('strong')).toBeNull();
		for (const element of container.querySelectorAll('*')) {
			expect(element.tagName).toBe('SPAN');
			expect(element.getAttribute('data-testid')).toBe('mono');
		}
	});

	it('still materialises the tags the call site declares', () => {
		renderDescription('feature/widget');

		expect(screen.getAllByTestId('mono')[0]?.textContent).toBe(
			'feature/widget',
		);
	});
});

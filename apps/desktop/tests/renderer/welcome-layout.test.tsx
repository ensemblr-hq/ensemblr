// @vitest-environment happy-dom

import { expect, test, vi } from 'vitest';

import { OnboardingWelcome } from '../../src/renderer/components/onboarding/onboarding-welcome';
import {
	Sidebar,
	SidebarProvider,
} from '../../src/renderer/components/ui/sidebar';
import { Welcome } from '../../src/renderer/components/welcome';
import commonEn from '../../src/renderer/lib/i18n/locales/en/common.json';
import { renderWithProviders } from './support/dom';

vi.mock('@tanstack/react-router', async () => {
	const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
		'@tanstack/react-router',
	);

	return {
		...actual,
		useNavigate: () => () => undefined,
		useRouter: () => ({}),
	};
});

const WORDMARK = '[role="img"][aria-label="Ensemblr"]';
const GITHUB_LABEL = 'Open GitHub\u00A0project';

/** Matches any fixed-height utility, at any breakpoint, but not `h-auto`. */
const FIXED_HEIGHT = /^(?:[a-z]+:)?h-\d/;

/** Finds the one element matching `selector`, failing the test if it is not unique. */
function only<T extends Element>(root: ParentNode, selector: string): T {
	const found = root.querySelectorAll<T>(selector);

	expect(found, `expected exactly one "${selector}"`).toHaveLength(1);
	return found[0];
}

/**
 * Renders the welcome screen in an expanded sidebar shell and hands back the
 * elements the layout rests on, each reached from the wordmark rather than from
 * a document-wide query, so an assertion can only ever be about its own element.
 */
function renderWelcome() {
	const { container } = renderWithProviders(
		<SidebarProvider onOpenChange={() => undefined} open={true}>
			<Sidebar collapsible='offcanvas' />
			<Welcome />
		</SidebarProvider>,
	);
	const wordmark = only<HTMLElement>(container, WORDMARK);
	const section = wordmark.closest('section');

	expect(section, 'wordmark is not inside a section').not.toBeNull();
	const cards = Array.from((section as HTMLElement).querySelectorAll('button'));

	expect(cards).toHaveLength(3);
	const labels = cards.map((card) => only<HTMLElement>(card, 'span'));

	return {
		cards,
		column: (section as HTMLElement).parentElement as HTMLElement,
		githubLabel: labels[1],
		grid: cards[0].parentElement as HTMLElement,
		labels,
		section: section as HTMLElement,
		wordmark,
	};
}

test('derives the wordmark height from its aspect ratio, not a fixed height', () => {
	const { wordmark } = renderWelcome();

	expect(wordmark.style.aspectRatio.replace(/\s+/g, '')).toBe('47/7');
	expect(wordmark.classList.contains('w-full')).toBe(true);
	expect(
		[...wordmark.classList].filter((name) => FIXED_HEIGHT.test(name)),
	).toEqual([]);
});

test('lays the welcome actions out as three fixed columns rather than a wrapping row', () => {
	const { grid } = renderWelcome();

	expect(grid.classList.contains('grid')).toBe(true);
	expect(grid.classList.contains('grid-cols-3')).toBe(true);
	expect(grid.classList.contains('w-full')).toBe(true);
	expect(grid.classList.contains('flex-wrap')).toBe(false);
});

test('caps the welcome composition and makes it the actions query container', () => {
	const { section } = renderWelcome();

	for (const name of [
		'@container/welcome-actions',
		'm-auto',
		'w-full',
		'max-w-xl',
	]) {
		expect(section.classList.contains(name), name).toBe(true);
	}
});

test('gives the action tiles no width and lets a wrapped label grow them', () => {
	const { cards } = renderWelcome();

	for (const card of cards) {
		expect(card.classList.contains('w-full')).toBe(true);
		expect(card.classList.contains('min-h-32')).toBe(true);
		expect(card.classList.contains('w-44')).toBe(false);
		expect(
			[...card.classList].filter((name) => FIXED_HEIGHT.test(name)),
		).toEqual([]);
	}
});

test('drops the label a type tier once the actions container is narrow', () => {
	const { labels } = renderWelcome();

	for (const label of labels) {
		expect(label.classList.contains('text-sm')).toBe(true);
		expect(label.classList.contains('@max-md/welcome-actions:text-xs')).toBe(
			true,
		);
	}
});

test('holds "GitHub project" together with a non-breaking space', () => {
	expect(commonEn.welcome['open-github-project']).toBe(GITHUB_LABEL);
	expect(renderWelcome().githubLabel.textContent).toBe(GITHUB_LABEL);
});

test('scrolls a short window rather than clipping the composition', () => {
	const { column } = renderWelcome();

	expect(column.classList.contains('overflow-auto')).toBe(true);
	expect(column.classList.contains('overflow-hidden')).toBe(false);
	expect(column.classList.contains('justify-center')).toBe(false);
});

test('bounds the onboarding wordmark from its wrapper so it stays fluid too', () => {
	const { container } = renderWithProviders(
		<OnboardingWelcome onStart={() => undefined} />,
	);
	const wordmark = only<HTMLElement>(container, WORDMARK);
	const wrapper = wordmark.parentElement as HTMLElement;

	expect(wrapper.classList.contains('w-full')).toBe(true);
	expect(wrapper.classList.contains('max-w-md')).toBe(true);
	expect(
		[...wordmark.classList].filter((name) => FIXED_HEIGHT.test(name)),
	).toEqual([]);
});

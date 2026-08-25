// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatUserPrompt } from '../../src/renderer/components/chat-user-prompt';
import { renderWithProviders } from './support/dom';

const BLOCK_SEPARATOR = '\n\n';

/**
 * A referenced-folders block naming one workspace folder, the shape
 * `serializeComposerDraft` writes for a directory chip.
 * @param path - Repo-relative folder path the chip stands for
 * @returns The serialized block
 */
function folderBlock(path: string): string {
	return `Referenced workspace folders:\n@${path}`;
}

/**
 * The class tokens on an element, as exact names rather than one string: a
 * substring match cannot tell `ml-1` from `ml-1.5`.
 * @param element - The element to read
 * @returns Its class names
 */
function classes(element: HTMLElement): readonly string[] {
	return [...element.classList];
}

/**
 * The host span wrapping a chip, which carries the layout the sentence flows
 * around. Located through the chip's own `title`, the full path it reveals on
 * hover.
 * @param container - The rendered prompt card
 * @param title - The chip's title attribute
 * @returns The chip's host element
 */
function chipHost(container: HTMLElement, title: string): HTMLElement {
	const host = chip(container, title).parentElement;
	if (!host) {
		throw new Error(`the chip titled ${title} has no host`);
	}
	return host;
}

/**
 * The chip itself, the box whose height decides whether two chips on
 * consecutive lines collide.
 * @param container - The rendered prompt card
 * @param title - The chip's title attribute
 * @returns The chip element
 */
function chip(container: HTMLElement, title: string): HTMLElement {
	const found = container.querySelector(`[title="${title}"]`);
	if (!(found instanceof HTMLElement)) {
		throw new Error(`no chip titled ${title}`);
	}
	return found;
}

/**
 * The strip holding the prompt's runs and chips.
 * @param container - The rendered prompt card
 * @returns The prompt body
 */
function promptBody(container: HTMLElement): HTMLElement {
	const body = container.querySelector('[data-role="user-prompt"] > div');
	if (!(body instanceof HTMLElement)) {
		throw new Error('the prompt card has no body');
	}
	return body;
}

/**
 * Renders a prompt card from blocks joined the way `serializeComposerDraft`
 * joins them.
 * @param blocks - The typed runs and serialized attachment blocks, in order
 * @returns The rendered card
 */
function renderPrompt(...blocks: readonly string[]): HTMLElement {
	return renderWithProviders(
		<ChatUserPrompt prompt={blocks.join(BLOCK_SEPARATOR)} />,
	).container;
}

describe('inline attachment chips', () => {
	test('flows the sentence and its chips through one inline context', () => {
		const container = renderPrompt(
			'Update the docs in',
			folderBlock('packages/app'),
		);

		const host = chipHost(container, 'packages/app');
		expect(host.parentElement).toBe(promptBody(container));
		expect(host.previousElementSibling?.textContent).toBe('Update the docs in');
		expect(classes(host)).toContain('inline-flex');
	});

	test('pins a chip to one line box so its neighbours keep even leading', () => {
		const container = renderPrompt(
			'Update the docs in',
			folderBlock('packages/app'),
		);

		const host = classes(chipHost(container, 'packages/app'));
		expect(host).toContain('h-[1lh]');
		expect(host).toContain('align-top');
	});

	test('shrinks a chip inside its line so stacked chips cannot collide', () => {
		const container = renderPrompt(
			'Update the docs in',
			folderBlock('packages/app'),
		);

		const className = classes(chip(container, 'packages/app'));
		expect(className).toContain('py-0');
		expect(className).toContain('leading-4');
	});

	test('spaces a chip away from the words either side of it', () => {
		const container = renderPrompt(
			'Make sure',
			folderBlock('ensemblr-dev'),
			'is updated with the new release',
		);

		const host = classes(chipHost(container, 'ensemblr-dev'));
		expect(host).toContain('ml-1');
		expect(host).toContain('mr-1');
	});

	test('closes the gap where punctuation binds back onto the chip', () => {
		const container = renderPrompt(
			'Ready to make a new beta release of',
			folderBlock('ensemblr'),
			'. So update the docs there',
		);

		const host = classes(chipHost(container, 'ensemblr'));
		expect(host).toContain('ml-1');
		expect(host).not.toContain('mr-1');
	});

	test('closes the gap where punctuation opens onto the chip', () => {
		const container = renderPrompt(
			'Look inside (',
			folderBlock('src/renderer'),
			'and report back',
		);

		const host = classes(chipHost(container, 'src/renderer'));
		expect(host).not.toContain('ml-1');
		expect(host).toContain('mr-1');
	});

	test('binds a possessive apostrophe to the chip', () => {
		const container = renderPrompt(
			'Update',
			folderBlock('ensemblr'),
			"'s docs before you cut the beta",
		);

		expect(classes(chipHost(container, 'ensemblr'))).not.toContain('mr-1');
	});

	test('leaves a chip spaced away from a quotation that follows it', () => {
		const container = renderPrompt(
			'Update',
			folderBlock('ensemblr'),
			"'the release notes' before you cut the beta",
		);

		expect(classes(chipHost(container, 'ensemblr'))).toContain('mr-1');
	});

	test('leaves a chip that opens the prompt flush with the card edge', () => {
		const container = renderPrompt(
			folderBlock('ensemblr'),
			'is updated with the new release',
		);

		const host = classes(chipHost(container, 'ensemblr'));
		expect(host).not.toContain('ml-1');
		expect(host).toContain('mr-1');
	});

	test('leaves a chip that closes the prompt flush with the card edge', () => {
		const container = renderPrompt(
			'Update the docs in',
			folderBlock('packages/app'),
		);

		const host = classes(chipHost(container, 'packages/app'));
		expect(host).toContain('ml-1');
		expect(host).not.toContain('mr-1');
	});

	test('keeps adjacent chips one gap apart rather than two', () => {
		const container = renderPrompt(
			'Referenced workspace folders:\n@src/main\n@src/renderer',
		);

		expect(classes(chipHost(container, 'src/main'))).not.toContain('mr-1');
		expect(classes(chipHost(container, 'src/renderer'))).toContain('ml-1');
	});
});

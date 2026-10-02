// @vitest-environment happy-dom

import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@iconify/react', () => ({
	addCollection: () => undefined,
	Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { ChatUserPrompt } from '../../src/renderer/components/chat-user-prompt';
import { FilePreviewOpenerProvider } from '../../src/renderer/components/workbench-shell/conversation-panel/file-preview-context';
import { renderWithProviders } from './support/dom';

const CLAMPED_HEIGHT_PX = 256;
const CLAMP_CLASS = 'max-h-64';

const PASTED_STACK_TRACE = [
	'We have merged some PR so db may be out of sync:',
	'',
	'## Error Type',
	'Runtime PrismaClientKnownRequestError',
	'',
	'  at <unknown> (src/lib/queries/agency.ts:61:17)',
	'  at getAgency (src/lib/queries/agency.ts:60:17)',
].join('\n');

const PROMPT_WITH_CHIP =
	'Referenced workspace folders:\n@src/renderer\n\nInspect it';

/**
 * happy-dom lays nothing out, so the clamp measurement needs the two heights it
 * compares. `clientHeight` follows whether the strip still carries the clamp,
 * the way a real element's does once the height cap is lifted.
 * @param contentHeight - How tall the prompt's content renders
 */
function stubClampHeights(contentHeight: number): void {
	Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
		configurable: true,
		get(this: HTMLElement) {
			return this.className.includes(CLAMP_CLASS)
				? CLAMPED_HEIGHT_PX
				: contentHeight;
		},
	});
	Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
		configurable: true,
		get: () => contentHeight,
	});
}

/**
 * Reads the strip the toggle controls, through the `aria-controls` wiring a
 * screen reader would follow.
 * @param toggle - The expand/collapse button
 * @returns The clamped strip holding the prompt's runs and chips
 */
function bodyOf(toggle: HTMLElement): HTMLElement {
	const body = document.getElementById(
		toggle.getAttribute('aria-controls') ?? '',
	);
	if (body === null) {
		throw new Error('the toggle controls no element');
	}
	return body;
}

afterEach(() => {
	Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
	Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
});

describe('user prompt clamping', () => {
	test('leaves a prompt that fits the card without an expand control', () => {
		stubClampHeights(120);
		renderWithProviders(<ChatUserPrompt prompt='Fix the failing test' />);

		expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
		expect(screen.getByText('Fix the failing test')).toBeTruthy();
	});

	test('unfolds a clipped prompt and folds it back', () => {
		stubClampHeights(900);
		renderWithProviders(<ChatUserPrompt prompt={PASTED_STACK_TRACE} />);

		const showMore = screen.getByRole('button', { name: 'Show more' });
		expect(bodyOf(showMore).className).toContain(CLAMP_CLASS);
		expect(showMore.getAttribute('aria-expanded')).toBe('false');

		fireEvent.click(showMore);

		const showLess = screen.getByRole('button', { name: 'Show less' });
		expect(showLess.getAttribute('aria-expanded')).toBe('true');
		expect(bodyOf(showLess).className).not.toContain(CLAMP_CLASS);

		fireEvent.click(showLess);

		expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
	});

	test('keeps the whole prompt in the DOM while it is clipped', () => {
		stubClampHeights(900);
		renderWithProviders(<ChatUserPrompt prompt={PASTED_STACK_TRACE} />);

		const showMore = screen.getByRole('button', { name: 'Show more' });
		expect(bodyOf(showMore).textContent).toBe(PASTED_STACK_TRACE);
	});

	test('unfolds when focus reaches an attachment chip the clamp hides', () => {
		stubClampHeights(900);
		renderWithProviders(
			<FilePreviewOpenerProvider value={() => undefined}>
				<ChatUserPrompt prompt={PROMPT_WITH_CHIP} />
			</FilePreviewOpenerProvider>,
		);

		expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();

		act(() => {
			screen.getByRole('button', { name: 'renderer' }).focus();
		});

		expect(
			screen
				.getByRole('button', { name: 'Show less' })
				.getAttribute('aria-expanded'),
		).toBe('true');
	});

	test('leaves a prompt that fits folded when a chip takes focus', () => {
		stubClampHeights(120);
		renderWithProviders(
			<FilePreviewOpenerProvider value={() => undefined}>
				<ChatUserPrompt prompt={PROMPT_WITH_CHIP} />
			</FilePreviewOpenerProvider>,
		);

		act(() => {
			screen.getByRole('button', { name: 'renderer' }).focus();
		});

		expect(screen.queryByRole('button', { name: 'Show less' })).toBeNull();
	});
});

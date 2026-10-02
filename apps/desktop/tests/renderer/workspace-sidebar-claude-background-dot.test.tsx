// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';

import { ClaudeBackgroundDot } from '../../src/renderer/components/workbench-shell/workspace-sidebar-item/claude-background-dot';
import { renderWithProviders } from './support/dom';

describe('claude background dot', () => {
	test('renders nothing at zero live tasks', () => {
		const { container } = renderWithProviders(
			<ClaudeBackgroundDot count={0} />,
		);
		expect(
			container.querySelector('[data-workspace-claude-background]'),
		).toBeNull();
	});

	test('renders the dot carrying the live-task count', () => {
		const { container } = renderWithProviders(
			<ClaudeBackgroundDot count={2} />,
		);
		const dot = container.querySelector('[data-workspace-claude-background]');
		expect(dot?.getAttribute('data-workspace-claude-background')).toBe(
			'running',
		);
		expect(dot?.getAttribute('data-workspace-claude-background-count')).toBe(
			'2',
		);
		expect(dot?.className).toContain('bg-accent-strong');
	});

	test('announces the count on screen readers, pluralized', () => {
		const { container } = renderWithProviders(
			<ClaudeBackgroundDot count={1} />,
		);
		const dot = container.querySelector('[data-workspace-claude-background]');
		expect(dot?.getAttribute('aria-hidden')).toBeNull();
		expect(dot?.querySelector('.sr-only')?.textContent).toBe(
			'1 background task running',
		);
	});

	test('pluralizes the announced count above one', () => {
		const { container } = renderWithProviders(
			<ClaudeBackgroundDot count={3} />,
		);
		const dot = container.querySelector('[data-workspace-claude-background]');
		expect(dot?.querySelector('.sr-only')?.textContent).toBe(
			'3 background tasks running',
		);
	});
});

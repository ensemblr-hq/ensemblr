// @vitest-environment happy-dom

import { render, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ChatTurnSummary } from '@/renderer/components/chat-turn-summary';
import { ToolGlyphIcon } from '@/renderer/components/tool-collapsible/glyph-icons';

describe('tool glyph rendering', () => {
	test('keeps host glyphs in a collapsed turn summary', () => {
		const { container } = render(
			<ChatTurnSummary
				durationMs={null}
				messageCount={0}
				toolGlyphs={['search']}
			>
				<div />
			</ChatTurnSummary>,
		);

		expect(container.querySelector('svg.lucide')).toBeInTheDocument();
	});

	test('loads extension glyphs by kebab-case id', async () => {
		for (const [glyph, path] of [
			['arrow-up-right', 'M7 7h10v10'],
			['audio-lines', 'M2 10v3'],
		] as const) {
			const { container } = render(<ToolGlyphIcon glyph={glyph} />);
			await waitFor(() => {
				expect(
					container.querySelector(`svg.lucide path[d="${path}"]`),
				).toBeInTheDocument();
			});
		}
	});

	test('drops a previous extension glyph while its replacement loads', async () => {
		const { container, rerender } = render(
			<ToolGlyphIcon glyph='arrow-up-right' />,
		);
		await waitFor(() => {
			expect(
				container.querySelector('svg.lucide path[d="M7 7h10v10"]'),
			).toBeInTheDocument();
		});

		rerender(<ToolGlyphIcon glyph='audio-lines' />);
		expect(
			container.querySelector('svg.lucide path[d="M7 7h10v10"]'),
		).not.toBeInTheDocument();
		await waitFor(() => {
			expect(
				container.querySelector('svg.lucide path[d="M2 10v3"]'),
			).toBeInTheDocument();
		});
	});

	test('falls back for an unknown renderer glyph', () => {
		const { container } = render(
			<ToolGlyphIcon glyph={'not-a-lucide-icon' as never} />,
		);

		expect(container.querySelector('svg.lucide')).toBeInTheDocument();
	});
});

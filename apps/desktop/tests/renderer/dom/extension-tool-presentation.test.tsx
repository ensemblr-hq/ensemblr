// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';
import { ChatToolCall } from '../../../src/renderer/components/chat-tool-call';
import type { ToolPresentationV1 } from '../../../src/shared/tool-presentation';
import { renderWithProviders } from '../support/dom';

function extensionPart(
	state: 'input-available' | 'output-available',
	presentation: ToolPresentationV1,
): DynamicToolUIPart & { toolPresentation: ToolPresentationV1 } {
	return state === 'input-available'
		? {
				input: { query: 'react' },
				state,
				toolCallId: 'call-custom',
				toolName: 'vendor_search',
				toolPresentation: presentation,
				type: 'dynamic-tool',
			}
		: {
				input: { query: 'react' },
				output: { details: null, text: 'raw output' },
				state,
				toolCallId: 'call-custom',
				toolName: 'vendor_search',
				toolPresentation: presentation,
				type: 'dynamic-tool',
			};
}

describe('extension-owned tool presentation DOM', () => {
	test('keeps a running supplied body expandable and names raw execution', () => {
		renderWithProviders(
			<ChatToolCall
				part={extensionPart('input-available', {
					body: { kind: 'markdown', text: 'Progress **now**.' },
					title: 'Friendly search',
					version: 1,
				})}
			/>,
		);

		const row = screen.getByRole('button', { name: 'Friendly search' });
		expect(row).not.toBeDisabled();
		expect(row).toHaveAttribute('aria-expanded', 'false');
		fireEvent.click(row);

		expect(
			screen.getByText(
				(_content, element) =>
					element?.tagName === 'P' && element.textContent === 'Progress now.',
			),
		).toBeInTheDocument();
		expect(
			screen.getByText('Raw execution: vendor_search'),
		).toBeInTheDocument();
		expect(
			document.querySelector('[data-role="tool-raw-io"]'),
		).toBeInTheDocument();
	});

	test('renders localized body prose while keeping code and raw output literal', () => {
		renderWithProviders(
			<ChatToolCall
				part={extensionPart('output-available', {
					body: {
						kind: 'labeled',
						sections: [
							{
								label: { en: 'Summary', ru: 'Итог' },
								text: { en: 'Finished', ru: 'Готово' },
							},
						],
					},
					title: { en: 'Results', ru: 'Результаты' },
					version: 1,
				})}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Results' }));
		expect(screen.getByText('Summary')).toBeInTheDocument();
		expect(screen.getByText('Finished')).toBeInTheDocument();
	});
});

// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { DynamicToolUIPart } from 'ai';
import { describe, expect, test } from 'vitest';
import { ChatTaskPlan } from '@/renderer/components/chat-tool-call';
import { renderWithProviders } from './support/dom';

function creation(
	id: string,
	subject: string,
	description?: string,
): DynamicToolUIPart {
	return {
		input: description === undefined ? { subject } : { description, subject },
		output: {
			details: null,
			text: `Task #${id} created successfully: ${subject}`,
		},
		state: 'output-available',
		toolCallId: `create-${id}`,
		toolName: 'TaskCreate',
		type: 'dynamic-tool',
	};
}

describe('ChatTaskPlan', () => {
	const PLAN = [
		creation('1', 'Register the presenters', 'One per verb.'),
		creation('2', 'Fold the run'),
		creation('3', 'Fill ru and el'),
	];

	test('folds a run of creations into one row naming the plan', () => {
		renderWithProviders(<ChatTaskPlan parts={PLAN} />);

		expect(
			screen.getByRole('button', { name: 'Planned 3 tasks' }),
		).toBeInTheDocument();
		expect(screen.getAllByRole('button')).toHaveLength(1);
	});

	test('opens onto the checklist the run filed', async () => {
		const user = userEvent.setup();
		renderWithProviders(<ChatTaskPlan parts={PLAN} />);

		await user.click(screen.getByRole('button', { name: 'Planned 3 tasks' }));

		const items = screen.getAllByRole('listitem');
		expect(items).toHaveLength(3);
		expect(items[0]).toHaveTextContent('Register the presenters');
		expect(items[0]).toHaveTextContent('One per verb.');
		expect(items[0]).toHaveTextContent('#1');
		expect(items[2]).toHaveTextContent('Fill ru and el');
	});
});

// @vitest-environment happy-dom

/**
 * The row THE-198 replaced a bare unstyled line with. What matters here is not
 * that it renders, but that the provider's English sentence stops being the
 * headline while never being thrown away, and that a class only offers the
 * recoveries that can actually work for it.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { RuntimeErrorRow } from '../../../src/renderer/components/workbench-shell/conversation-panel/timeline/runtime-error-row';
import { AGENT_FAILURE_CLASSES } from '../../../src/shared/agent-failure';
import type { AgentWireError } from '../../../src/shared/ipc/contracts/agent-session';

const TRUNCATED: AgentWireError = {
	code: 'adapter-failure',
	message:
		'API Error: Server error mid-response. The response above may be incomplete.',
	recoverable: false,
};

/** Every recovery wired, so a missing button means the class withheld it. */
const ALL_HANDLERS = {
	onContinue: () => undefined,
	onEditPrompt: () => undefined,
	onFork: () => undefined,
	onOpenPermissions: () => undefined,
	onOpenProviderSettings: () => undefined,
	onRetry: () => undefined,
};

describe('RuntimeErrorRow', () => {
	test('leads with authored copy rather than the provider string', () => {
		render(<RuntimeErrorRow failure={TRUNCATED} handlers={ALL_HANDLERS} />);

		expect(screen.getByText('The answer was cut off')).toBeInTheDocument();
		expect(screen.queryByText(TRUNCATED.message)).not.toBeInTheDocument();
	});

	test('keeps the provider string behind the runtime-detail disclosure', () => {
		const { container } = render(
			<RuntimeErrorRow failure={TRUNCATED} handlers={ALL_HANDLERS} />,
		);

		expect(container.textContent).toContain('Runtime detail');
		expect(container.querySelector('[data-failure-class]')).toHaveAttribute(
			'data-failure-class',
			'provider-truncated',
		);
	});

	test('offers Continue on a truncated turn', () => {
		render(<RuntimeErrorRow failure={TRUNCATED} handlers={ALL_HANDLERS} />);

		expect(
			screen.getByRole('button', { name: 'Continue' }),
		).toBeInTheDocument();
	});

	// A credential failure is not resumable — pressing Continue would fail the
	// same way. It points at settings instead.
	test('withholds Continue from a credential failure', () => {
		render(
			<RuntimeErrorRow
				failure={{
					code: 'adapter-failure',
					message: '401 Unauthorized: invalid API key',
					recoverable: false,
				}}
				handlers={ALL_HANDLERS}
			/>,
		);

		expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
		expect(
			screen.getByRole('button', { name: 'Open settings' }),
		).toBeInTheDocument();
	});

	test('renders only the recoveries the surface wired a handler for', () => {
		render(<RuntimeErrorRow failure={TRUNCATED} handlers={{}} />);

		expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
	});

	test('runs the handler the pressed recovery belongs to', () => {
		const onContinue = vi.fn();
		render(<RuntimeErrorRow failure={TRUNCATED} handlers={{ onContinue }} />);

		screen.getByRole('button', { name: 'Continue' }).click();

		expect(onContinue).toHaveBeenCalledOnce();
	});

	test('prefers the class main tagged over re-reading the prose', () => {
		const { container } = render(
			<RuntimeErrorRow
				failure={{ failureClass: 'rate-limit', message: 'fetch failed' }}
				handlers={ALL_HANDLERS}
			/>,
		);

		expect(container.querySelector('[data-failure-class]')).toHaveAttribute(
			'data-failure-class',
			'rate-limit',
		);
	});

	// The catalogue in `shared/` and the copy tables in the renderer are separate
	// declarations; this is what proves a class added to one reaches the other.
	test.each(AGENT_FAILURE_CLASSES)(
		'renders authored copy for %s',
		(failureClass) => {
			render(
				<RuntimeErrorRow
					failure={{ failureClass, message: 'Something went wrong.' }}
					handlers={ALL_HANDLERS}
				/>,
			);

			const row = screen.getByRole('alert');
			expect(row).toHaveAttribute('data-failure-class', failureClass);
			expect(row.textContent).not.toContain('Something went wrong.');
		},
	);

	// A failed turn that only changes colour is a failed turn a screen reader
	// never hears about.
	test('announces itself as an alert', () => {
		render(<RuntimeErrorRow failure={TRUNCATED} handlers={ALL_HANDLERS} />);

		expect(screen.getByRole('alert')).toHaveAttribute(
			'data-failure-class',
			'provider-truncated',
		);
	});

	// Re-sending the same words earns the same refusal, so this class must not
	// offer a plain retry.
	test('offers a refused prompt back for editing rather than a retry', () => {
		render(
			<RuntimeErrorRow
				failure={{ failureClass: 'provider-refused', message: 'Refused.' }}
				handlers={ALL_HANDLERS}
			/>,
		);

		expect(
			screen.getByRole('button', { name: 'Edit the prompt' }),
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
	});

	// The copy tells the user to change the permission mode, so the row has to
	// carry them there.
	test('routes a blocked tool call at the permission settings', () => {
		render(
			<RuntimeErrorRow
				failure={{ failureClass: 'tool-denied', message: 'Blocked.' }}
				handlers={ALL_HANDLERS}
			/>,
		);

		expect(
			screen.getByRole('button', { name: 'Permission settings' }),
		).toBeInTheDocument();
	});

	test('leaves a class with no workable recovery without a button row', () => {
		render(
			<RuntimeErrorRow
				failure={{ failureClass: 'workspace-invalid', message: 'Gone.' }}
				handlers={ALL_HANDLERS}
			/>,
		);

		for (const label of [
			'Continue',
			'Edit the prompt',
			'Fork chat',
			'Open settings',
			'Permission settings',
			'Send again',
		]) {
			expect(screen.queryByRole('button', { name: label })).toBeNull();
		}
	});
});

// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { FollowUpQueueList } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-list';
import { FollowUpQueueStack } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-stack';
import type { QueuedFollowUp } from '../../../src/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

/** Builds a queued entry, optionally carrying one attachment chip. */
function entry(
	id: string,
	text: string,
	options: {
		source?: QueuedFollowUp['source'];
		withAttachment?: boolean;
	} = {},
): QueuedFollowUp {
	return {
		id,
		queuedAt: '2026-08-11T20:00:00.000Z',
		segments: options.withAttachment
			? [
					{ kind: 'text', text },
					{
						attachment: {
							id: 'wsfile:notes.md',
							kind: 'workspace-file',
							label: 'notes.md',
							path: 'notes.md',
						},
						kind: 'attachment',
					},
				]
			: [{ kind: 'text', text }],
		snapshot: null,
		source: options.source ?? 'user',
		text,
	};
}

/** Renders the list with inert handlers, returning the spies for assertions. */
function renderList(
	entries: readonly QueuedFollowUp[],
	options: {
		editable?: boolean;
		steerable?: boolean;
		streaming?: boolean;
	} = {},
) {
	const onEdit = vi.fn();
	const onMove = vi.fn();
	const onRemove = vi.fn();
	const onReorder = vi.fn();
	const onSteer = vi.fn();
	renderWithProviders(
		<FollowUpQueueList
			entries={entries}
			onEdit={options.editable === false ? null : onEdit}
			onMove={onMove}
			onRemove={onRemove}
			onReorder={onReorder}
			onSteer={options.steerable === false ? null : onSteer}
			streaming={options.streaming ?? true}
		/>,
	);
	return { onEdit, onMove, onRemove, onReorder, onSteer };
}

/** Renders the stack over the given entries, returning the spies for assertions. */
function renderStack(
	entries: readonly QueuedFollowUp[],
	options: { paused?: boolean; stalled?: boolean } = {},
) {
	const onClear = vi.fn();
	const onSendNow = vi.fn();
	const result = renderWithProviders(
		<FollowUpQueueStack
			entries={entries}
			onClear={onClear}
			onEdit={vi.fn()}
			onMove={vi.fn()}
			onRemove={vi.fn()}
			onReorder={vi.fn()}
			onSendNow={onSendNow}
			onSteer={vi.fn()}
			paused={options.paused ?? false}
			stalled={options.stalled ?? options.paused ?? false}
			streaming
		/>,
	);
	return { ...result, onClear, onSendNow };
}

describe('the queue stack', () => {
	test('is not rendered at all when nothing is queued', () => {
		renderStack([]);

		expect(screen.queryByRole('region')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});

	test('counts what is queued without anything being opened', () => {
		// The count and the entries are the whole point of the stack: it replaced a
		// chip that hid both behind a click.
		const { unmount } = renderStack([entry('a', 'one')]);
		expect(
			screen.getByRole('region', { name: '1 message queued' }),
		).toBeInTheDocument();
		unmount();

		renderStack([entry('a', 'one'), entry('b', 'two')]);
		expect(
			screen.getByRole('region', { name: '2 messages queued' }),
		).toBeInTheDocument();
		expect(screen.getByText('two')).toBeInTheDocument();
	});

	test('a draining queue says it sends itself and offers no resume', () => {
		renderStack([entry('a', 'waiting')]);

		expect(
			screen.getByText('Sending one at a time as the agent finishes'),
		).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Send next' })).toBeNull();
	});

	test('a paused queue says so and offers to resume', async () => {
		// A stalled queue is waiting on the user, not the agent, so it has to say so
		// and hand them the control. Without it a block-mode queue has no exit.
		const { onSendNow } = renderStack([entry('a', 'waiting')], {
			paused: true,
		});

		expect(
			screen.getByText('Paused — nothing sends until you resume'),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

		expect(onSendNow).toHaveBeenCalledTimes(1);
	});

	test('a block-mode queue is held back rather than paused', async () => {
		// Distinct from paused: nothing stopped this queue, the behavior simply keeps
		// follow-ups out of a running turn, so the exit sends one rather than resuming.
		const { onSendNow } = renderStack([entry('a', 'waiting')], {
			stalled: true,
		});

		expect(
			screen.getByText('Held back — send them yourself when you are ready'),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Send next' }));

		expect(onSendNow).toHaveBeenCalledTimes(1);
	});
});

describe('the queue list', () => {
	test('renders entries in queue order, numbered from the front', () => {
		renderList([entry('a', 'first'), entry('b', 'second')]);

		expect(screen.getByText('first')).toBeInTheDocument();
		expect(screen.getByText('second')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Reorder, position 1' }),
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Reorder, position 2' }),
		).toBeInTheDocument();
	});

	test('shows how many chips an entry carries', () => {
		renderList([entry('a', 'with a file', { withAttachment: true })]);

		expect(screen.getByText('1 attachment')).toBeInTheDocument();
	});

	test('marks only the head as the one that goes next', () => {
		renderList([entry('a', 'first'), entry('b', 'second')]);

		expect(screen.getAllByText('Next')).toHaveLength(1);
	});
});

describe('steering a queued entry', () => {
	test('names only the entry whose button was pressed', async () => {
		const { onSteer } = renderList([entry('a', 'first'), entry('b', 'second')]);

		const steers = screen.getAllByRole('button', {
			name: 'Steer the agent with this now',
		});
		await userEvent.click(steers[1]);

		expect(onSteer).toHaveBeenCalledTimes(1);
		expect(onSteer).toHaveBeenCalledWith('b');
	});

	test('reads as a plain send once the agent is idle', () => {
		// Idle there is no turn to steer into, so the same control has to promise the
		// ordinary thing rather than an interruption that cannot happen.
		renderList([entry('a', 'first')], { streaming: false });

		expect(
			screen.getByRole('button', { name: 'Send this now' }),
		).toBeInTheDocument();
	});

	// A pointer got the reason from the tooltip while a screen reader was still
	// told the action was available, so the accessible name is the blocked reason
	// rather than the one the enabled control carries.
	test('is disabled and says why while the composer cannot send at all', () => {
		renderList([entry('a', 'first')], { steerable: false });

		expect(
			screen.queryByRole('button', {
				name: 'Steer the agent with this now',
			}),
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', {
				name: 'The agent cannot take a message right now',
			}),
		).toBeDisabled();
	});

	test('removing an entry names only that entry', async () => {
		const { onRemove } = renderList([
			entry('a', 'first'),
			entry('b', 'second'),
		]);

		const removes = screen.getAllByRole('button', {
			name: 'Remove from queue',
		});
		await userEvent.click(removes[1]);

		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onRemove).toHaveBeenCalledWith('b');
	});

	test('editing hands the entry back to the composer', async () => {
		const { onEdit } = renderList([entry('a', 'fix this one')]);

		await userEvent.click(
			screen.getByRole('button', { name: 'Edit in composer' }),
		);

		expect(onEdit).toHaveBeenCalledWith('a');
	});

	test('editing is disabled and says why while the composer holds a draft', () => {
		// Restoring over a draft would have to append the entry as plain text and
		// lose its chips, so the button refuses rather than degrading.
		renderList([entry('a', 'fix this one')], { editable: false });

		expect(
			screen.getByRole('button', {
				name: 'Send or clear the current draft first',
			}),
		).toBeDisabled();
	});
});

describe('reordering from the keyboard', () => {
	test('the arrow keys move an entry through the handle', async () => {
		const { onMove } = renderList([entry('a', 'first'), entry('b', 'second')]);

		const secondHandle = screen.getByRole('button', {
			name: 'Reorder, position 2',
		});
		secondHandle.focus();
		await userEvent.keyboard('{ArrowUp}');

		expect(onMove).toHaveBeenCalledWith('b', 'up');
	});

	test('an arrow that would run off the end does nothing', async () => {
		const { onMove } = renderList([entry('a', 'first'), entry('b', 'second')]);

		const firstHandle = screen.getByRole('button', {
			name: 'Reorder, position 1',
		});
		firstHandle.focus();
		await userEvent.keyboard('{ArrowUp}');

		expect(onMove).not.toHaveBeenCalled();
	});
});

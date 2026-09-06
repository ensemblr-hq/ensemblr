// @vitest-environment happy-dom

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { FollowUpQueueList } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-list';
import { FollowUpQueueStack } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-stack';
import type {
	FollowUpQueueHoldReason,
	QueuedFollowUp,
} from '../../../src/renderer/types/workbench';
import { renderWithProviders } from '../support/dom';

/**
 * Builds a queued entry. `leadingChip` puts a chip in front of the text the way
 * an `@` mention opens a message, which is where the flat `text` loses it.
 */
function entry(
	id: string,
	text: string,
	options: {
		leadingChip?: string;
		source?: QueuedFollowUp['source'];
	} = {},
): QueuedFollowUp {
	const chip = options.leadingChip;
	return {
		id,
		queuedAt: '2026-08-11T20:00:00.000Z',
		segments: chip
			? [
					{
						attachment: {
							id: `wsfile:${chip}`,
							kind: 'workspace-file' as const,
							label: chip,
							path: chip,
						},
						kind: 'attachment' as const,
					},
					{ kind: 'text' as const, text },
				]
			: [{ kind: 'text' as const, text }],
		snapshot: null,
		source: options.source ?? 'user',
		text: chip ? ` ${text}` : text,
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
	options: {
		/** Mirrors a composer that cannot take a send, which nulls both controls. */
		canDeliver?: boolean;
		pauseReason?: FollowUpQueueHoldReason;
		stalled?: boolean;
	} = {},
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
			onSendNow={options.canDeliver === false ? null : onSendNow}
			onSteer={vi.fn()}
			pauseReason={options.pauseReason ?? null}
			stalled={options.stalled ?? options.pauseReason !== undefined}
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

	test('a queue paused by a stop says which pause it was and offers to resume', async () => {
		// A stalled queue is waiting on the user, not the agent, so it has to say so
		// and hand them the control. Without it a block-mode queue has no exit.
		const { onSendNow } = renderStack([entry('a', 'waiting')], {
			pauseReason: 'turn-stopped',
		});

		expect(
			screen.getByText('Paused — you stopped the turn'),
		).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Resume' }));

		expect(onSendNow).toHaveBeenCalledTimes(1);
	});

	test('a queue paused by a failed send names that instead', () => {
		// The two pauses look identical on screen, so the wording is the only thing
		// that tells a user who stopped nothing why their queue will not move.
		renderStack([entry('a', 'waiting')], { pauseReason: 'send-failed' });

		expect(
			screen.getByText('Paused — the last message could not be sent'),
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
	});

	test('resume is offered but disabled while the composer cannot send', async () => {
		// Resuming hands the head straight to the send pipeline, which refuses it
		// outright while the composer is busy — and a run of refusals pauses the
		// queue. The control stays visible so the exit is still legible.
		const { onSendNow } = renderStack([entry('a', 'waiting')], {
			canDeliver: false,
			pauseReason: 'turn-stopped',
		});

		const resume = screen.getByRole('button', { name: 'Resume' });
		expect(resume).toBeDisabled();
		await userEvent.click(resume);

		expect(onSendNow).not.toHaveBeenCalled();
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

	test('drops the reorder handle when a lone entry has nowhere to move', () => {
		renderList([entry('a', 'only')]);

		expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
		expect(screen.getByText('1')).toBeInTheDocument();
	});

	test('keeps a chip where the message put it', () => {
		renderList([entry('a', ' is fixed?', { leadingChip: 'timeline.tsx' })]);

		expect(screen.getByText('timeline.tsx')).toBeInTheDocument();
		expect(screen.getByText('timeline.tsx').closest('p')?.textContent).toBe(
			'timeline.tsx is fixed?',
		);
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

/**
 * Renders the list over entries the test can shrink, so a queue draining to its
 * last message goes through the same render the composer puts it through.
 */
function DrainableQueue({ initial }: { initial: readonly QueuedFollowUp[] }) {
	const [entries, setEntries] = useState(initial);

	return (
		<>
			<button
				onClick={() => setEntries((current) => current.slice(1))}
				type='button'
			>
				drain the head
			</button>
			<FollowUpQueueList
				entries={entries}
				onEdit={vi.fn()}
				onMove={vi.fn()}
				onRemove={vi.fn()}
				onReorder={vi.fn()}
				onSteer={vi.fn()}
				streaming={true}
			/>
		</>
	);
}

/** Renders a shrinkable queue and hands back the control that drains its head. */
function renderDrainableQueue(entries: readonly QueuedFollowUp[]) {
	renderWithProviders(<DrainableQueue initial={entries} />);
	return screen.getByRole('button', { name: 'drain the head' });
}

describe('focus when a drain takes the handle away', () => {
	test('the row catches the focus its handle was holding', () => {
		const drain = renderDrainableQueue([
			entry('a', 'first'),
			entry('b', 'second'),
		]);
		screen.getByRole('button', { name: 'Reorder, position 2' }).focus();

		fireEvent.click(drain);

		expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByText('second').closest('li'),
		);
	});

	test('a row action that survives the drain keeps its own focus', () => {
		const drain = renderDrainableQueue([
			entry('a', 'first'),
			entry('b', 'second'),
		]);
		const tailRemove = screen.getAllByRole('button', {
			name: 'Remove from queue',
		})[1];
		tailRemove?.focus();

		fireEvent.click(drain);

		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Remove from queue' }),
		);
	});

	test('a queue nobody was standing in does not pull focus in', () => {
		const drain = renderDrainableQueue([
			entry('a', 'first'),
			entry('b', 'second'),
		]);

		fireEvent.click(drain);

		expect(document.activeElement).toBe(document.body);
	});
});

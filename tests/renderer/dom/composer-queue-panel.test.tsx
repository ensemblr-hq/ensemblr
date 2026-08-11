// @vitest-environment happy-dom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { FollowUpQueueList } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-list';
import { FollowUpQueuePanel } from '../../../src/renderer/components/workbench-shell/conversation-panel/composer/follow-up-queue-panel';
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
	options: { editable?: boolean } = {},
) {
	const onEdit = vi.fn();
	const onMove = vi.fn();
	const onRemove = vi.fn();
	const onReorder = vi.fn();
	renderWithProviders(
		<FollowUpQueueList
			entries={entries}
			onEdit={options.editable === false ? null : onEdit}
			onMove={onMove}
			onRemove={onRemove}
			onReorder={onReorder}
		/>,
	);
	return { onEdit, onMove, onRemove, onReorder };
}

describe('the queue chip', () => {
	test('is not rendered at all when nothing is queued', () => {
		renderWithProviders(
			<FollowUpQueuePanel
				entries={[]}
				held={false}
				onClear={vi.fn()}
				onEdit={vi.fn()}
				onMove={vi.fn()}
				onRemove={vi.fn()}
				onReorder={vi.fn()}
				onSendNow={vi.fn()}
			/>,
		);

		expect(screen.queryByRole('button')).toBeNull();
	});

	test('counts what is queued, in the singular and the plural', () => {
		const { unmount } = renderWithProviders(
			<FollowUpQueuePanel
				entries={[entry('a', 'one')]}
				held={false}
				onClear={vi.fn()}
				onEdit={vi.fn()}
				onMove={vi.fn()}
				onRemove={vi.fn()}
				onReorder={vi.fn()}
				onSendNow={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole('button', { name: '1 message queued' }),
		).toBeInTheDocument();
		unmount();

		renderWithProviders(
			<FollowUpQueuePanel
				entries={[entry('a', 'one'), entry('b', 'two')]}
				held={false}
				onClear={vi.fn()}
				onEdit={vi.fn()}
				onMove={vi.fn()}
				onRemove={vi.fn()}
				onReorder={vi.fn()}
				onSendNow={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole('button', { name: '2 messages queued' }),
		).toBeInTheDocument();
	});
});

describe('a stalled queue', () => {
	/** Opens the panel over one queued entry, held or not. */
	async function openPanel(held: boolean) {
		const onSendNow = vi.fn();
		renderWithProviders(
			<FollowUpQueuePanel
				entries={[entry('a', 'waiting')]}
				held={held}
				onClear={vi.fn()}
				onEdit={vi.fn()}
				onMove={vi.fn()}
				onRemove={vi.fn()}
				onReorder={vi.fn()}
				onSendNow={onSendNow}
			/>,
		);
		await userEvent.click(
			screen.getByRole('button', { name: '1 message queued' }),
		);
		return { onSendNow };
	}

	test('says it is paused and offers a way to send it', async () => {
		// A stalled queue is waiting on the user, not the agent, so it has to say so
		// and hand them the control. Without it a block-mode queue has no exit.
		const { onSendNow } = await openPanel(true);

		expect(screen.getByText('Queued · paused')).toBeInTheDocument();
		await userEvent.click(screen.getByRole('button', { name: 'Send now' }));

		expect(onSendNow).toHaveBeenCalledTimes(1);
	});

	test('a queue that drains on its own offers neither', async () => {
		await openPanel(false);

		expect(screen.getByText('Queued')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
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

	test('editing is disabled while the composer already holds a draft', () => {
		// Restoring over a draft would have to append the entry as plain text and
		// lose its chips, so the button refuses rather than degrading.
		renderList([entry('a', 'fix this one')], { editable: false });

		expect(
			screen.getByRole('button', { name: 'Edit in composer' }),
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

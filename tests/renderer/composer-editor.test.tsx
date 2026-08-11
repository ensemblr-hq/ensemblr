// @vitest-environment happy-dom
import { act, screen, waitFor } from '@testing-library/react';
import { createRef, useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	type ComposerDraftChange,
	ComposerEditor,
	type ComposerEditorHandle,
} from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import type { ComposerAttachment } from '@/renderer/types/workbench';
import { renderWithProviders } from './support/dom';

const APP_FILE: ComposerAttachment = {
	id: 'wsfile:src/app.ts',
	kind: 'workspace-file',
	label: 'app.ts',
	path: 'src/app.ts',
};

const README: ComposerAttachment = {
	id: 'wsfile:README.md',
	kind: 'workspace-file',
	label: 'README.md',
	path: 'README.md',
};

function mountEditor(
	initial: {
		attachments?: readonly ComposerAttachment[];
		disabled?: boolean;
		text?: string;
	} = {},
) {
	const handleRef = createRef<ComposerEditorHandle>();
	const changes: ComposerDraftChange[] = [];
	const view = renderWithProviders(
		<ComposerEditor
			ariaLabel='Agent composer'
			disabled={initial.disabled ?? false}
			handleRef={handleRef}
			initialSeed={{
				attachments: initial.attachments ?? [],
				text: initial.text ?? '',
			}}
			initialSnapshot={null}
			onBlur={vi.fn()}
			onDraftChange={(change) => changes.push(change)}
			onDroppedTransfer={() => false}
			onFocus={vi.fn()}
			onKeyDown={vi.fn()}
			onPastedTransfer={() => false}
			placeholder='Ask to make changes'
		/>,
	);
	const latest = () => changes.at(-1);
	return { changes, handleRef, latest, view };
}

/** Runs an editor write and waits for the draft it publishes back. */
async function write(run: () => void): Promise<void> {
	await act(async () => {
		run();
	});
}

describe('composer editor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('reads a chip as one space, so the text around it keeps its offsets', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('see'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));

		await waitFor(() => {
			expect(latest()?.text).toBe('see ');
		});
		expect(latest()?.attachments).toEqual([APP_FILE]);
	});

	it('carries the chips in the order they sit in the sentence', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('a'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.appendText('b'));
		await write(() => handleRef.current?.insertAttachment(README));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE, README]);
		});
		expect(latest()?.text).toBe('a b ');
	});

	// What the send pipeline walks: without it the prompt can only stack every
	// attachment at one end, whatever the user typed around the chips.
	it('publishes the text runs and the chips interleaved, in document order', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('compare'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.appendText('against'));
		await write(() => handleRef.current?.insertAttachment(README));

		await waitFor(() => {
			expect(latest()?.segments).toEqual([
				{ kind: 'text', text: 'compare' },
				{ attachment: APP_FILE, kind: 'attachment' },
				{ kind: 'text', text: 'against' },
				{ attachment: README, kind: 'attachment' },
			]);
		});
	});

	// A draft another surface queued while the composer was unmounted has to be
	// sendable before the user touches it, so the editor publishes on mount too.
	it('publishes the draft it opened with before any edit', async () => {
		const { latest } = mountEditor({
			attachments: [APP_FILE],
			text: 'Implement this.',
		});

		await waitFor(() => {
			expect(latest()?.segments).toEqual([
				{ kind: 'text', text: 'Implement this.' },
				{ attachment: APP_FILE, kind: 'attachment' },
			]);
		});
	});

	it('replaces an @ token in place, leaving the rest of the sentence alone', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('look at @app then ship'));
		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(7, 13, APP_FILE),
		);

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE]);
		});
		expect(latest()?.text).toBe('look at then ship');
	});

	// A pick consumes the token's trailing space, so the caret ends up flush
	// against the chip and the next `@` token opens one character in. The chip's
	// own stand-in space then reads as a leading space to the replacement range,
	// which pulls the range start onto the chip — the boundary has to snap to the
	// text beside it or the whole pick is a silent no-op.
	it('picks a mention typed flush against an existing chip', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('@app'));
		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(0, 4, APP_FILE),
		);
		await write(() => handleRef.current?.insertText('@read'));
		await waitFor(() => {
			expect(latest()?.text).toBe(' @read');
		});

		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(0, 6, README),
		);

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE, README]);
		});
		expect(latest()?.text).toBe('  ');
	});

	it('refuses a second chip for an attachment the draft already holds', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE]);
		});
	});

	it('removes a chip by attachment id', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('keep'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.removeAttachment(APP_FILE.id));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([]);
		});
		expect(latest()?.text).toBe('keep');
	});

	it('restores a whole draft from its snapshot, chips still in the sentence', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('before'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.appendText('after'));
		const snapshot = latest()?.snapshot;

		await write(() => handleRef.current?.clear());
		await waitFor(() => {
			expect(latest()?.text).toBe('');
		});

		await write(() => {
			if (snapshot) {
				handleRef.current?.restore(snapshot);
			}
		});

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE]);
		});
		expect(latest()?.text).toBe('before after');
	});

	// A chat mounts its composer disabled while Ensemblr checks setup readiness.
	// Lexical reads `initialConfig.editable` once, so without the editable plugin
	// the surface stays read-only until something remounts it — which is what
	// switching tabs away and back does.
	it('becomes typable once the composer stops being disabled', async () => {
		let enable: () => void = () => undefined;
		function Harness() {
			const [disabled, setDisabled] = useState(true);
			const handleRef = useRef<ComposerEditorHandle>(null);
			enable = () => setDisabled(false);
			return (
				<ComposerEditor
					ariaLabel='Agent composer'
					disabled={disabled}
					handleRef={handleRef}
					initialSeed={{ attachments: [], text: '' }}
					initialSnapshot={null}
					onBlur={vi.fn()}
					onDraftChange={vi.fn()}
					onDroppedTransfer={() => false}
					onFocus={vi.fn()}
					onKeyDown={vi.fn()}
					onPastedTransfer={() => false}
					placeholder='Ask to make changes'
				/>
			);
		}
		renderWithProviders(<Harness />);
		expect(screen.getByLabelText('Agent composer')).toHaveAttribute(
			'contenteditable',
			'false',
		);

		await act(async () => {
			enable();
		});

		expect(screen.getByLabelText('Agent composer')).toHaveAttribute(
			'contenteditable',
			'true',
		);
	});

	it('opens with the text and chips queued for it while it was unmounted', async () => {
		const { handleRef, latest } = mountEditor({
			attachments: [APP_FILE],
			text: 'Implement the attached plan.',
		});

		expect(
			screen.getByText('Implement the attached plan.'),
		).toBeInTheDocument();

		await write(() => handleRef.current?.appendText('!'));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([APP_FILE]);
		});
		expect(latest()?.text).toBe('Implement the attached plan. !');
	});
});

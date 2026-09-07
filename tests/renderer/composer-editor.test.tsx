// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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

const WORKSPACE_REF: ComposerAttachment = {
	id: 'workspace-ref:ws-1',
	kind: 'workspace-ref',
	label: 'khachaturian',
	reference: {
		cwd: '/workspaces/ensemblr/khachaturian',
		kind: 'workspace',
		label: 'khachaturian',
		project: 'ensemblr',
		projectId: 'repo-1',
		workspaceId: 'ws-1',
	},
};

const TERMINAL_OUTPUT: ComposerAttachment = {
	id: 'wsfile:.context/attachments/aa44bb/terminal-selection.txt',
	kind: 'pasted-text',
	label: 'terminal-selection.txt',
	lineCount: 2,
	path: '.context/attachments/aa44bb/terminal-selection.txt',
	preview: 'ALPHA_LINE_ONE\nBETA_LINE_TWO',
	source: { kind: 'terminal', label: 'npm run dev' },
};

const PASTED_BLOCK: ComposerAttachment = {
	id: 'wsfile:.context/attachments/cc55dd/pasted-text.txt',
	kind: 'pasted-text',
	label: 'pasted-text.txt',
	lineCount: 19,
	path: '.context/attachments/cc55dd/pasted-text.txt',
	preview: 'GAMMA_LINE_ONE\nDELTA_LINE_TWO',
};

/** The host span Lexical mounts a chip into, for the nth chip in the draft. */
function chipHost(index: number): HTMLElement {
	const host = document.querySelectorAll<HTMLElement>(
		'[data-lexical-decorator]',
	)[index];
	if (!host) {
		throw new Error(`No chip host at ${index}`);
	}
	return host;
}

/** The editable root, whose own children are the tray and then the paragraph. */
function editorRoot(): HTMLElement {
	const root = document.querySelector<HTMLElement>('[contenteditable="true"]');
	if (!root) {
		throw new Error('No editable root');
	}
	return root;
}

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

	// The @ menu is how a user re-picks a file already attached, and the refusal
	// there still has to swallow the token it was typed as.
	it('swallows the token when the @ menu picks a file the draft holds', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.appendText('and @app'));
		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(5, 9, APP_FILE),
		);

		await waitFor(() => {
			expect(latest()?.text).not.toContain('@app');
		});
		expect(latest()?.attachments).toEqual([APP_FILE]);
	});

	// A reference carries no content to inline, so a repeat costs nothing and is
	// how a sentence names the same workspace in two places.
	it('lets a reference chip repeat within one draft', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('compare'));
		await write(() => handleRef.current?.insertAttachment(WORKSPACE_REF));
		await write(() => handleRef.current?.appendText('then update'));
		await write(() => handleRef.current?.insertAttachment(WORKSPACE_REF));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([WORKSPACE_REF, WORKSPACE_REF]);
		});
	});

	it('replaces a token with a repeat of a reference already in the draft', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.insertAttachment(WORKSPACE_REF));
		await write(() => handleRef.current?.appendText('and @kha'));
		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(5, 9, WORKSPACE_REF),
		);

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([WORKSPACE_REF, WORKSPACE_REF]);
		});
		expect(latest()?.text).not.toContain('@kha');
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

	// A stored-text chip is nearly three lines tall. Inline it inflates the line
	// box and the sentence wraps around it, so it stands above the text instead.
	it('stands a stored-text chip above the typed text rather than in it', async () => {
		mountEditor({ attachments: [TERMINAL_OUTPUT], text: 'Explain this.' });

		await waitFor(() => {
			expect(chipHost(0).parentElement).toBe(editorRoot());
		});
		expect([...editorRoot().children].map((child) => child.tagName)).toEqual([
			'SPAN',
			'P',
		]);
		expect(chipHost(0).className).not.toContain('h-[1.625em]');
	});

	it('keeps a one-row chip in the sentence, pinned to a single line box', async () => {
		mountEditor({ attachments: [APP_FILE], text: 'see' });

		await waitFor(() => {
			expect(chipHost(0).parentElement?.tagName).toBe('P');
		});
		expect(chipHost(0).className).toContain('h-[1.625em]');
	});

	// The caret is in the sentence the user is typing; a stored-text chip belongs
	// in the tray whatever that caret was doing when it arrived.
	it('pins a stored-text chip above the draft rather than at the caret', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('explain'));
		await write(() => handleRef.current?.insertAttachment(TERMINAL_OUTPUT));

		await waitFor(() => {
			expect(latest()?.segments).toEqual([
				{ attachment: TERMINAL_OUTPUT, kind: 'attachment' },
				{ kind: 'text', text: '\nexplain' },
			]);
		});
	});

	it('keeps the tray in the order its chips were attached', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.insertAttachment(TERMINAL_OUTPUT));
		await write(() => handleRef.current?.appendText('and'));
		await write(() => handleRef.current?.insertAttachment(PASTED_BLOCK));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([TERMINAL_OUTPUT, PASTED_BLOCK]);
		});
		expect(chipHost(1).parentElement).toBe(editorRoot());
	});

	// Where a chip goes is a property of the attachment, not of the entry point
	// that added it — otherwise the tray holds only what `insertAttachment` put
	// there and a token replaced by a stored-text chip splits the paragraph.
	it('sends a token replaced by a stored-text chip to the tray', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('read @notes'));
		await write(() =>
			handleRef.current?.replaceRangeWithAttachment(5, 11, TERMINAL_OUTPUT),
		);

		await waitFor(() => {
			expect(latest()?.segments).toEqual([
				{ attachment: TERMINAL_OUTPUT, kind: 'attachment' },
				{ kind: 'text', text: '\nread ' },
			]);
		});
		expect(chipHost(0).parentElement).toBe(editorRoot());
	});

	// `addAttachments` inserts a batch one chip at a time, so a paste carrying a
	// file and a stored-text block comes back in a different order than it went
	// in: the tray stands above the sentence, so its chip reads — and sends —
	// ahead of an inline chip attached before it.
	it('carries a tray chip ahead of an inline chip attached first', async () => {
		const { handleRef, latest } = mountEditor();

		await write(() => handleRef.current?.appendText('compare'));
		await write(() => handleRef.current?.insertAttachment(APP_FILE));
		await write(() => handleRef.current?.insertAttachment(TERMINAL_OUTPUT));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([TERMINAL_OUTPUT, APP_FILE]);
		});
		expect(latest()?.segments).toEqual([
			{ attachment: TERMINAL_OUTPUT, kind: 'attachment' },
			{ kind: 'text', text: '\ncompare' },
			{ attachment: APP_FILE, kind: 'attachment' },
		]);
	});

	// Lexical's own Backspace walks out of the paragraph and takes its previous
	// sibling, which for the first paragraph is a tray chip. The tray is not part
	// of the sentence and its chips are removed by their own control, so editing
	// the sentence must not silently empty it — least of all from the start of the
	// text, where a Backspace normally does nothing at all.
	it('leaves the tray alone when Backspace runs at the start of the sentence', async () => {
		const { handleRef, latest } = mountEditor({
			attachments: [TERMINAL_OUTPUT],
			text: 'hi',
		});

		await write(() => handleRef.current?.replaceRangeWithText(2, 2, ''));
		await write(() => {
			fireEvent.keyDown(editorRoot(), { key: 'Backspace' });
		});

		await waitFor(() => {
			expect(latest()?.text).toBe(' \nhi');
		});
		expect(latest()?.attachments).toEqual([TERMINAL_OUTPUT]);
	});

	// The same Backspace from an empty draft deletes the paragraph rather than the
	// chip, leaving a document whose only block is a decorator and no place to type.
	it('keeps a place to type when Backspace runs on an empty draft below the tray', async () => {
		const { handleRef, latest } = mountEditor({
			attachments: [TERMINAL_OUTPUT],
		});

		await write(() => handleRef.current?.appendText(''));
		await write(() => {
			fireEvent.keyDown(editorRoot(), { key: 'Backspace' });
		});

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([TERMINAL_OUTPUT]);
		});
		expect([...editorRoot().children].map((child) => child.tagName)).toEqual([
			'SPAN',
			'P',
		]);
	});

	// A bare Backspace is not the only way back into the tray. Lexical sends ⌥⌫
	// and ⌃⌫ to DELETE_WORD_COMMAND, ⌘⌫ to DELETE_LINE_COMMAND and ⌃H to
	// DELETE_CHARACTER_COMMAND without any of them passing through
	// KEY_BACKSPACE_COMMAND, so a guard on the keystroke alone leaves three doors
	// open. Which chord is live depends on the platform Lexical read at load, so
	// every one of them is fired and none may reach the tray.
	it('leaves the tray alone for every backward-delete chord, not just Backspace', async () => {
		const { handleRef, latest } = mountEditor({
			attachments: [TERMINAL_OUTPUT],
			text: 'hi',
		});

		await write(() => handleRef.current?.replaceRangeWithText(2, 2, ''));
		for (const modifier of [
			{ ctrlKey: true },
			{ altKey: true },
			{ metaKey: true },
		]) {
			await write(() => {
				fireEvent.keyDown(editorRoot(), { key: 'Backspace', ...modifier });
			});
		}
		await write(() => {
			fireEvent.keyDown(editorRoot(), { ctrlKey: true, key: 'h' });
		});

		await waitFor(() => {
			expect(latest()?.text).toBe(' \nhi');
		});
		expect(latest()?.attachments).toEqual([TERMINAL_OUTPUT]);
	});

	it('removes a tray chip by attachment id', async () => {
		const { handleRef, latest } = mountEditor({
			attachments: [TERMINAL_OUTPUT],
			text: 'Explain this.',
		});

		await write(() => handleRef.current?.removeAttachment(TERMINAL_OUTPUT.id));

		await waitFor(() => {
			expect(latest()?.attachments).toEqual([]);
		});
		expect(latest()?.text).toBe('Explain this.');
	});
});

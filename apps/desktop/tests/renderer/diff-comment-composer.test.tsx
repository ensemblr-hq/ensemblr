// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

// Pin macOS before importing the component so the keymap resolves `mod` to the
// Command key and the ⌘⏎ assertions below reflect real product behavior. The
// matcher memoizes its platform check on first use, so this must run first.
vi.hoisted(() => {
	Object.defineProperty(globalThis.navigator, 'platform', {
		configurable: true,
		value: 'MacIntel',
	});
});

import { DiffCommentThread } from '../../src/renderer/components/diff-viewer/diff-comment-thread';

/**
 * Render an open composer thread with no existing comments.
 * @param onSubmit - Spy for the submit callback
 * @returns The Testing Library render result
 */
function renderComposer(onSubmit: (body: string) => void) {
	return render(
		<DiffCommentThread
			comments={[]}
			composerOpen
			onCloseComposer={() => {}}
			onDelete={() => {}}
			onResolve={() => {}}
			onSubmit={onSubmit}
		/>,
	);
}

describe('diff comment composer keyboard submit', () => {
	test('cmd+enter submits the trimmed body', () => {
		const onSubmit = vi.fn();
		const { getByLabelText } = renderComposer(onSubmit);
		const textarea = getByLabelText('New line comment');

		fireEvent.change(textarea, { target: { value: '  looks good  ' } });
		fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

		expect(onSubmit).toHaveBeenCalledWith('looks good');
	});

	test('plain enter does not submit', () => {
		const onSubmit = vi.fn();
		const { getByLabelText } = renderComposer(onSubmit);
		const textarea = getByLabelText('New line comment');

		fireEvent.change(textarea, { target: { value: 'still typing' } });
		fireEvent.keyDown(textarea, { key: 'Enter' });

		expect(onSubmit).not.toHaveBeenCalled();
	});

	test('cmd+enter on an empty body is a no-op', () => {
		const onSubmit = vi.fn();
		const { getByLabelText } = renderComposer(onSubmit);
		const textarea = getByLabelText('New line comment');

		fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

		expect(onSubmit).not.toHaveBeenCalled();
	});

	test('shows the shortcut hint on the Comment button', () => {
		const { getByRole } = renderComposer(() => {});
		expect(getByRole('button', { name: /Comment/ }).textContent).toContain('⌘');
	});
});

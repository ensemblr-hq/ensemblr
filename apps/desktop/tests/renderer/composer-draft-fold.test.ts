import { expect, test } from 'vitest';

import { appendedSuffix } from '@/renderer/hooks/workbench-shell/composer/use-composer-state';

test('reads a plain append as an append', () => {
	expect(appendedSuffix('look at', 'look at this')).toBe(' this');
});

// A chip reads as one space, so a draft ending in one has a trailing space in
// its mirrored text — and `useComposerInsertToChat` trims the draft's end
// before appending. Without forgiving that space the fold falls through to a
// full replacement, which rebuilds the document as plain text and drops every
// chip the user had attached.
test('reads an append that trimmed a trailing chip space as an append', () => {
	expect(appendedSuffix('look at ', 'look at\n\ncontext')).toBe('\n\ncontext');
});

test('reads an append onto a chip-only draft as an append', () => {
	expect(appendedSuffix(' ', 'context')).toBe('context');
});

test('reads an append onto an empty draft as an append', () => {
	expect(appendedSuffix('', 'seeded text')).toBe('seeded text');
});

test('reads an unrelated value as a replacement', () => {
	expect(appendedSuffix('look at ', 'something else')).toBeNull();
});

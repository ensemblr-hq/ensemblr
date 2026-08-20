// @vitest-environment happy-dom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModalInertBodyGuard } from '@/renderer/hooks/use-modal-inert-body-guard';

/** Mounts a Radix-shaped modal content node directly under `<body>`. */
function mountModalContent(): HTMLElement {
	const content = document.createElement('div');
	content.setAttribute('data-slot', 'dialog-content');
	document.body.append(content);
	return content;
}

describe('useModalInertBodyGuard', () => {
	afterEach(() => {
		document.body.style.removeProperty('pointer-events');
		for (const node of Array.from(
			document.querySelectorAll('[data-slot="dialog-content"]'),
		)) {
			node.remove();
		}
	});

	// Archiving or deleting the active workspace unmounted the view the dialog was
	// mounted under, so Radix never ran the cleanup that restores this. The style
	// survived with no modal left to dismiss: no hover, no clicks, no Escape.
	it('releases a pointer-events lock no modal is holding', async () => {
		renderHook(() => useModalInertBodyGuard());
		const content = mountModalContent();
		document.body.style.pointerEvents = 'none';

		content.remove();

		await waitFor(() => {
			expect(document.body.style.pointerEvents).toBe('');
		});
	});

	it('leaves the lock alone while a modal is still mounted', async () => {
		renderHook(() => useModalInertBodyGuard());
		mountModalContent();

		document.body.style.pointerEvents = 'none';

		await waitFor(() => {
			expect(document.body.style.pointerEvents).toBe('none');
		});
	});

	it('releases a lock that was already stranded before it mounted', async () => {
		document.body.style.pointerEvents = 'none';

		renderHook(() => useModalInertBodyGuard());

		await waitFor(() => {
			expect(document.body.style.pointerEvents).toBe('');
		});
	});
});

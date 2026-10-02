import { useEffect } from 'react';

/**
 * Every element whose presence means something modal is legitimately holding
 * the page inert. Radix portals its content into `<body>`, so if none of these
 * is in the document the `pointer-events: none` on `<body>` belongs to nobody.
 */
const MODAL_CONTENT_SELECTOR = [
	'[data-slot="dialog-content"]',
	'[data-slot="alert-dialog-content"]',
	'[data-slot="sheet-content"]',
	'[data-slot="drawer-content"]',
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[role="menu"]',
	'[data-radix-popper-content-wrapper]',
].join(',');

/**
 * Releases a `pointer-events: none` that Radix left on `<body>` after its modal
 * was destroyed by an ancestor unmounting rather than closed through its own
 * lifecycle.
 *
 * Radix marks the body inert while a modal is open and restores it on cleanup.
 * When an ancestor unmounts the portal mid-flight — which archiving or deleting
 * the workspace the dialog is mounted under does — that cleanup never runs and
 * the style survives with no modal left to dismiss. The window keeps painting
 * and the main process keeps answering, so it reads as the whole front end
 * freezing: no hover, no clicks, and no Escape, because the layer that listened
 * for it is gone.
 */
export function useModalInertBodyGuard(): void {
	useEffect(() => {
		const body = document.body;

		const releaseWhenOrphaned = (): void => {
			if (body.style.pointerEvents !== 'none') {
				return;
			}

			if (document.querySelector(MODAL_CONTENT_SELECTOR)) {
				return;
			}

			body.style.removeProperty('pointer-events');
		};

		const observer = new MutationObserver(releaseWhenOrphaned);
		observer.observe(body, {
			attributeFilter: ['style'],
			attributes: true,
			childList: true,
		});
		releaseWhenOrphaned();

		return () => {
			observer.disconnect();
		};
	}, []);
}

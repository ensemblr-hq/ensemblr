import { useEffect, useRef, useState } from 'react';

/**
 * Copies text to the clipboard and flashes a confirmation in place, so a button
 * can report success without a toast. The reset timer is cleared on unmount and
 * restarted on a repeat copy, so a button that disappears mid-flash never lands
 * a state update on a gone component.
 * @param resetMs - How long the confirmed state lasts before reverting
 * @returns Whether the last copy is still confirmed, and the copy handler
 */
export function useCopyToClipboard(resetMs: number): {
	copied: boolean;
	copy: (text: string) => Promise<void>;
} {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	return {
		copied,
		copy: async (text: string) => {
			try {
				await navigator.clipboard.writeText(text);
			} catch (error) {
				console.error('Failed to copy to the clipboard:', error);
				return;
			}

			setCopied(true);

			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}

			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				setCopied(false);
			}, resetMs);
		},
	};
}

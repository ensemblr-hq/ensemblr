import { useEffect, useRef } from 'react';

/**
 * Jumps a conversation viewport to the newest message whenever `followKey`
 * changes. A prompt the user just sent has to land in view even when they were
 * reading further up — otherwise the composer empties and nothing visibly
 * happens. The first render is ignored so opening a tab still honours the
 * position it was left at.
 * @param input - The value to watch and the viewport's scroll-to-bottom action
 */
export function useConversationFollowKey({
	followKey,
	scrollToBottom,
}: {
	followKey: string | number | undefined;
	scrollToBottom: () => void;
}): void {
	const followedRef = useRef(followKey);

	useEffect(() => {
		if (followedRef.current === followKey) {
			return;
		}
		followedRef.current = followKey;
		if (followKey === undefined) {
			return;
		}
		scrollToBottom();
	}, [followKey, scrollToBottom]);
}

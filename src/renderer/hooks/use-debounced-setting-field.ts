import { useEffect, useRef, useState } from 'react';

/**
 * Local text state seeded from a persisted value that commits edits on a
 * debounce and re-seeds only when the persisted value changes for an external
 * reason — never on the component's own just-saved echo, so typing is not
 * interrupted when the save round-trips back through the resolver.
 *
 * @param seed - The persisted value to hydrate from and re-sync to.
 * @param commit - Persists the debounced value and returns the canonical string the next `seed` will echo back.
 * @param delayMs - Debounce window before committing an edit.
 * @returns The controlled `value` and an `onChange` handler for the input.
 */
export function useDebouncedSettingField(
	seed: string,
	commit: (next: string) => string,
	delayMs: number,
): { value: string; onChange: (next: string) => void } {
	const [value, setValue] = useState(seed);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastCommittedRef = useRef(seed);

	useEffect(() => {
		if (seed === lastCommittedRef.current) {
			return;
		}
		lastCommittedRef.current = seed;
		setValue(seed);
	}, [seed]);

	useEffect(() => {
		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, []);

	const onChange = (next: string) => {
		setValue(next);
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			lastCommittedRef.current = commit(next);
		}, delayMs);
	};

	return { onChange, value };
}

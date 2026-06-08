import { useAtomValue } from 'jotai';
import { useEffect } from 'react';

import { themeAtom } from '@/renderer/state/preferences/atoms';

/** Applies the active theme class to the document root and reacts to OS changes when `system`. */
export function useThemeEffect(): void {
	const theme = useAtomValue(themeAtom);

	useEffect(() => {
		const root = document.documentElement;
		const media = window.matchMedia('(prefers-color-scheme: dark)');

		const apply = (): void => {
			root.classList.remove('dark', 'light');
			if (theme === 'system') {
				root.classList.add(media.matches ? 'dark' : 'light');
				return;
			}
			root.classList.add(theme);
		};

		apply();

		if (theme !== 'system') return;
		media.addEventListener('change', apply);
		return () => media.removeEventListener('change', apply);
	}, [theme]);
}

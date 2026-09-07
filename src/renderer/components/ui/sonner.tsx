import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useColorMode } from '@/renderer/hooks/preferences/use-color-mode';

/**
 * App-wide toast surface, painted in the mode the app is actually in.
 *
 * `theme='system'` would resolve from `prefers-color-scheme`, which reports the
 * OS scheme rather than the user's theme setting — nothing sets
 * `nativeTheme.themeSource`. The toast's own surface comes from `--popover`,
 * which follows the root theme class, so an OS-dark machine pinned to a light
 * app got sonner's dark description grey on a light card.
 */
function Toaster(props: ToasterProps) {
	const colorMode = useColorMode();

	return (
		<Sonner
			className='toaster group'
			icons={{
				error: <OctagonXIcon className='size-4' />,
				info: <InfoIcon className='size-4' />,
				loading: <Loader2Icon className='size-4 animate-spin' />,
				success: <CircleCheckIcon className='size-4' />,
				warning: <TriangleAlertIcon className='size-4' />,
			}}
			style={
				{
					'--border-radius': 'var(--radius)',
					'--normal-bg': 'var(--popover)',
					'--normal-border': 'var(--border)',
					'--normal-text': 'var(--popover-foreground)',
				} as CSSProperties
			}
			theme={colorMode}
			toastOptions={{
				classNames: {
					// Sonner hardcodes the description colour per theme at a specificity
					// a bare class cannot reach, so the app token needs `!` to win.
					description: 'text-muted-foreground!',
				},
			}}
			{...props}
		/>
	);
}

export { Toaster };

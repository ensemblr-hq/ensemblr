import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import type { DemoRuntime } from './demo-runtime.ts';
import type { DemoTheme } from './scenario.ts';
import { DEMO_SCENARIOS } from './scenarios/index.ts';

/** Chord that shows and hides the toolbar, so it never sits in a capture. */
const TOGGLE_CHORD = { code: 'KeyD', meta: true };

/**
 * Applies a theme by swapping the root class the app's own CSS variables key
 * off, which is what the appearance setting does in the shipped app.
 * @param theme - Theme to show.
 */
function applyTheme(theme: DemoTheme): void {
	const root = document.documentElement;
	root.classList.toggle('dark', theme === 'dark');
	root.classList.toggle('light', theme === 'light');
}

/**
 * Overlay for composing a shot: pick the scenario, flip the theme, resize the
 * window to a preset, and pause or resume motion.
 *
 * Hidden by default and toggled with ⌘D, because a toolbar in frame is the one
 * thing a promotional screenshot must not contain. The capture script never
 * shows it.
 */
export function DemoToolbar({
	queryClient,
	runtime,
}: {
	queryClient: QueryClient;
	runtime: DemoRuntime;
}) {
	const [isVisible, setIsVisible] = useState(false);
	const [scenarioId, setScenarioId] = useState(runtime.authored.id);
	const [theme, setTheme] = useState<DemoTheme>(runtime.authored.theme);
	const [isFrozen, setIsFrozen] = useState(true);

	useEffect(() => {
		/**
		 * Toggles the toolbar on the chord.
		 * @param event - The originating keyboard event.
		 */
		function onKeyDown(event: KeyboardEvent): void {
			if (event.code === TOGGLE_CHORD.code && event.metaKey) {
				event.preventDefault();
				setIsVisible((visible) => !visible);
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, []);

	const selectScenario = useCallback(
		(id: string) => {
			const next = DEMO_SCENARIOS.find((scenario) => scenario.id === id);
			if (!next) {
				return;
			}
			setScenarioId(id);
			setTheme(next.theme);
			applyTheme(next.theme);
			runtime.apply(next, queryClient);
			void window.ensemblrDemo?.setContentSize(next.window);
		},
		[queryClient, runtime],
	);

	const selectTheme = useCallback((next: DemoTheme) => {
		setTheme(next);
		applyTheme(next);
	}, []);

	const toggleFrozen = useCallback(() => {
		setIsFrozen((frozen) => {
			document.documentElement.classList.toggle('demo-frozen', !frozen);
			return !frozen;
		});
	}, []);

	if (!isVisible) {
		return null;
	}

	return (
		<div className='demo-toolbar fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground text-xs shadow-lg'>
			{/* i18next-instrument-ignore */}
			<select
				className='rounded-sm bg-transparent outline-none'
				onChange={(event) => selectScenario(event.target.value)}
				value={scenarioId}
			>
				{DEMO_SCENARIOS.map((scenario) => (
					<option key={scenario.id} value={scenario.id}>
						{scenario.label}
					</option>
				))}
			</select>
			{/* i18next-instrument-ignore */}
			<button
				className='rounded-sm px-2 py-1 hover:bg-accent'
				onClick={() => selectTheme(theme === 'dark' ? 'light' : 'dark')}
				type='button'
			>
				{theme}
			</button>
			{/* i18next-instrument-ignore */}
			<button
				className='rounded-sm px-2 py-1 hover:bg-accent'
				onClick={toggleFrozen}
				type='button'
			>
				{isFrozen ? 'frozen' : 'live'}
			</button>
			{/* i18next-instrument-ignore */}
			<button
				className='rounded-sm px-2 py-1 hover:bg-accent'
				onClick={() => {
					setIsVisible(false);
					void window.ensemblrDemo?.capture(runtime.authored.id, theme);
				}}
				type='button'
			>
				shoot
			</button>
		</div>
	);
}

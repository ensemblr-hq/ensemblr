import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom } from '@/renderer/state/preferences';

import { findScene, type SceneId, SceneNav } from './playground-scenes.tsx';
import { PlaygroundSidebar, useSidebarToggle } from './playground-sidebar.tsx';
import {
	ControlGroup,
	SceneControlHostProvider,
	SceneToggle,
} from './scene-chrome.tsx';

const CANVAS_WIDTHS = [
	{ className: 'max-w-md', id: 'narrow', label: '448' },
	{ className: 'max-w-3xl', id: 'chat', label: '768' },
	{ className: 'max-w-none', id: 'full', label: 'full' },
] as const;

const THEMES = ['light', 'dark'] as const;

/**
 * Two families from Settings → Appearance → Code theme. Only syntax colours
 * come from the picked family — the surface under them follows the app theme —
 * so switching families here proves the setting reaches the tokens and nothing
 * else. Each family flips to its own light or dark cut with the theme toggle.
 */
const CODE_THEMES = ['catppuccin-mocha', 'github-dark'] as const;

/** Which of the app's two root theme classes the canvas is pinned to. */
type PlaygroundTheme = (typeof THEMES)[number];

/** How wide the canvas is held, named by the app surface it stands in for. */
type CanvasWidthId = (typeof CANVAS_WIDTHS)[number]['id'];

/**
 * Playground shell: scene navigation on the left, the themeable canvas in the
 * middle, and the controls for whatever that canvas is showing on the right.
 * Both sidebars collapse, because a scene under width review wants the room.
 * Nothing here ships with the app — it exists so components can be built and
 * eyeballed in a plain browser, without the Electron runtime.
 */
export function Playground() {
	const [width, setWidth] = useState<CanvasWidthId>('full');
	const [sceneId, setSceneId] = useState<SceneId>('app');
	const [theme, setTheme] = useState<PlaygroundTheme>('dark');
	const [codeTheme, setCodeThemeLabel] =
		useState<(typeof CODE_THEMES)[number]>('catppuccin-mocha');
	const [controlHost, setControlHost] = useState<HTMLDivElement | null>(null);
	const setCodeTheme = useSetAtom(codeThemeAtom);
	const scenes = useSidebarToggle('scenes', true);
	const controls = useSidebarToggle('controls', true);
	const canvasWidth =
		CANVAS_WIDTHS.find((candidate) => candidate.id === width) ??
		CANVAS_WIDTHS[1];
	const scene = findScene(sceneId);

	useEffect(() => {
		const root = document.documentElement;
		for (const candidate of THEMES) {
			root.classList.toggle(candidate, candidate === theme);
		}
	}, [theme]);

	return (
		<SceneControlHostProvider host={controlHost}>
			<div className='flex h-screen w-screen overflow-hidden bg-canvas text-foreground'>
				<PlaygroundSidebar
					isOpen={scenes.isOpen}
					label='scenes'
					onToggle={scenes.toggle}
					side='left'
				>
					<SceneNav onSceneChange={setSceneId} sceneId={sceneId} />
				</PlaygroundSidebar>

				<main className='flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden bg-canvas'>
					<div
						className={cn(
							'flex min-h-0 w-full flex-col overflow-y-auto p-6',
							canvasWidth.className,
						)}
					>
						{scene.render()}
					</div>
				</main>

				<PlaygroundSidebar
					isOpen={controls.isOpen}
					label='controls'
					onToggle={controls.toggle}
					side='right'
				>
					<p className='break-all font-mono text-muted-foreground text-xxs'>
						{scene.source}
					</p>
					<div
						className='flex flex-col gap-3 empty:hidden'
						ref={setControlHost}
					/>
					<CanvasControls
						codeTheme={codeTheme}
						onCodeThemeChange={(option) => {
							setCodeThemeLabel(option);
							setCodeTheme(option);
						}}
						onThemeChange={setTheme}
						onWidthChange={setWidth}
						theme={theme}
						width={width}
					/>
				</PlaygroundSidebar>
			</div>
		</SceneControlHostProvider>
	);
}

/**
 * Settings that belong to the canvas rather than to any one scene. They sit
 * below the scene's own controls and under a rule, so the split between "what
 * this screen can do" and "how the canvas is set up" stays readable.
 */
function CanvasControls({
	codeTheme,
	onCodeThemeChange,
	onThemeChange,
	onWidthChange,
	theme,
	width,
}: {
	codeTheme: (typeof CODE_THEMES)[number];
	onCodeThemeChange: (option: (typeof CODE_THEMES)[number]) => void;
	onThemeChange: (theme: PlaygroundTheme) => void;
	onWidthChange: (id: CanvasWidthId) => void;
	theme: PlaygroundTheme;
	width: CanvasWidthId;
}) {
	return (
		<div className='mt-auto flex flex-col gap-3 border-border border-t pt-3'>
			<ControlGroup label='width'>
				{CANVAS_WIDTHS.map((option) => (
					<SceneToggle
						isActive={option.id === width}
						key={option.id}
						label={option.label}
						onClick={() => onWidthChange(option.id)}
					/>
				))}
			</ControlGroup>
			<ControlGroup label='theme'>
				{THEMES.map((candidate) => (
					<SceneToggle
						isActive={candidate === theme}
						key={candidate}
						label={candidate}
						onClick={() => onThemeChange(candidate)}
					/>
				))}
			</ControlGroup>
			<ControlGroup label='code'>
				{CODE_THEMES.map((option) => (
					<SceneToggle
						isActive={option === codeTheme}
						key={option}
						label={option.replace(/-.*$/, '')}
						onClick={() => onCodeThemeChange(option)}
					/>
				))}
			</ControlGroup>
		</div>
	);
}

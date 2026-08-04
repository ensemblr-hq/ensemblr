import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

import { cn } from '@/renderer/lib/utils';
import { codeThemeAtom } from '@/renderer/state/preferences';

import { AnswerPreview } from './answer-preview.tsx';
import { ConversationScrollScene } from './conversation-scroll-preview.tsx';
import { FilePreviewScene } from './file-preview.tsx';
import { StartingStatePreview } from './starting-state-preview.tsx';
import { TabScrollerScene } from './tab-scroller-preview.tsx';
import { TimelinePreview } from './timeline-preview.tsx';
import { TurnSummaryPreview } from './turn-summary-preview.tsx';

const CANVAS_WIDTHS = [
	{ className: 'max-w-md', id: 'narrow', label: '448' },
	{ className: 'max-w-3xl', id: 'chat', label: '768' },
	{ className: 'max-w-none', id: 'full', label: 'full' },
] as const;

/**
 * Each scene drives the shipped components with real tool payloads, so what the
 * canvas shows is what the timeline renders rather than a parallel mock-up.
 */
const SCENES = [
	{
		id: 'app',
		label: 'app',
		render: () => <TimelinePreview />,
		source: 'playground/timeline-preview.tsx',
	},
	{
		id: 'answer',
		label: 'answer',
		render: () => <AnswerPreview />,
		source: 'playground/answer-preview.tsx',
	},
	{
		id: 'summary',
		label: 'summary',
		render: () => <TurnSummaryPreview />,
		source: 'playground/turn-summary-preview.tsx',
	},
	{
		id: 'file',
		label: 'file',
		render: () => <FilePreviewScene />,
		source: 'playground/file-preview.tsx',
	},
	{
		id: 'tabs',
		label: 'tabs',
		render: () => <TabScrollerScene />,
		source: 'playground/tab-scroller-preview.tsx',
	},
	{
		id: 'scroll',
		label: 'scroll',
		render: () => <ConversationScrollScene />,
		source: 'playground/conversation-scroll-preview.tsx',
	},
	{
		id: 'starting',
		label: 'starting',
		render: () => <StartingStatePreview />,
		source: 'playground/starting-state-preview.tsx',
	},
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

/**
 * Playground shell: a themeable, width-constrained canvas around the scene
 * previews. Nothing here ships with the app — it exists so timeline components
 * can be built and eyeballed in a plain browser, without the Electron runtime.
 */
export function Playground() {
	const [width, setWidth] =
		useState<(typeof CANVAS_WIDTHS)[number]['id']>('chat');
	const [sceneId, setSceneId] = useState<(typeof SCENES)[number]['id']>('app');
	const [theme, setTheme] = useState<PlaygroundTheme>('dark');
	const [codeTheme, setCodeThemeLabel] =
		useState<(typeof CODE_THEMES)[number]>('catppuccin-mocha');
	const setCodeTheme = useSetAtom(codeThemeAtom);
	const canvasWidth =
		CANVAS_WIDTHS.find((candidate) => candidate.id === width) ??
		CANVAS_WIDTHS[1];
	const scene =
		SCENES.find((candidate) => candidate.id === sceneId) ?? SCENES[0];

	useEffect(() => {
		const root = document.documentElement;
		for (const candidate of THEMES) {
			root.classList.toggle(candidate, candidate === theme);
		}
	}, [theme]);

	return (
		<div className='flex h-screen w-screen flex-col overflow-hidden bg-canvas text-foreground'>
			<header className='flex shrink-0 items-center gap-4 border-border border-b bg-toolbar px-4 py-2'>
				<span className='truncate font-mono text-muted-foreground text-xs'>
					{scene.source}
				</span>
				<div className='ml-auto flex items-center gap-2'>
					{SCENES.map((option) => (
						<ToolbarToggle
							isActive={option.id === sceneId}
							key={option.id}
							label={option.label}
							onClick={() => setSceneId(option.id)}
						/>
					))}
					{CODE_THEMES.map((option) => (
						<ToolbarToggle
							isActive={option === codeTheme}
							key={option}
							label={option.replace(/-.*$/, '')}
							onClick={() => {
								setCodeThemeLabel(option);
								setCodeTheme(option);
							}}
						/>
					))}
					{CANVAS_WIDTHS.map((option) => (
						<ToolbarToggle
							isActive={option.id === width}
							key={option.id}
							label={option.label}
							onClick={() => setWidth(option.id)}
						/>
					))}
					{THEMES.map((candidate) => (
						<ToolbarToggle
							isActive={candidate === theme}
							key={candidate}
							label={candidate}
							onClick={() => setTheme(candidate)}
						/>
					))}
				</div>
			</header>

			<div className='flex min-h-0 flex-1 justify-center overflow-hidden bg-canvas'>
				<div
					className={cn(
						'flex min-h-0 w-full flex-col overflow-y-auto bg-canvas p-6 text-foreground',
						canvasWidth.className,
					)}
				>
					{scene.render()}
				</div>
			</div>
		</div>
	);
}

/** Compact toolbar pill used for the width presets and the theme switch. */
function ToolbarToggle({
	isActive,
	label,
	onClick,
}: {
	isActive: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				'rounded-md border px-2 py-1 font-mono text-xxs transition-colors',
				isActive
					? 'border-border bg-surface text-foreground'
					: 'border-transparent text-muted-foreground hover:bg-accent/50',
			)}
			onClick={onClick}
			type='button'
		>
			{label}
		</button>
	);
}

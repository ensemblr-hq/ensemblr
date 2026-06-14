import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	PiSessionStatusBar,
	PiTimeline,
} from '@/renderer/components/pi-timeline';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/renderer/components/ui/select';
import {
	capturedLinesToInputs,
	createPiTimelineState,
	reducePiTimeline,
} from '@/renderer/lib/pi-timeline';
import type {
	PiTimelineInput,
	PiTimelineState,
} from '@/renderer/types/pi-timeline';
import type { PiCapturedLine } from '@/shared/pi-rpc';
import { piCapturedLineSchema } from '@/shared/pi-rpc';

/**
 * Raw fixture sources bundled at build time. Dev-only surface: the route that
 * mounts this view is guarded by `import.meta.env.DEV`.
 */
const FIXTURE_SOURCES = import.meta.glob(
	'/tests/fixtures/pi-captures/*.jsonl',
	{ eager: true, import: 'default', query: '?raw' },
) as Record<string, string>;

type ReplaySpeed = 1 | 4 | 'instant';

/** Parses one bundled fixture into captured lines, skipping bad rows. */
function parseFixture(rawText: string): readonly PiCapturedLine[] {
	const lines: PiCapturedLine[] = [];
	for (const row of rawText.split('\n')) {
		if (row.length === 0) {
			continue;
		}
		try {
			lines.push(piCapturedLineSchema.parse(JSON.parse(row)));
		} catch {
			// Capture wrapper rows are produced by our own script; skip anything
			// hand-mangled rather than failing the dev view.
		}
	}
	return lines;
}

/**
 * Dev-only fixture replay harness: loads any captured Pi RPC fixture and
 * replays it through the timeline reducer with the original inter-event
 * timing (1x), compressed timing (4x), or instantly — rendering the real
 * timeline components. Event timestamps are rebased to the wall clock at
 * replay start so streaming affordances (spinners, ticking timers) behave
 * exactly like a live session; at 1x the rendered durations match the
 * original capture.
 */
export function PiReplayView() {
	const fixtureNames = useMemo(
		() =>
			Object.keys(FIXTURE_SOURCES)
				.map((path) => path.split('/').at(-1) ?? path)
				.sort(),
		[],
	);
	const [fixtureName, setFixtureName] = useState(fixtureNames[0] ?? '');
	const [speed, setSpeed] = useState<ReplaySpeed>('instant');
	const [state, setState] = useState<PiTimelineState>(createPiTimelineState);
	const [running, setRunning] = useState(false);
	const runToken = useRef(0);

	const inputs = useMemo<readonly PiTimelineInput[]>(() => {
		const path = Object.keys(FIXTURE_SOURCES).find((key) =>
			key.endsWith(`/${fixtureName}`),
		);
		const source = path ? FIXTURE_SOURCES[path] : undefined;
		return source ? capturedLinesToInputs(parseFixture(source)) : [];
	}, [fixtureName]);

	const replay = useCallback(() => {
		runToken.current += 1;
		const token = runToken.current;
		if (speed === 'instant') {
			setRunning(false);
			setState(inputs.reduce(reducePiTimeline, createPiTimelineState()));
			return;
		}
		setState(createPiTimelineState());
		setRunning(true);
		const firstTs = inputs[0]?.atMs ?? 0;
		const startNow = Date.now();
		const timers: number[] = [];
		for (const input of inputs) {
			const delay = Math.max(0, (input.atMs - firstTs) / speed);
			const rebasedAtMs = startNow + delay;
			timers.push(
				window.setTimeout(() => {
					if (runToken.current !== token) {
						return;
					}
					setState((current) =>
						reducePiTimeline(current, {
							atMs: rebasedAtMs,
							event: input.event,
						}),
					);
				}, delay),
			);
		}
		const totalMs = Math.max(0, ((inputs.at(-1)?.atMs ?? 0) - firstTs) / speed);
		timers.push(
			window.setTimeout(() => {
				if (runToken.current === token) {
					setRunning(false);
				}
			}, totalMs),
		);
	}, [inputs, speed]);

	// Invalidate scheduled timers when the fixture or speed changes mid-run.
	useEffect(
		() => () => {
			runToken.current += 1;
		},
		[],
	);

	return (
		<div className='flex h-full min-h-0 flex-col bg-background text-foreground'>
			<header className='flex flex-wrap items-center gap-2 border-border/40 border-b px-4 py-2'>
				<span className='font-medium text-sm'>Pi fixture replay</span>
				<Badge variant='outline'>dev</Badge>
				<Select onValueChange={setFixtureName} value={fixtureName}>
					<SelectTrigger className='h-8 w-60 text-xs' size='sm'>
						<SelectValue placeholder='fixture' />
					</SelectTrigger>
					<SelectContent>
						{fixtureNames.map((name) => (
							<SelectItem key={name} value={name}>
								{name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className='flex items-center gap-1'>
					{([1, 4, 'instant'] as const).map((option) => (
						<Button
							key={String(option)}
							onClick={() => setSpeed(option)}
							size='sm'
							variant={speed === option ? 'secondary' : 'ghost'}
						>
							{option === 'instant' ? 'instant' : `${option}x`}
						</Button>
					))}
				</div>
				<Button onClick={replay} size='sm' variant='default'>
					{running ? 'Restart' : 'Replay'}
				</Button>
				<span className='text-muted-foreground text-xs'>
					{inputs.length} events
				</span>
			</header>
			<PiTimeline state={state} />
			<PiSessionStatusBar session={state.session} />
		</div>
	);
}

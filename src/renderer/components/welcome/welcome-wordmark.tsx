import { useEffect, useState } from 'react';

import { cn } from '@/renderer/lib/utils';

const GLYPHS: Record<string, readonly string[]> = {
	B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
	E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
	L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
	M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
	N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
	S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
};

const WORD = 'ENSEMBLE';
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const LETTER_GAP = 1;
const TOTAL_WIDTH = WORD.length * GLYPH_WIDTH + (WORD.length - 1) * LETTER_GAP;
const PIXEL_INSET = 0.1;
const PIXEL_SIZE = 1 - PIXEL_INSET * 2;

const FLICKER_CYCLE_MIN = 12;
const FLICKER_CYCLE_RANGE = 8;
const FLICKER_DELAY_RANGE = 16;
const BURST_INTERVAL_MIN_MS = 9000;
const BURST_INTERVAL_RANGE_MS = 8000;
const BURST_DURATION_MIN_MS = 260;
const BURST_DURATION_RANGE_MS = 200;

interface PixelRect {
	x: number;
	y: number;
	flickerDelay: number;
	flickerDuration: number;
}

function buildPixels(): PixelRect[] {
	const pixels: PixelRect[] = [];
	for (let letterIndex = 0; letterIndex < WORD.length; letterIndex += 1) {
		const glyph = GLYPHS[WORD[letterIndex]];
		if (!glyph) {
			continue;
		}
		const baseX = letterIndex * (GLYPH_WIDTH + LETTER_GAP);
		for (let row = 0; row < glyph.length; row += 1) {
			const rowData = glyph[row];
			for (let col = 0; col < rowData.length; col += 1) {
				if (rowData[col] === '1') {
					pixels.push({
						flickerDelay: Math.random() * FLICKER_DELAY_RANGE,
						flickerDuration:
							FLICKER_CYCLE_MIN + Math.random() * FLICKER_CYCLE_RANGE,
						x: baseX + col,
						y: row,
					});
				}
			}
		}
	}
	return pixels;
}

const PIXELS = buildPixels();

const KEYFRAMES = `
@keyframes ensemble-wordmark-flicker {
  0%, 100% { opacity: 1; }
  48% { opacity: 1; }
  49% { opacity: 0.15; }
  50% { opacity: 0.85; }
  51% { opacity: 1; }
  76% { opacity: 1; }
  77% { opacity: 0.4; }
  78% { opacity: 1; }
}
`;

interface GhostLayerProps {
	color: string;
	offset: number;
	visible: boolean;
}

function GhostLayer({ color, offset, visible }: GhostLayerProps) {
	return (
		<svg
			aria-hidden='true'
			className='pointer-events-none absolute inset-0 h-full w-full'
			shapeRendering='crispEdges'
			style={{
				color,
				opacity: visible ? 0.75 : 0,
				transform: `translateX(${visible ? offset : 0}px)`,
				transition:
					'opacity 70ms ease-out, transform 70ms cubic-bezier(.2,.7,.2,1)',
			}}
			viewBox={`0 0 ${TOTAL_WIDTH} ${GLYPH_HEIGHT}`}
			xmlns='http://www.w3.org/2000/svg'
		>
			{PIXELS.map((pixel) => (
				<rect
					fill='currentColor'
					height={PIXEL_SIZE}
					key={`${pixel.x}-${pixel.y}`}
					width={PIXEL_SIZE}
					x={pixel.x + PIXEL_INSET}
					y={pixel.y + PIXEL_INSET}
				/>
			))}
		</svg>
	);
}

/** Dot-matrix wordmark used by the dashboard welcome screen. */
export function WelcomeWordmark({ className }: { className?: string }) {
	const [glitching, setGlitching] = useState(false);

	useEffect(() => {
		if (
			typeof window === 'undefined' ||
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		) {
			return;
		}

		let cancelled = false;
		let burstTimeoutId: number | undefined;
		let releaseTimeoutId: number | undefined;

		const scheduleNextBurst = () => {
			if (cancelled) {
				return;
			}
			const wait =
				BURST_INTERVAL_MIN_MS + Math.random() * BURST_INTERVAL_RANGE_MS;
			burstTimeoutId = window.setTimeout(() => {
				if (cancelled) {
					return;
				}
				setGlitching(true);
				const duration =
					BURST_DURATION_MIN_MS + Math.random() * BURST_DURATION_RANGE_MS;
				releaseTimeoutId = window.setTimeout(() => {
					if (cancelled) {
						return;
					}
					setGlitching(false);
					scheduleNextBurst();
				}, duration);
			}, wait);
		};

		scheduleNextBurst();

		return () => {
			cancelled = true;
			if (burstTimeoutId !== undefined) {
				window.clearTimeout(burstTimeoutId);
			}
			if (releaseTimeoutId !== undefined) {
				window.clearTimeout(releaseTimeoutId);
			}
		};
	}, []);

	return (
		<span
			aria-label='Ensemble'
			className={cn(
				'relative inline-flex h-16 text-foreground sm:h-20',
				className,
			)}
			role='img'
			style={{ aspectRatio: `${TOTAL_WIDTH} / ${GLYPH_HEIGHT}` }}
		>
			<style>{KEYFRAMES}</style>
			<GhostLayer color='#ff2e63' offset={-3} visible={glitching} />
			<GhostLayer color='#22d3ee' offset={3} visible={glitching} />
			<svg
				aria-hidden='true'
				className='relative h-full w-full'
				shapeRendering='crispEdges'
				style={{
					transform: glitching ? 'translateX(1px) skewX(-2deg)' : 'none',
					transition: 'transform 70ms cubic-bezier(.2,.7,.2,1)',
				}}
				viewBox={`0 0 ${TOTAL_WIDTH} ${GLYPH_HEIGHT}`}
				xmlns='http://www.w3.org/2000/svg'
			>
				<title>Ensemble</title>
				{PIXELS.map((pixel) => (
					<rect
						fill='currentColor'
						height={PIXEL_SIZE}
						key={`${pixel.x}-${pixel.y}`}
						style={{
							animation: `ensemble-wordmark-flicker ${pixel.flickerDuration}s linear ${pixel.flickerDelay}s infinite`,
						}}
						width={PIXEL_SIZE}
						x={pixel.x + PIXEL_INSET}
						y={pixel.y + PIXEL_INSET}
					/>
				))}
			</svg>
		</span>
	);
}

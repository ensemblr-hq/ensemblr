const SCAN_COLUMNS = 44;
const SCAN_ROWS = 7;
const PIXEL_INSET = 0.1;
const PIXEL_SIZE = 1 - PIXEL_INSET * 2;
const SWEEP_DURATION_S = 2.6;
const COLUMN_STAGGER_S = 0.04;
const ROW_JITTER_S = 0.07;
const MIN_FILL_OPACITY = 0.25;
const FILL_OPACITY_RANGE = 0.75;

const KEYFRAMES = `
@keyframes ensemblr-boot-scan {
  0%, 100% { opacity: 0.22; }
  40% { opacity: 0.28; }
  50% { opacity: 1; }
  60% { opacity: 0.28; }
}

[data-role="boot-scan"] rect {
  animation: ensemblr-boot-scan ${SWEEP_DURATION_S}s linear var(--scan-delay) infinite;
}

@media (prefers-reduced-motion: reduce) {
  [data-role="boot-scan"] rect {
    animation: none;
    opacity: 0.4;
  }
}
`;

/** A single cell of the boot scan grid, with its position in the sweep. */
interface ScanPixel {
	delay: number;
	fillOpacity: number;
	x: number;
	y: number;
}

/**
 * Deterministic hash in `[0, 1)` so the grid's texture and ragged sweep edge stay
 * identical across renders instead of reshuffling on every mount.
 * @param seed - Any number identifying the cell
 * @returns A stable pseudo-random value between 0 and 1
 */
function pseudoRandom(seed: number): number {
	const scaled = Math.sin(seed * 12.9898) * 43758.5453;
	return scaled - Math.floor(scaled);
}

/**
 * Build the scan grid: every cell carries a negative animation delay so the sweep
 * is already mid-flight on the first frame, plus per-cell jitter that keeps the
 * crest edge ragged like the wordmark's flicker rather than a clean progress bar.
 * @returns The grid cells in row-major order
 */
function buildScanPixels(): ScanPixel[] {
	const pixels: ScanPixel[] = [];
	for (let y = 0; y < SCAN_ROWS; y += 1) {
		for (let x = 0; x < SCAN_COLUMNS; x += 1) {
			const noise = pseudoRandom(y * SCAN_COLUMNS + x);
			pixels.push({
				delay: -(x * COLUMN_STAGGER_S + noise * ROW_JITTER_S),
				fillOpacity: MIN_FILL_OPACITY + noise * FILL_OPACITY_RANGE,
				x,
				y,
			});
		}
	}
	return pixels;
}

const SCAN_PIXELS = buildScanPixels();

/**
 * Dot-matrix strip whose lit band sweeps left to right, borrowing the wordmark's
 * pixel grid so a booting agent reads as the same machine as the rest of the app.
 * Tinted with the theme accent so it follows whichever palette is active.
 */
function BootScan() {
	return (
		<svg
			aria-hidden='true'
			className='h-7 text-accent-strong'
			data-role='boot-scan'
			shapeRendering='crispEdges'
			style={{ aspectRatio: `${SCAN_COLUMNS} / ${SCAN_ROWS}` }}
			viewBox={`0 0 ${SCAN_COLUMNS} ${SCAN_ROWS}`}
			xmlns='http://www.w3.org/2000/svg'
		>
			<style>{KEYFRAMES}</style>
			{SCAN_PIXELS.map((pixel) => (
				<rect
					fill='currentColor'
					fillOpacity={pixel.fillOpacity}
					height={PIXEL_SIZE}
					key={`${pixel.x}-${pixel.y}`}
					style={{ '--scan-delay': `${pixel.delay}s` } as React.CSSProperties}
					width={PIXEL_SIZE}
					x={pixel.x + PIXEL_INSET}
					y={pixel.y + PIXEL_INSET}
				/>
			))}
		</svg>
	);
}

/**
 * Startup affordance for a transcript that has nothing to show yet — a spawned
 * sub-agent whose runtime is still booting, or a session whose events are still
 * being read. Sits top-left in the same column the settled timeline uses, so the
 * first real message lands where the placeholder was instead of jumping.
 */
export function TimelineStartingState({ label }: { label: string }) {
	return (
		<div className='mx-auto w-full max-w-3xl px-4 pt-5 pb-5'>
			<div className='inline-flex flex-col items-start gap-2.5 rounded-md bg-muted/50 px-3 py-2.5'>
				<BootScan />
				<p className='flex items-center gap-1.5 font-mono text-muted-foreground text-xs'>
					<span>{label}</span>
					<span
						aria-hidden='true'
						className='inline-block h-3 w-1.5 animate-pulse bg-muted-foreground/70 motion-reduce:animate-none'
					/>
				</p>
			</div>
		</div>
	);
}

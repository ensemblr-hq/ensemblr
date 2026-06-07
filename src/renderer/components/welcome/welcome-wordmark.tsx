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

interface PixelRect {
	x: number;
	y: number;
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
					pixels.push({ x: baseX + col, y: row });
				}
			}
		}
	}
	return pixels;
}

const PIXELS = buildPixels();

/** Dot-matrix wordmark used by the dashboard welcome screen. */
export function WelcomeWordmark({ className }: { className?: string }) {
	return (
		<svg
			aria-label='Ensemble'
			className={cn('h-16 w-auto text-foreground sm:h-20', className)}
			role='img'
			shapeRendering='crispEdges'
			viewBox={`0 0 ${TOTAL_WIDTH} ${GLYPH_HEIGHT}`}
			xmlns='http://www.w3.org/2000/svg'
		>
			<title>Ensemble</title>
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

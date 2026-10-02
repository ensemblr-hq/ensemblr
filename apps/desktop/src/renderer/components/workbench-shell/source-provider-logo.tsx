import type { ComponentProps } from 'react';

// Brand marks (simple-icons), rendered inline so they work offline without
// pulling a full icon set into the bundle.
const GITHUB_PATH =
	'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
const LINEAR_PATH =
	'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z';
// Infisical's own mark, which simple-icons does not carry; the monochrome path
// is the one published by selfh.st/icons (CC BY 4.0) and is drawn on a 512 grid
// rather than the 24 the simple-icons paths above use.
const INFISICAL_PATH =
	'M477.8 173.6c-22.1-22.2-51.5-34.5-82.7-34.5c-29.5 0-59.5 12.8-89.4 38.1c-21.2 17.9-38 38.6-49.7 55.2c-10.2-13.7-26.2-33.2-46.6-51.3c-14.9-13.4-29.8-23.9-44.2-31.2c-16.7-8.5-32.9-12.8-48-12.8c-31.3 0-60.8 12.2-82.9 34.5S0 223.5 0 255s12.2 61.2 34.3 83.5c22.2 22.2 51.6 34.5 82.9 34.5c35.4 0 70.7-25.2 94.1-46.3c20.5-18.6 35.9-37.5 45-49.7c16.2 22.3 35 46.1 55.4 63.9c26.7 23.3 53.2 34.1 83.4 34.1c31.2 0 60.5-12.3 82.7-34.6c22.1-22.2 34.3-51.9 34.3-83.4s-12.2-61.1-34.3-83.4M180.8 293c-24.4 22-47.5 34.6-63.6 34.6c-39.6 0-71.8-32.6-71.8-72.6s32.2-72.6 71.8-72.6c16.5 0 38.5 11.6 62 32.5c12.6 11.2 25.5 25.3 36.9 40c-10.5 13.4-23 27-35.3 38.1M395 329.5c-18.8 0-35.4-7-53.6-22.9C328 295 314.1 279 296 254.5c12.1-16.6 25.4-31.2 39-42.9c21.1-17.8 41.9-27.3 60-27.3c39.5 0 71.6 32.6 71.6 72.6s-32.1 72.6-71.6 72.6';

/** Generic SVG brand glyph wrapping the given path with currentColor fill. */
function BrandGlyph({
	path,
	viewBox = '0 0 24 24',
	...props
}: { path: string } & ComponentProps<'svg'>) {
	return (
		<svg
			aria-hidden='true'
			fill='currentColor'
			role='presentation'
			viewBox={viewBox}
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		>
			<path d={path} />
		</svg>
	);
}

/** Inline GitHub brand glyph (simple-icons path). */
export function GithubLogo(props: ComponentProps<'svg'>) {
	return <BrandGlyph path={GITHUB_PATH} {...props} />;
}

/** Inline Linear brand glyph (simple-icons path). */
export function LinearLogo(props: ComponentProps<'svg'>) {
	return <BrandGlyph path={LINEAR_PATH} {...props} />;
}

/** Inline Infisical brand glyph. */
export function InfisicalLogo(props: ComponentProps<'svg'>) {
	return <BrandGlyph path={INFISICAL_PATH} viewBox='0 0 512 512' {...props} />;
}

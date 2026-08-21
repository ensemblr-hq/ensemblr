import { defineConfig } from 'i18next-cli';

/**
 * i18next-cli configuration driving `npm run i18n:{extract,types,status,lint}`.
 *
 * English is extracted from the `t('key', 'Default English')` call sites and
 * never hand-written, so the catalogue cannot drift from the code; `ru` and `el`
 * are filled in per slice against the generated skeleton, including the CLDR
 * plural forms `extract` writes for each locale.
 */
export default defineConfig({
	locales: ['en', 'ru', 'el'],

	extract: {
		input: ['src/renderer/**/*.{ts,tsx}'],
		ignore: [
			// Vendored shadcn primitives, except `button.tsx`: this repo extended it
			// with a `pending` state whose screen-reader label is first-party copy.
			'src/renderer/components/ui/!(button).{ts,tsx}',
			'src/renderer/routing/routeTree.gen.ts',
			'src/renderer/fixtures/**',
			// Type-only, and `i18next.d.ts` documents a `t()` call in prose the
			// extractor would otherwise mistake for a call site.
			'src/renderer/types/**',
		],
		output: 'src/renderer/lib/i18n/locales/{{language}}/{{namespace}}.json',
		defaultNS: 'common',
		primaryLanguage: 'en',
		functions: ['t', 'i18n.t'],
		transComponents: ['Trans'],
		keySeparator: '.',
		nsSeparator: ':',
		pluralSeparator: '_',
		contextSeparator: '_',
		indentation: 2,
		sort: true,
	},

	lint: {
		// The wordmark renders the product name as SVG pixel rects; its only two
		// strings are the accessible name for that logo, which never translates.
		ignore: ['src/renderer/components/welcome/welcome-wordmark.tsx'],
		checkInterpolationParams: true,
		checkConcatenation: 'error',
	},

	types: {
		input: ['src/renderer/lib/i18n/locales/en/*.json'],
		basePath: 'src/renderer/lib/i18n/locales/en',
		output: 'src/renderer/types/i18next.d.ts',
	},
});

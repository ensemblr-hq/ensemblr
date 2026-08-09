// Global Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) on
// Vitest's `expect`. Safe under the default `node` environment — the matchers
// only touch the DOM when invoked, which only happens in happy-dom test files.
// @testing-library/react auto-unmounts after each test because `globals: true`.
// The language is pinned to English before every test so the ~200 DOM tests
// asserting English literals neither depend on the developer's system language
// nor leak a `changeLanguage` from one test into the next.
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

import { i18n } from '@/renderer/lib/i18n';

beforeEach(async () => {
	await i18n.changeLanguage('en');
});

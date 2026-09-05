// Global Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) on
// Vitest's `expect`. Safe under the default `node` environment — the matchers
// only touch the DOM when invoked, which only happens in happy-dom test files.
// @testing-library/react auto-unmounts after each test because `globals: true`.
// The language is pinned to English before every test so the ~200 DOM tests
// asserting English literals neither depend on the developer's system language
// nor leak a `changeLanguage` from one test into the next.
//
// Web storage is emptied on the same beat, and it is a real leak rather than
// belt-and-braces: happy-dom ships no `localStorage`, so under a Node that has
// none either the renderer's `atomWithStorage` atoms are hermetic by accident.
// Node 24 — the version this repo pins and CI runs — exposes Web Storage as a
// *process* global, which Vitest's happy-dom environment then puts on `window`.
// A process global outlives `isolate: true` (that resets modules, not the
// process), so without this a per-chat toggle written by one test is read back
// by the next one, and by the next file in the same worker. It runs before any
// hook a test file registers, so a file that installs or seeds its own storage
// still wins.
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

import { i18n } from '@/renderer/lib/i18n';

beforeEach(async () => {
	await i18n.changeLanguage('en');
	globalThis.localStorage?.clear();
	globalThis.sessionStorage?.clear();
});

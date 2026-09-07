// Global Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) on
// Vitest's `expect`. Safe under the default `node` environment — the matchers
// only touch the DOM when invoked, which only happens in happy-dom test files.
// @testing-library/react auto-unmounts after each test because `globals: true`.
// The language is pinned to English before every test so the ~200 DOM tests
// asserting English literals neither depend on the developer's system language
// nor leak a `changeLanguage` from one test into the next.
//
// Web storage is installed fresh on the same beat, rather than emptied, so that
// the host Node stops deciding whether the renderer's `atomWithStorage` atoms
// have a store at all — see `./web-storage`. Installing also settles what
// borrowing one leaks, which differs by where the borrowed store lives: under
// `isolate: true` Vitest builds a fresh happy-dom `Window` per file (it resets
// modules and the environment, not the process), so on Node 24 a per-chat toggle
// written by one test was read back by the next test in that file, while Node
// 26's `sessionStorage` belongs to the process and carried into the next file in
// the same worker. It runs before any hook a test file registers, so a file that
// installs or seeds its own storage still wins.
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

import { i18n } from '@/renderer/lib/i18n';
import { installWebStorage } from './web-storage';

beforeEach(async () => {
	await i18n.changeLanguage('en');
	installWebStorage();
});

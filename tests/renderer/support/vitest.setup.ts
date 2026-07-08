// Global Vitest setup: registers jest-dom matchers (toBeInTheDocument, etc.) on
// Vitest's `expect`. Safe under the default `node` environment — the matchers
// only touch the DOM when invoked, which only happens in happy-dom test files.
// @testing-library/react auto-unmounts after each test because `globals: true`.
import '@testing-library/jest-dom/vitest';

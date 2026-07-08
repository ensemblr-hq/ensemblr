import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Side-effect module: registers window/document globals. Import this BEFORE any
// module that touches the DOM (e.g. @testing-library/react) so it evaluates
// first. Idempotent across repeated imports within one bun-test process.
const globalState = globalThis as { __happyDomRegistered?: boolean };
if (!globalState.__happyDomRegistered) {
	GlobalRegistrator.register();
	globalState.__happyDomRegistered = true;
}

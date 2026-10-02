import { describe, expect, it } from 'vitest';

import { CONTROL_ENV_KEYS } from '../../src/main/agent-control/control-env-keys.ts';
import { BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG } from '../../src/main/environment/environment-variable-catalog.ts';
import { isReservedEnvironmentVariableKey } from '../../src/main/environment/environment-variable-keys.ts';
import { readExtensionSource } from './support/pi-extension-source.ts';

/** The built-in catalog as the environment layers consult it. */
const catalogByKey = new Map(
	BUILT_IN_ENVIRONMENT_VARIABLE_CATALOG.map((entry) => [entry.key, entry]),
);

// Nothing but the order of two object spreads kept a repository from setting
// these: `ENSEMBLR_CONTROL_URL` decides where the shipped Pi extension posts its
// bearer token, and `readEnvFileLayer`, `readInfisicalLayer` and `readPlainLayer`
// would all have emitted a repository-declared value into a terminal's
// environment. Reserving them makes every layer skip them by construction, which
// is the mechanism already protecting `ENSEMBLR_WORKSPACE_PATH`.
describe('the agent-control environment keys are reserved', () => {
	it('names all six keys', () => {
		expect([...CONTROL_ENV_KEYS].sort()).toEqual([
			'ENSEMBLR_CONTROL_ARCHITECTURE',
			'ENSEMBLR_CONTROL_DEPTH',
			'ENSEMBLR_CONTROL_ROLE',
			'ENSEMBLR_CONTROL_TOKEN',
			'ENSEMBLR_CONTROL_TUI_HARNESSES',
			'ENSEMBLR_CONTROL_URL',
		]);
	});

	it.each([...CONTROL_ENV_KEYS])('refuses a declared %s', (key) => {
		expect(catalogByKey.get(key)?.reserved).toBe(true);
		expect(isReservedEnvironmentVariableKey(key, catalogByKey)).toBe(true);
	});

	it('leaves an ordinary key settable', () => {
		expect(isReservedEnvironmentVariableKey('DEBUG', catalogByKey)).toBe(false);
	});
});

// The extension is the component that would leak the token if the reservation
// ever broke — it posts every call, `Authorization` header included, to whatever
// `ENSEMBLR_CONTROL_URL` names — so it refuses a non-loopback URL itself rather
// than trusting the layer that assembled its environment. Source assertions,
// because the file cannot be imported here: it resolves Pi's own modules at load.
describe('the shipped extension refuses a redirected control URL', () => {
	it('reads the URL through a loopback check', () => {
		const source = readExtensionSource();
		expect(source).toMatch(
			/const CONTROL_URL = readLoopbackControlUrl\(\s*process\.env\.ENSEMBLR_CONTROL_URL,?\s*\)/,
		);
		expect(source).toMatch(
			/parsed\.protocol === 'http:' &&\s*LOOPBACK_HOSTNAMES\.has\(parsed\.hostname\.toLowerCase\(\)\)/,
		);
	});

	it('names every loopback host and nothing else', () => {
		const declaration =
			/const LOOPBACK_HOSTNAMES = new Set\((.*)\);/.exec(
				readExtensionSource(),
			)?.[1] ?? '';

		expect(
			[...declaration.matchAll(/'([^']+)'/g)].map((entry) => entry[1]).sort(),
		).toEqual(['127.0.0.1', '::1', '[::1]', 'localhost']);
	});

	it('caps the response body it accumulates', () => {
		const source = readExtensionSource();
		expect(source).toMatch(/const MAX_CONTROL_RESPONSE_BYTES = [0-9_]+;/);
		expect(source).toMatch(
			/if \(total > MAX_CONTROL_RESPONSE_BYTES\) \{\s*res\.destroy\(\);/,
		);
	});
});

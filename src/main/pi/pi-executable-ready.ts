import type { PiExecutableSnapshot } from './pi-executable';

/** True when the Pi executable snapshot is good enough to run readiness checks. */
export function isExecutableReady(executable: PiExecutableSnapshot): boolean {
	return Boolean(executable.command) && executable.status !== 'error';
}

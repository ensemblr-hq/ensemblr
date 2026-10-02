/** Minimum Pi release that emits the definitive `agent_settled` lifecycle event. */
export const MINIMUM_PI_VERSION = '0.80.4' as const;

/** Parsed semantic version components from a Pi version probe. */
export interface PiVersion {
	major: number;
	minor: number;
	patch: number;
}

/** Reads a semantic version from Pi's version probe output. */
export function parsePiVersion(output: string): PiVersion | null {
	const match = output.match(
		/\b(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?\b/,
	);
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

/** Reports whether a parsed Pi version supports Ensemblr's lifecycle contract. */
export function isSupportedPiVersion(version: PiVersion): boolean {
	return (
		version.major > 0 ||
		(version.major === 0 &&
			(version.minor > 80 || (version.minor === 80 && version.patch >= 4)))
	);
}

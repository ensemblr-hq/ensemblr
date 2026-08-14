/**
 * Pure permission policy for the renderer's device access — no Electron
 * imports, so it stays unit-testable. The Electron glue (session permission
 * handlers) lives in {@link file://./media-permissions.ts} and builds on these
 * decisions.
 */

/**
 * Capabilities the renderer may ask for, beyond the audio-only `media` request
 * composer dictation needs.
 *
 * `clipboard-sanitized-write` is not optional: every Copy control in the app
 * goes through `navigator.clipboard.write`/`writeText`, and Chromium routes
 * those through the permission system, so denying it turns each of them into a
 * silent `NotAllowedError`. Clipboard *reads* are not listed — nothing pastes
 * through the API, and the paste event carries its own data.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

/**
 * The one capability that carries media kinds. Composer dictation needs the
 * microphone; camera and screen capture have no feature behind them.
 */
const MEDIA_PERMISSION = 'media';

/** Media kinds the `media` permission may cover. Video capture is never granted. */
const ALLOWED_MEDIA_TYPES = new Set(['audio']);

/**
 * Decides whether a permission request or check may proceed. Anything not named
 * here — camera, screen capture, geolocation, notifications, MIDI, USB, HID,
 * Bluetooth — is refused rather than left to Electron's permissive default. A
 * `media` request must name at least one media kind and may name only audio, so
 * a request that also asks for the camera is refused whole rather than silently
 * downgraded.
 *
 * Electron reports the kinds as an array on a request (`mediaTypes`) and as a
 * single value on a check (`mediaType`); callers normalize to an array first.
 * @param permission - Electron's permission name for the request
 * @param mediaTypes - Media kinds the caller wants, when the permission carries any
 * @returns True when the request may be granted
 */
export function isPermissionGranted(
	permission: string,
	mediaTypes: readonly string[] | undefined,
): boolean {
	if (ALLOWED_PERMISSIONS.has(permission)) {
		return true;
	}

	if (permission !== MEDIA_PERMISSION) {
		return false;
	}

	return (
		Array.isArray(mediaTypes) &&
		mediaTypes.length > 0 &&
		mediaTypes.every((mediaType) => ALLOWED_MEDIA_TYPES.has(mediaType))
	);
}

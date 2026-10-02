import type { Session } from 'electron';

import { isPermissionGranted } from './media-permissions-policy';

/**
 * Installs the session's permission handlers so the renderer can reach the
 * microphone for composer dictation and nothing else.
 *
 * Electron's default is to grant most permissions to the app's own content, so
 * this narrows rather than widens: without it, a compromised renderer could ask
 * for the camera or screen capture and be handed them. macOS TCC still gates the
 * microphone on top of this — the packaged app needs both the
 * `com.apple.security.device.audio-input` entitlement and the
 * `NSMicrophoneUsageDescription` Info.plist key, or the first `getUserMedia`
 * call terminates the process rather than prompting.
 *
 * @param session - The session backing the app's window.
 */
export function restrictMediaPermissions(session: Session): void {
	session.setPermissionRequestHandler(
		(_webContents, permission, callback, details) => {
			callback(
				isPermissionGranted(
					permission,
					(details as { mediaTypes?: string[] } | undefined)?.mediaTypes,
				),
			);
		},
	);

	session.setPermissionCheckHandler(
		(_webContents, permission, _origin, details) => {
			const mediaType = (details as { mediaType?: string } | undefined)
				?.mediaType;
			return isPermissionGranted(
				permission,
				mediaType === undefined ? undefined : [mediaType],
			);
		},
	);
}

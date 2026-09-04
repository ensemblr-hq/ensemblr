import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { app, BrowserWindow, ipcMain } from 'electron';

import { resolveWindowChromeOptions } from '../src/main/app/window-chrome.ts';

const execFileAsync = promisify(execFile);

/**
 * Product name for the demo window.
 *
 * This is what keeps demo mode away from the real app's state: Electron derives
 * `userData` from it, so the demo window reads and writes its own directory and
 * can touch neither the installed app's nor the dev build's localStorage,
 * window bounds, or recents.
 */
const DEMO_APP_NAME = 'Ensemblr Demo';

/** Where captures land, relative to the repository root. */
const CAPTURE_DIRECTORY = 'out/demo';

/** How long a shoot waits for the renderer to settle before giving up on it. */
const READY_TIMEOUT_MS = 20_000;

/** How often the shoot re-checks the renderer's readiness attribute. */
const READY_POLL_MS = 200;

/**
 * Pause between focusing the window and capturing it. `screencapture -l`
 * photographs the window server's current composition, which has not caught up
 * with a focus change issued in the same tick.
 */
const FOCUS_SETTLE_MS = 700;

/**
 * Reads the URL the demo renderer's Vite dev server is listening on. The
 * launcher passes it rather than the window guessing a port.
 * @returns The dev server URL.
 */
function readRendererUrl(): string {
	const url = process.env.ENSEMBLR_DEMO_URL;
	if (!url) {
		throw new Error('ENSEMBLR_DEMO_URL was not set by the demo launcher.');
	}
	return url;
}

/**
 * Creates the demo window with the same chrome options the real app constructs
 * its window with, so the traffic lights, the corner radius, and the content
 * insets are the shipped ones rather than an approximation.
 * @returns The demo window.
 */
function createDemoWindow(): BrowserWindow {
	const window = new BrowserWindow({
		...resolveWindowChromeOptions(process.platform, 'system'),
		backgroundColor: '#0b0808',
		height: 933,
		show: false,
		title: DEMO_APP_NAME,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: path.join(__dirname, 'demo-preload.js'),
		},
		width: 1496,
	});

	window.once('ready-to-show', () => window.show());
	void window.loadURL(readRendererUrl());
	return window;
}

/**
 * Captures the window including its native chrome.
 *
 * `webContents.capturePage` would return the content area alone — the traffic
 * lights, the corner radius, and the drop shadow are drawn by the compositor
 * outside it, and those are exactly what a desktop-app screenshot has to show.
 * `screencapture -l` addresses the real window, so it gets all three.
 * @param window - The window to capture.
 * @param fileName - Name of the PNG to write, without a directory.
 * @returns The path written, or null when the platform has no window capture.
 */
async function captureWindow(
	window: BrowserWindow,
	fileName: string,
): Promise<string | null> {
	const directory = path.resolve(process.cwd(), CAPTURE_DIRECTORY);
	mkdirSync(directory, { recursive: true });
	const target = path.join(directory, fileName);

	if (process.platform !== 'darwin') {
		const image = await window.webContents.capturePage();
		writeFileSync(target, image.toPNG());
		return target;
	}

	const windowId = window.getMediaSourceId().split(':')[1];
	if (!windowId) {
		return null;
	}
	await execFileAsync('screencapture', ['-o', '-x', '-l', windowId, target]);
	return target;
}

/**
 * Polls the renderer's readiness attribute until it appears or the deadline
 * passes.
 * @param window - Window whose renderer is being waited on.
 * @returns Whether the renderer marked itself ready in time.
 */
async function waitForRendererReady(window: BrowserWindow): Promise<boolean> {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const isReady = await window.webContents.executeJavaScript(
			"document.documentElement.hasAttribute('data-demo-ready')",
		);
		if (isReady) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
	}
	return false;
}

/**
 * Waits for the renderer to mark itself ready, then captures the window and
 * quits. Backs `npm run dev:demo -- --shoot`, so a shot can be taken without a
 * hand on the keyboard.
 *
 * A renderer that never reported ready is refused rather than photographed. A
 * cold Vite dependency pass can outrun the deadline, and the shot it produces is
 * an empty window — which a batch reshoot would file over a good image under a
 * line reading `captured`.
 * @param window - The window to capture.
 * @param scenarioId - Scenario the shot is filed under.
 */
async function shootAndQuit(
	window: BrowserWindow,
	scenarioId: string,
): Promise<void> {
	if (!(await waitForRendererReady(window))) {
		process.stderr.write(
			`not captured: ${scenarioId} never set data-demo-ready within ${READY_TIMEOUT_MS}ms\n`,
		);
		app.exit(1);
		return;
	}
	window.focus();
	await new Promise((resolve) => setTimeout(resolve, FOCUS_SETTLE_MS));
	const target = await captureWindow(window, `${scenarioId}.png`);
	if (!target) {
		process.stderr.write(`not captured: ${scenarioId} had no window id\n`);
		app.exit(1);
		return;
	}
	process.stdout.write(`captured ${target}\n`);
	app.quit();
}

app.setName(DEMO_APP_NAME);
app.setPath(
	'userData',
	path.join(app.getPath('appData'), 'Ensemblr Demo (state)'),
);

void app.whenReady().then(() => {
	const window = createDemoWindow();

	ipcMain.handle(
		'demo:set-content-size',
		(_event, size: { height: number; width: number }) => {
			window.setContentSize(size.width, size.height);
		},
	);

	ipcMain.handle(
		'demo:capture',
		(_event, request: { scenarioId: string; theme: string }) =>
			captureWindow(window, `${request.scenarioId}-${request.theme}.png`),
	);

	const shootScenario = process.env.ENSEMBLR_DEMO_SHOOT;
	if (shootScenario) {
		window.webContents.once('did-finish-load', () => {
			void shootAndQuit(window, shootScenario);
		});
	}
});

app.on('window-all-closed', () => app.quit());

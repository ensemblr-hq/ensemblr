import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { BrowserWindow, Rectangle } from 'electron';

import type { EnsembleDatabaseService } from '../storage';

/** Snapshot of the main window's geometry and state flags. */
export interface MainWindowState {
	bounds: Rectangle;
	isFullScreen: boolean;
	isMaximized: boolean;
}

/** Persistence interface for the main window's last-known state. */
export interface MainWindowStateStore {
	load: (displays: readonly MainWindowDisplay[]) => MainWindowState | null;
	save: (state: MainWindowState) => void;
}

/** Minimal display descriptor needed to clamp window bounds. */
export interface MainWindowDisplay {
	workArea: Rectangle;
}

/** Options for {@link createMainWindowStateStore}. */
interface CreateMainWindowStateStoreOptions {
	databaseService: EnsembleDatabaseService;
	now?: () => Date;
}

const MAIN_WINDOW_STATE_KEY = 'mainWindow.state';
const MAIN_WINDOW_STATE_SAVE_DELAY_MS = 500;

export const DEFAULT_MAIN_WINDOW_HEIGHT = 820;
export const DEFAULT_MAIN_WINDOW_WIDTH = 1280;
export const MAIN_WINDOW_MIN_HEIGHT = 640;
export const MAIN_WINDOW_MIN_WIDTH = 960;

/**
 * Builds a SQLite-backed store for the main window's persisted state.
 * @param options - Database service and optional clock.
 * @returns A {@link MainWindowStateStore} whose load/save operate on the `settings` table.
 */
export function createMainWindowStateStore({
	databaseService,
	now = () => new Date(),
}: CreateMainWindowStateStoreOptions): MainWindowStateStore {
	return {
		load(displays) {
			const database = databaseService.getConnection()?.database ?? null;

			if (!database) {
				return null;
			}

			return loadMainWindowState({ database, displays });
		},
		save(state) {
			const database = databaseService.getConnection()?.database ?? null;
			const normalizedState = normalizeStoredMainWindowState(state);

			if (!database || !normalizedState) {
				return;
			}

			saveMainWindowState({
				database,
				now,
				state: normalizedState,
			});
		},
	};
}

/**
 * Captures the current window geometry and state flags for persistence.
 * @param mainWindow - Window to snapshot.
 * @returns A normalised state snapshot, or `null` if the bounds are invalid.
 */
export function captureMainWindowState(
	mainWindow: BrowserWindow,
): MainWindowState | null {
	const bounds = normalizeRectangle(mainWindow.getNormalBounds());

	if (!bounds) {
		return null;
	}

	return {
		bounds,
		isFullScreen: mainWindow.isFullScreen(),
		isMaximized: mainWindow.isMaximized(),
	};
}

/**
 * Subscribes to window geometry/state events and persists changes through the
 * provided store, debounced to avoid thrashing.
 * @param input - Window to observe and store to write through.
 */
export function trackMainWindowState({
	mainWindow,
	store,
}: {
	mainWindow: BrowserWindow;
	store: MainWindowStateStore;
}): void {
	let saveTimeout: NodeJS.Timeout | null = null;

	/** Cancels any scheduled persistence callback. */
	function clearPendingSave(): void {
		if (!saveTimeout) {
			return;
		}

		clearTimeout(saveTimeout);
		saveTimeout = null;
	}

	/** Captures and persists the window state immediately. */
	function persistNow(): void {
		clearPendingSave();

		const state = captureMainWindowState(mainWindow);

		if (state) {
			store.save(state);
		}
	}

	/** Schedules a debounced persistence after the configured delay. */
	function schedulePersist(): void {
		clearPendingSave();
		saveTimeout = setTimeout(persistNow, MAIN_WINDOW_STATE_SAVE_DELAY_MS);
	}

	mainWindow.on('move', schedulePersist);
	mainWindow.on('resize', schedulePersist);
	mainWindow.on('maximize', schedulePersist);
	mainWindow.on('unmaximize', schedulePersist);
	mainWindow.on('enter-full-screen', schedulePersist);
	mainWindow.on('leave-full-screen', schedulePersist);
	mainWindow.on('close', persistNow);
	mainWindow.on('closed', clearPendingSave);
}

/**
 * Parses an arbitrary persisted value into a {@link MainWindowState} and clamps
 * its bounds against the current display layout.
 * @param value - Candidate value (e.g. parsed JSON from storage).
 * @param displays - Current display work-areas used for clamping.
 * @returns A safe-to-apply window state, or `null` if the value is invalid.
 */
export function normalizeMainWindowState(
	value: unknown,
	displays: readonly MainWindowDisplay[],
): MainWindowState | null {
	const state = normalizeStoredMainWindowState(value);

	if (!state) {
		return null;
	}

	return {
		...state,
		bounds: clampMainWindowBounds(state.bounds, displays),
	};
}

/**
 * Clamps a rectangle to fit inside the nearest display's work area, while
 * enforcing the configured minimum window size.
 * @param bounds - Candidate window rectangle.
 * @param displays - Display layout to clamp against.
 * @returns A rectangle guaranteed to be visible and at-or-above the minimum size.
 */
export function clampMainWindowBounds(
	bounds: Rectangle,
	displays: readonly MainWindowDisplay[],
): Rectangle {
	const workAreas = displays.flatMap((display) => {
		const workArea = normalizeRectangle(display.workArea);
		return workArea ? [workArea] : [];
	});
	const targetWorkArea = findTargetWorkArea(bounds, workAreas);

	if (!targetWorkArea) {
		return bounds;
	}

	const width = clampDimension(
		bounds.width,
		MAIN_WINDOW_MIN_WIDTH,
		targetWorkArea.width,
	);
	const height = clampDimension(
		bounds.height,
		MAIN_WINDOW_MIN_HEIGHT,
		targetWorkArea.height,
	);

	return {
		height,
		width,
		x: clampPosition(bounds.x, targetWorkArea.x, targetWorkArea.width, width),
		y: clampPosition(bounds.y, targetWorkArea.y, targetWorkArea.height, height),
	};
}

/**
 * Reads the persisted main window state row from the settings table.
 * @param input - Open database connection and current display layout.
 * @returns A normalised state, or `null` when no row exists or parsing fails.
 */
function loadMainWindowState({
	database,
	displays,
}: {
	database: DatabaseSync;
	displays: readonly MainWindowDisplay[];
}): MainWindowState | null {
	try {
		const row = database
			.prepare(
				`SELECT value_json
				 FROM settings
				 WHERE scope = 'app' AND scope_id = '' AND key = ?`,
			)
			.get(MAIN_WINDOW_STATE_KEY);

		if (!isSettingValueRow(row)) {
			return null;
		}

		return normalizeMainWindowState(JSON.parse(row.value_json), displays);
	} catch (error) {
		console.warn(
			'Failed to load persisted main window state; using defaults.',
			error,
		);
		return null;
	}
}

/**
 * Upserts the main window state into the settings table.
 * @param input - Database, clock, and state payload to persist.
 */
function saveMainWindowState({
	database,
	now,
	state,
}: {
	database: DatabaseSync;
	now: () => Date;
	state: MainWindowState;
}): void {
	const timestamp = now().toISOString();

	try {
		database
			.prepare(
				`INSERT INTO settings (
					id,
					scope,
					scope_id,
					key,
					value_json,
					source,
					locked,
					updated_at
				)
				VALUES (?, 'app', '', ?, ?, 'sqlite', 0, ?)
				ON CONFLICT(scope, scope_id, key) DO UPDATE SET
					value_json = excluded.value_json,
					source = 'sqlite',
					locked = 0,
					updated_at = excluded.updated_at`,
			)
			.run(
				`setting-${randomUUID()}`,
				MAIN_WINDOW_STATE_KEY,
				JSON.stringify(state),
				timestamp,
			);
	} catch (error) {
		console.warn('Failed to persist main window state.', error);
	}
}

/**
 * Validates a stored value's shape and coerces it into a {@link MainWindowState}
 * without applying any display-layout clamping.
 * @param value - Candidate value to parse.
 * @returns A shape-valid window state, or `null` if the value is malformed.
 */
function normalizeStoredMainWindowState(
	value: unknown,
): MainWindowState | null {
	if (!isRecord(value)) {
		return null;
	}

	const bounds = normalizeRectangle(value.bounds);

	if (!bounds) {
		return null;
	}

	return {
		bounds,
		isFullScreen: value.isFullScreen === true,
		isMaximized: value.isMaximized === true,
	};
}

/**
 * Coerces an unknown value into an Electron {@link Rectangle} with finite
 * integer coordinates and strictly positive dimensions.
 * @param value - Candidate value to parse.
 * @returns A safe rectangle, or `null` when the shape or dimensions are invalid.
 */
function normalizeRectangle(value: unknown): Rectangle | null {
	if (!isRecord(value)) {
		return null;
	}

	const x = toFiniteInteger(value.x);
	const y = toFiniteInteger(value.y);
	const width = toFiniteInteger(value.width);
	const height = toFiniteInteger(value.height);

	if (
		x === null ||
		y === null ||
		width === null ||
		height === null ||
		width <= 0 ||
		height <= 0
	) {
		return null;
	}

	return {
		height,
		width,
		x,
		y,
	};
}

/**
 * Picks the display work area that the window should be clamped against,
 * preferring the area with the largest overlap and falling back to the nearest.
 * @param bounds - Candidate window rectangle.
 * @param workAreas - Available display work areas.
 * @returns The selected work area, or `null` when none are available.
 */
function findTargetWorkArea(
	bounds: Rectangle,
	workAreas: readonly Rectangle[],
): Rectangle | null {
	let bestIntersection: { area: number; workArea: Rectangle } | null = null;

	for (const workArea of workAreas) {
		const area = getIntersectionArea(bounds, workArea);

		if (!bestIntersection || area > bestIntersection.area) {
			bestIntersection = { area, workArea };
		}
	}

	if (bestIntersection && bestIntersection.area > 0) {
		return bestIntersection.workArea;
	}

	return findNearestWorkArea(bounds, workAreas);
}

/**
 * Returns the work area whose center is closest to the window's center.
 * @param bounds - Candidate window rectangle.
 * @param workAreas - Available display work areas.
 * @returns The nearest work area, or `null` when the list is empty.
 */
function findNearestWorkArea(
	bounds: Rectangle,
	workAreas: readonly Rectangle[],
): Rectangle | null {
	let nearest: { distance: number; workArea: Rectangle } | null = null;
	const boundsCenter = getCenter(bounds);

	for (const workArea of workAreas) {
		const workAreaCenter = getCenter(workArea);
		const distance =
			(boundsCenter.x - workAreaCenter.x) ** 2 +
			(boundsCenter.y - workAreaCenter.y) ** 2;

		if (!nearest || distance < nearest.distance) {
			nearest = { distance, workArea };
		}
	}

	return nearest?.workArea ?? null;
}

/**
 * Computes the overlap area between two rectangles.
 * @param left - First rectangle.
 * @param right - Second rectangle.
 * @returns Overlap area in pixels, or 0 when the rectangles do not intersect.
 */
function getIntersectionArea(left: Rectangle, right: Rectangle): number {
	const overlapWidth =
		Math.min(left.x + left.width, right.x + right.width) -
		Math.max(left.x, right.x);
	const overlapHeight =
		Math.min(left.y + left.height, right.y + right.height) -
		Math.max(left.y, right.y);

	if (overlapWidth <= 0 || overlapHeight <= 0) {
		return 0;
	}

	return overlapWidth * overlapHeight;
}

/**
 * Computes the center point of a rectangle.
 * @param bounds - Rectangle to inspect.
 * @returns The `{ x, y }` center coordinates.
 */
function getCenter(bounds: Rectangle): { x: number; y: number } {
	return {
		x: bounds.x + bounds.width / 2,
		y: bounds.y + bounds.height / 2,
	};
}

/**
 * Clamps a width or height to `[minimum, workAreaSize]`, defending against
 * work areas smaller than the configured minimum.
 * @param value - Requested dimension.
 * @param minimum - Lower bound (window minimum size).
 * @param workAreaSize - Upper bound from the display work area.
 * @returns The clamped dimension.
 */
function clampDimension(
	value: number,
	minimum: number,
	workAreaSize: number,
): number {
	const maximum = Math.max(minimum, workAreaSize);
	return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Clamps an x/y coordinate so the window stays fully visible within a work area.
 * @param position - Requested coordinate.
 * @param workAreaPosition - Work-area origin along the same axis.
 * @param workAreaSize - Work-area extent along the same axis.
 * @param windowSize - Window extent along the same axis.
 * @returns The clamped coordinate.
 */
function clampPosition(
	position: number,
	workAreaPosition: number,
	workAreaSize: number,
	windowSize: number,
): number {
	const maximumPosition = workAreaPosition + workAreaSize - windowSize;

	if (maximumPosition < workAreaPosition) {
		return workAreaPosition;
	}

	return Math.min(Math.max(position, workAreaPosition), maximumPosition);
}

/**
 * Coerces an unknown value into a finite integer.
 * @param value - Candidate value.
 * @returns The rounded integer, or `null` for non-finite/non-numeric input.
 */
function toFiniteInteger(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return null;
	}

	return Math.round(value);
}

/**
 * Type guard for plain object records.
 * @param value - Candidate value.
 * @returns True when `value` is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * Type guard for the shape returned when reading the settings table.
 * @param value - Candidate row value.
 * @returns True when the row exposes a string `value_json` column.
 */
function isSettingValueRow(value: unknown): value is { value_json: string } {
	return (
		isRecord(value) &&
		'value_json' in value &&
		typeof value.value_json === 'string'
	);
}

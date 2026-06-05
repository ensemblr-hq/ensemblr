import { atom } from 'jotai';

import type { HealthSnapshot, SetupDiagnosticsSnapshot } from '@/shared/ipc';

export type RouteId = 'dashboard' | 'setup' | 'workspace' | 'settings';

export const activeRouteAtom = atom<RouteId>('dashboard');

export const healthAtom = atom<HealthSnapshot | null>(null);

export const healthErrorAtom = atom<string | null>(
	window.piductor
		? null
		: 'Electron preload bridge is unavailable in this context.',
);

export const setupDiagnosticsAtom = atom<SetupDiagnosticsSnapshot | null>(null);

export const setupDiagnosticsErrorAtom = atom<string | null>(
	window.piductor
		? null
		: 'Electron preload bridge is unavailable in this context.',
);

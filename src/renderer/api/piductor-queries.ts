import { queryOptions } from '@tanstack/react-query';

import type { PiductorApi } from '@/shared/ipc';

export const piductorQueryKeys = {
	all: ['piductor'] as const,
	health: () => [...piductorQueryKeys.all, 'health'] as const,
	setupDiagnostics: () =>
		[...piductorQueryKeys.all, 'setup-diagnostics'] as const,
};

function getPiductorApi(): PiductorApi {
	const piductor = window.piductor;

	if (!piductor) {
		throw new Error('Electron preload bridge is unavailable in this context.');
	}

	return piductor;
}

export const healthQuery = queryOptions({
	queryFn: () => getPiductorApi().health(),
	queryKey: piductorQueryKeys.health(),
	staleTime: 5000,
});

export const setupDiagnosticsQuery = queryOptions({
	queryFn: () => getPiductorApi().setupDiagnostics(),
	queryKey: piductorQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});

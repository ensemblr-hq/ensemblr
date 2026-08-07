import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
	agentProviderExecutablePathQuery,
	clearAgentProviderExecutablePath,
	ensemblrQueryKeys,
	selectAgentProviderExecutable,
	setAgentProviderExecutablePath,
} from '@/renderer/api/ensemblr';

/** Debounce window before a typed Pi executable path is persisted to SQLite. */
const PI_PATH_SAVE_DEBOUNCE_MS = 500;

/**
 * Editing state for the custom Pi executable override: the field's current
 * value, a debounced write-through to SQLite, the native picker, and the reset
 * back to the discovered system Pi. Every write refreshes the readiness and
 * setup-diagnostics queries so the rest of settings reflects the new binary.
 * @returns The field value and the handlers the row binds to
 */
export function usePiExecutableOverride() {
	const queryClient = useQueryClient();
	const { data: piData } = useQuery(agentProviderExecutablePathQuery('pi'));
	const [piPath, setPiPath] = useState('');
	const piSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const resolvedOverride = piData?.overridePath ?? '';
	const lastSyncedRef = useRef(resolvedOverride);

	useEffect(() => {
		if (resolvedOverride === lastSyncedRef.current) {
			return;
		}
		lastSyncedRef.current = resolvedOverride;
		setPiPath(resolvedOverride);
	}, [resolvedOverride]);

	useEffect(() => {
		return () => {
			if (piSaveTimerRef.current) {
				clearTimeout(piSaveTimerRef.current);
			}
		};
	}, []);

	const invalidatePiPath = () => {
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentProviderExecutablePath('pi'),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.agentProviderReadiness('pi'),
		});
		void queryClient.invalidateQueries({
			queryKey: ensemblrQueryKeys.setupDiagnostics(),
		});
	};

	const persistPiPath = (value: string) => {
		const trimmed = value.trim();
		void (
			trimmed
				? setAgentProviderExecutablePath('pi', trimmed)
				: clearAgentProviderExecutablePath('pi')
		).then(invalidatePiPath);
	};

	const pickPi = useMutation({
		mutationFn: async () => {
			const result = await selectAgentProviderExecutable('pi');
			if (result.canceled) return null;
			if (result.error) throw new Error(result.error);
			return result.selectedPath ?? null;
		},
		onSuccess: (path) => {
			if (path) setPiPath(path);
			invalidatePiPath();
		},
	});

	return {
		clearPiPath: () => {
			if (piSaveTimerRef.current) {
				clearTimeout(piSaveTimerRef.current);
				piSaveTimerRef.current = null;
			}
			setPiPath('');
			void clearAgentProviderExecutablePath('pi').then(invalidatePiPath);
		},
		isPicking: pickPi.isPending,
		onPiPathChange: (value: string) => {
			setPiPath(value);
			if (piSaveTimerRef.current) {
				clearTimeout(piSaveTimerRef.current);
			}
			piSaveTimerRef.current = setTimeout(() => {
				piSaveTimerRef.current = null;
				persistPiPath(value);
			}, PI_PATH_SAVE_DEBOUNCE_MS);
		},
		piPath,
		pickPi: () => pickPi.mutate(),
	};
}

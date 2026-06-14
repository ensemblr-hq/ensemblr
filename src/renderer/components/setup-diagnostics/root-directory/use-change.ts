import { useState } from 'react';

import {
	isPiExecutablePickerAction,
	isRootDirectoryPickerAction,
} from '@/renderer/lib/setup-diagnostics';
import type { RootDirectoryChangeApplyResult, RootDirectorySelectionResult } from '@/shared/ipc/contracts/root-directory';
import type { SetupCheckSnapshot, SetupRemediationAction } from '@/shared/ipc/contracts/setup';

interface UseRootDirectoryChangeOptions {
	onRemediationAction?: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => void | Promise<void>;
	onRetry?: () => void;
}

interface UseRootDirectoryChangeResult {
	actionError: string | null;
	applyResult: RootDirectoryChangeApplyResult | null;
	confirm: () => Promise<void>;
	dismiss: () => void;
	handleRemediationAction: (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => Promise<void>;
	isApplying: boolean;
	selection: RootDirectorySelectionResult | null;
}

/**
 * Encapsulates the root-directory change UI state (selection preview,
 * apply result, transient error, in-flight flag) and the remediation
 * action orchestration used by the setup-diagnostics panel.
 */
export function useRootDirectoryChange({
	onRemediationAction,
	onRetry,
}: UseRootDirectoryChangeOptions = {}): UseRootDirectoryChangeResult {
	const [selection, setSelection] =
		useState<RootDirectorySelectionResult | null>(null);
	const [applyResult, setApplyResult] =
		useState<RootDirectoryChangeApplyResult | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isApplying, setIsApplying] = useState(false);

	const handleRemediationAction = async (
		action: SetupRemediationAction,
		check: SetupCheckSnapshot,
	) => {
		if (isRootDirectoryPickerAction(action, check)) {
			setActionError(null);
			setApplyResult(null);

			const next = await window.ensemble?.selectRootDirectory();

			if (!next) {
				setActionError(
					'Root directory selection is unavailable in this context.',
				);
				return;
			}

			if (next.canceled) {
				return;
			}

			if (next.error || !next.preview) {
				setActionError(
					next.error ?? 'The selected root directory could not be previewed.',
				);
				return;
			}

			setSelection(next);
			return;
		}

		if (isPiExecutablePickerAction(action, check)) {
			await window.ensemble?.selectPiExecutable();
			onRetry?.();
			return;
		}

		await onRemediationAction?.(action, check);
	};

	const confirm = async () => {
		const path = selection?.preview?.newRoot.path;

		if (!path) {
			setActionError('No root directory path was selected.');
			return;
		}

		setIsApplying(true);
		setActionError(null);

		try {
			const result = await window.ensemble?.confirmRootDirectoryChange({
				path,
			});

			if (!result) {
				setActionError(
					'Root directory changes are unavailable in this context.',
				);
				return;
			}

			setApplyResult(result);
			onRetry?.();

			if (
				result.applied &&
				!result.error &&
				result.reconciliation?.status !== 'error'
			) {
				setSelection(null);
			}
		} finally {
			setIsApplying(false);
		}
	};

	const dismiss = () => {
		setSelection(null);
		setApplyResult(null);
	};

	return {
		actionError,
		applyResult,
		confirm,
		dismiss,
		handleRemediationAction,
		isApplying,
		selection,
	};
}

export type { PiExecutableSelectionResult } from '../../shared/ipc/contracts/pi-session';
export type {
	PiExecutableDiagnostic,
	PiExecutableDiagnosticSeverity,
	PiExecutableProbeKind,
	PiExecutableProbeSnapshot,
	PiExecutableProbeStatus,
	PiExecutableService,
	PiExecutableSnapshot,
	PiExecutableSource,
	PiExecutableStatus,
	ResolvePiExecutableOptions,
} from './pi-executable';
// Only the service factory ships through the barrel. `resolvePiExecutable` and
// `savePiExecutableOverride` remain reachable via the './pi-executable' path
// for tests but are intentionally not part of the public PI surface.
export { createPiExecutableService } from './pi-executable';
export type {
	CreatePiReadinessServiceOptions,
	PiAgentDirectorySnapshot,
	PiAgentDirectorySource,
	PiModelOption,
	PiProviderModelFailureCode,
	PiProviderModelSnapshot,
	PiReadinessDiagnostic,
	PiReadinessDiagnosticSeverity,
	PiReadinessService,
	PiReadinessSnapshot,
	PiReadinessStatus,
	PiRpcFrameSnapshot,
	PiRpcSmokeFailure,
	PiRpcSmokeFailureCode,
	PiRpcSmokeLogs,
	PiRpcSmokeRunner,
	PiRpcSmokeRunnerRequest,
	PiRpcSmokeSnapshot,
	ResolvePiReadinessOptions,
} from './pi-readiness';
// Only the service factory is part of the public PI surface. Internal helpers
// (resolvePiAgentDirectory, resolvePiReadiness, resolvePiRpcSmoke,
// resolvePiProviderModels, parsePiListModelsOutput, runPiRpcSmokeProcess) live
// at './pi-readiness' and are intentionally not re-exported here — tests that
// need them import the module path directly.
export { createPiReadinessService } from './pi-readiness';

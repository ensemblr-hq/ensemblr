export {
	resolveOpenTargetPath,
	sanitizeOpenTargetPath,
} from './open-target-paths';
export {
	collectRegistryValidationErrors,
	isValidBundleId,
	isValidCommandName,
	isValidDesktopEntryId,
	OPEN_TARGET_REGISTRY,
	resolvePlatformBehavior,
} from './open-target-registry';
export type { OpenTargetService } from './open-target-service';
export { createOpenTargetService } from './open-target-service';

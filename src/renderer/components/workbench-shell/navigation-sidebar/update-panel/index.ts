/**
 * Public surface of the sidebar's update panel: the wired panel the workbench
 * mounts, and the presentational one a fixture drives.
 *
 * The sidebar itself reaches `sidebar-update-panel` directly, the way
 * `conversation-panel/architecture-diagram` is reached — a sibling inside the
 * same folder gains nothing from the indirection. What the barrel is for is the
 * consumers outside it: the playground scene and the tests, which drive
 * {@link UpdatePanel} through states main only reaches on its own schedule.
 */
export { SidebarUpdatePanel } from './sidebar-update-panel';
export { UpdatePanel } from './update-panel';

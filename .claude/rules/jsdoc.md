# JSDoc Policy

Every function carries a JSDoc block. This rule complements the Documentation Policy in `AGENTS.md`: that section defines JSDoc coverage across declarations (hooks, atoms, IPC contracts, routes, exclusions); this file governs the per-function JSDoc contract. For the discipline inside a function body, see [comments.md](./comments.md).

## JSDoc On Every Function

Place a `/** ... */` block immediately above every function: named functions, arrow functions assigned to `const`/`let`, class and object-literal methods, React components, and exported `const`s that hold function values. Document internal helpers, not just exports.

- Open with a concise description of what the function does and why, not how. One sentence is usually enough; two when the behavior is non-obvious.
- Add `@param name - description` for every parameter.
- Add `@returns description` when the function returns a non-void value.
- Omit empty `@param` and `@returns` tags. For React components, write a description-only block and document props on their interface or inline shape, not as `@param` tags.

```ts
/**
 * Resolve the workspace a user should land in, falling back to their last-opened one.
 * @param userId - ID of the user whose workspace to resolve
 * @param options - Lookup options such as whether to include archived workspaces
 * @returns The resolved workspace, or null when the user has none
 */
function resolveWorkspace(userId: string, options: WorkspaceLookup): Workspace | null {
  const owned = findOwnedWorkspaces(userId, options);
  return owned.at(0) ?? findLastOpenedWorkspace(userId) ?? null;
}
```

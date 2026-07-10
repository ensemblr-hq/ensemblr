# JSDoc And Comment Policy

Every function carries a JSDoc block, and function bodies stay comment-free. This rule complements the Documentation Policy in `AGENTS.md`: that section defines JSDoc coverage across declarations (hooks, atoms, IPC contracts, routes, exclusions); this file governs the per-function JSDoc contract and the discipline of self-explanatory bodies.

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

## No Comments Inside Function Bodies

Function bodies contain no inline comments. The code itself must carry the meaning:

- Name variables, parameters, and helpers so intent is obvious without prose.
- Lift complex conditions and expressions into well-named locals.
- Split a long function into smaller named helpers instead of separating sections with comments.

The single allowed exception is a short comment explaining a non-obvious *why* that the code cannot express on its own — a workaround, a spec quirk, an external constraint, or a deliberate deviation. Never write a comment that restates *what* the code already says.

```ts
// Wrong — the comment restates the code.
retries = retries + 1; // increment the retry counter

// Right — the code speaks for itself.
retries = retries + 1;

// Allowed — explains a non-obvious why the code cannot express.
// Stripe rejects amounts over 8 digits, so cap before the charge call.
const chargeable = Math.min(amount, MAX_STRIPE_AMOUNT);
```

The JSDoc block documents the contract; clear code documents the mechanism. Comments that echo the code rot and add noise.

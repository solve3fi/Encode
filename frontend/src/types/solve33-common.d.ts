// Compatibility declaration for a type-only package referenced by the frontend
// but omitted from package.json and bun.lock in the upstream repository.
declare module "@solve33/common" {
	export type LockInfo = any;
}

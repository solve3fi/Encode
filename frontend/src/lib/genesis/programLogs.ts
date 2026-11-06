const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/;
const EXIT = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/;
const DATA = /^Program data: (\S+)$/;

/** Map direct Anchor event payloads to outer instruction ordinals. */
export function collectDirectProgramData(
	logs: readonly string[] | null | undefined,
	instructionPrograms: readonly (string | undefined)[],
	programId: string,
): Map<number, string[]> {
	if (!logs || logs.some((log) => log.includes("Log truncated"))) {
		throw new Error("Solve transaction logs are unavailable or truncated.");
	}
	const events = new Map<number, string[]>();
	const stack: string[] = [];
	let outerIndex = -1;
	for (const log of logs) {
		const invoke = INVOKE.exec(log);
		if (invoke) {
			const depth = Number(invoke[2]);
			if (depth !== stack.length + 1)
				throw new Error("Invalid Solana invocation depth.");
			if (depth === 1) {
				outerIndex++;
				if (instructionPrograms[outerIndex] !== invoke[1]) {
					throw new Error("Solana logs do not align with outer instructions.");
				}
			}
			stack.push(invoke[1]);
			continue;
		}
		const exit = EXIT.exec(log);
		if (exit) {
			if (stack.pop() !== exit[1])
				throw new Error("Invalid Solana invocation exit.");
			continue;
		}
		const data = DATA.exec(log);
		if (data && stack.at(-1) === programId) {
			if (stack.length !== 1)
				throw new Error("Solve CPI event attribution is unsupported.");
			const prior = events.get(outerIndex) ?? [];
			prior.push(data[1]);
			events.set(outerIndex, prior);
		}
	}
	if (stack.length || outerIndex !== instructionPrograms.length - 1) {
		throw new Error("Incomplete Solana transaction logs.");
	}
	return events;
}

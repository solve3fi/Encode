import { describe, expect, test } from "bun:test";
import { mapTransactionError } from "./transactionErrors";

describe("transaction error mapping", () => {
	test("distinguishes a rejected wallet request", () => {
		expect(mapTransactionError(new Error("User rejected the request")).kind).toBe("rejected");
	});

	test("gives blockhash expiry a recoverable state", () => {
		const result = mapTransactionError("TransactionExpiredBlockheightExceededError");
		expect(result.kind).toBe("expired");
		expect(result.message).toContain("inputs are preserved");
	});

	test("maps common protocol and RPC failures", () => {
		expect(mapTransactionError("insufficient lamports").kind).toBe("insufficient-sol");
		expect(mapTransactionError("slippage tolerance exceeded").kind).toBe("slippage");
		expect(mapTransactionError("epoch already settled").kind).toBe("epoch-settled");
		expect(mapTransactionError("vote window closed").kind).toBe("vote-closed");
	});
});

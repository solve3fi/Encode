export type TransactionErrorKind =
	| "rejected"
	| "expired"
	| "insufficient-sol"
	| "slippage"
	| "account-exists"
	| "epoch-settled"
	| "vote-closed"
	| "lock-has-votes"
	| "lock-expired"
	| "unknown";

export type HumanTransactionError = {
	kind: TransactionErrorKind;
	message: string;
	raw: string;
};

const rawMessage = (reason: unknown): string => {
	if (reason instanceof Error) return reason.message;
	if (typeof reason === "string") return reason;
	try {
		return JSON.stringify(reason);
	} catch {
		return "Unknown transaction error";
	}
};

export function mapTransactionError(reason: unknown): HumanTransactionError {
	const raw = rawMessage(reason);
	const normalized = raw.toLowerCase();

	// Checked before the generic "rejected" pattern below: some wallets
	// surface a failed simulation (this program error included) through the
	// same "declined" phrasing as a real manual reject, which would
	// otherwise mask the actual on-chain reason.
	if (/lock has active votes|lockhasactivevotes/.test(normalized)) {
		return {
			kind: "lock-has-votes",
			message:
				"This lock voted in the current epoch and can't be split, transferred, or exited until next epoch.",
			raw,
		};
	}
	if (/lock expired|lockexpired/.test(normalized)) {
		return {
			kind: "lock-expired",
			message: "This lock has expired and can no longer be modified this way.",
			raw,
		};
	}
	if (/user rejected|rejected the request|declined/.test(normalized)) {
		return {
			kind: "rejected",
			message: "The wallet request was declined. No transaction was sent.",
			raw,
		};
	}
	if (
		/block height exceeded|blockheight.*exceeded|blockhash not found|transaction expired|transactionexpired|expired blockhash/.test(
			normalized,
		)
	) {
		return {
			kind: "expired",
			message:
				"The transaction expired before it could confirm. Rebuild it and try again; your inputs are preserved.",
			raw,
		};
	}
	if (/insufficient funds|insufficient lamports|0x1\b/.test(normalized)) {
		return {
			kind: "insufficient-sol",
			message:
				"This wallet does not have enough SOL to cover the transaction and network fees.",
			raw,
		};
	}
	if (/slippage|amount out below minimum|price impact/.test(normalized)) {
		return {
			kind: "slippage",
			message:
				"The price moved beyond your slippage limit. Refresh the quote and try again.",
			raw,
		};
	}
	if (/already in use|already exists|account.*initialized/.test(normalized)) {
		return {
			kind: "account-exists",
			message:
				"An account this transaction needs already exists. Refresh the page before retrying.",
			raw,
		};
	}
	if (/epoch.*settled|already settled|epoch.*finalized/.test(normalized)) {
		return {
			kind: "epoch-settled",
			message:
				"This epoch has already been settled. Refresh to continue with the current epoch.",
			raw,
		};
	}
	if (/vote window|voting.*closed|vote.*closed/.test(normalized)) {
		return {
			kind: "vote-closed",
			message:
				"The voting window is closed for this epoch. Your allocation was not submitted.",
			raw,
		};
	}

	return {
		kind: "unknown",
		message:
			"The transaction could not be completed. Review the technical details before retrying.",
		raw,
	};
}

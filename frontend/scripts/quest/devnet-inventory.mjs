import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PublicKey } from "@solana/web3.js";

// This is an inventory of candidate addresses, not an approved deployment manifest.
export const DEVNET_GENESIS_HASH =
	"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const CANDIDATE_ACCOUNTS = Object.freeze({
	dexProgram: "HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK",
	veProgram: "HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN",
	solv3Mint: "DvGitpT8Qujq6sxXoq7M1vueGf97dGVpoPWY4ifYHCHu",
});

const DEFAULT_RPC = "https://api.devnet.solana.com";
const UPGRADEABLE_LOADER = new PublicKey(
	"BPFLoaderUpgradeab1e11111111111111111111111",
);

export function assertDevnetGenesisHash(observed) {
	if (observed !== DEVNET_GENESIS_HASH) {
		throw new Error(
			"Quest inventory refused RPC with a non-Devnet genesis hash",
		);
	}
}

function accountEvidence(label, value) {
	if (!value) {
		return { exists: false };
	}
	const evidence = {
		exists: true,
		executable: value.executable === true,
		owner: value.owner,
		lamports: value.lamports,
	};
	if (label.endsWith("Program")) {
		if (!evidence.executable || value.owner !== UPGRADEABLE_LOADER.toBase58()) {
			throw new Error(
				`Quest inventory expected upgradeable executable ${label}`,
			);
		}
		if (!Array.isArray(value.data) || value.data[1] !== "base64") {
			throw new Error(`Quest inventory expected base64 ${label} account data`);
		}
		const data = Buffer.from(value.data[0], "base64");
		if (data.length !== 36 || data.readUInt32LE(0) !== 2) {
			throw new Error(
				`Quest inventory received invalid ${label} program state`,
			);
		}
		evidence.programDataAddress = new PublicKey(
			data.subarray(4, 36),
		).toBase58();
		evidence.accountDataSha256 = createHash("sha256")
			.update(data)
			.digest("hex");
	} else if (value.data?.parsed?.type === "mint" && value.data.parsed.info) {
		const info = value.data.parsed.info;
		evidence.mint = {
			decimals: info.decimals,
			mintAuthority: info.mintAuthority,
			freezeAuthority: info.freezeAuthority,
			supply: info.supply,
		};
	}
	if (label === "solv3Mint" && !evidence.mint) {
		throw new Error("Quest inventory expected parsed SOLV3 mint data");
	}
	return evidence;
}

function programDataEvidence(programAddress, account, expectedAddress) {
	if (
		!account ||
		account.owner !== UPGRADEABLE_LOADER.toBase58() ||
		account.executable
	) {
		throw new Error(
			"Quest inventory expected non-executable ProgramData account",
		);
	}
	const derived = PublicKey.findProgramAddressSync(
		[new PublicKey(programAddress).toBuffer()],
		UPGRADEABLE_LOADER,
	)[0].toBase58();
	if (derived !== expectedAddress) {
		throw new Error("Quest inventory found unexpected ProgramData address");
	}
	if (!Array.isArray(account.data) || account.data[1] !== "base64") {
		throw new Error("Quest inventory expected base64 ProgramData account data");
	}
	const data = Buffer.from(account.data[0], "base64");
	if (data.length <= 45 || data.readUInt32LE(0) !== 3) {
		throw new Error("Quest inventory received invalid ProgramData state");
	}
	const authorityTag = data[12];
	if (authorityTag !== 0 && authorityTag !== 1) {
		throw new Error("Quest inventory received invalid upgrade authority tag");
	}
	return {
		address: expectedAddress,
		lastDeployedSlot: data.readBigUInt64LE(4).toString(),
		upgradeAuthority:
			authorityTag === 1
				? new PublicKey(data.subarray(13, 45)).toBase58()
				: null,
		allocatedExecutableBytes: data.length - 45,
		allocatedExecutableDataSha256: createHash("sha256")
			.update(data.subarray(45))
			.digest("hex"),
	};
}

export async function collectDevnetInventory(
	rpcUrl = DEFAULT_RPC,
	fetcher = fetch,
) {
	let endpoint;
	try {
		endpoint = new URL(rpcUrl);
	} catch {
		throw new Error("Quest inventory requires a valid HTTPS RPC URL");
	}
	if (endpoint.protocol !== "https:") {
		throw new Error("Quest inventory requires HTTPS RPC");
	}
	let nextId = 0;
	const rpc = async (method, params = []) => {
		let response;
		try {
			response = await fetcher(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
			});
		} catch {
			throw new Error(`Quest RPC ${method} transport failed`);
		}
		if (!response.ok)
			throw new Error(`Quest RPC ${method} returned HTTP ${response.status}`);
		const body = await response.json();
		if (body.error || body.result === undefined) {
			throw new Error(`Quest RPC ${method} failed`);
		}
		return body.result;
	};

	// Check the cluster before querying any candidate accounts.
	const genesisHash = await rpc("getGenesisHash");
	assertDevnetGenesisHash(genesisHash);
	const slot = await rpc("getSlot", [{ commitment: "finalized" }]);
	if (!Number.isSafeInteger(slot) || slot < 0) {
		throw new Error("Quest inventory received invalid finalized slot");
	}
	const accounts = {};
	for (const [label, address] of Object.entries(CANDIDATE_ACCOUNTS)) {
		const result = await rpc("getAccountInfo", [
			address,
			{
				commitment: "finalized",
				encoding: label === "solv3Mint" ? "jsonParsed" : "base64",
				minContextSlot: slot,
			},
		]);
		if (
			!result ||
			!Object.hasOwn(result, "value") ||
			!Number.isSafeInteger(result.context?.slot) ||
			result.context.slot < slot
		) {
			throw new Error(
				`Quest inventory received invalid ${label} account response`,
			);
		}
		accounts[label] = {
			address,
			contextSlot: result.context.slot,
			...accountEvidence(label, result.value),
		};
		if (label.endsWith("Program") && accounts[label].exists) {
			const programDataAddress = accounts[label].programDataAddress;
			const programData = await rpc("getAccountInfo", [
				programDataAddress,
				{ commitment: "finalized", encoding: "base64", minContextSlot: slot },
			]);
			if (
				!programData ||
				!Object.hasOwn(programData, "value") ||
				!Number.isSafeInteger(programData.context?.slot) ||
				programData.context.slot < slot
			) {
				throw new Error(
					`Quest inventory received invalid ${label} ProgramData response`,
				);
			}
			accounts[label].programData = {
				contextSlot: programData.context.slot,
				...programDataEvidence(address, programData.value, programDataAddress),
			};
		}
	}
	return {
		status: "UNREVIEWED_CANDIDATE_INVENTORY",
		network: "DEVNET",
		genesisHash,
		finalizedSlot: slot,
		observedAt: new Date().toISOString(),
		accounts,
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	collectDevnetInventory(process.env.SOLVE3_DEVNET_RPC || DEFAULT_RPC)
		.then((inventory) => console.log(JSON.stringify(inventory, null, 2)))
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}

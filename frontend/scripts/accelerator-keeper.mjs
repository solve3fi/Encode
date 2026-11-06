import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../src/configs/vesolve.json" with { type: "json" };
import {
	computeMatches,
	expiredPartners,
	findEnrollments,
	toAllocation,
	toUnits,
} from "./lib/accelerator-match.mjs";

// Runs the Accelerator Program with no admin clicks. Each run (it is called at the start of the
// auto-vote keeper, before every epoch's cutoff):
//   1. picks the accelerator wallet when exactly one auto-vote wallet exists and none is set;
//   2. enrols partner applications that asked for the program once their token has an ACTIVE gauge;
//   3. completes partners whose maximum number of epochs has passed;
//   4. recomputes the match and writes it as the accelerator wallet's pool allocation, which the
//      auto-vote keeper then casts.
// Turn it off with `automatic: false` in the accelerator config (Admin > Accelerator).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SOLVE3_DATA_DIR ?? path.join(__dirname, "..", "data");
const VESOLVE_PROGRAM_ID = new PublicKey(idl.address);
const DEFAULT_RPC = "https://api.devnet.solana.com";

const file = (name) => path.join(DATA_DIR, `${name}.json`);
const readJson = (name, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file(name), "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return fallback;
		throw error;
	}
};
const writeJson = (name, value) => {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	fs.writeFileSync(file(name), JSON.stringify(value, null, 2), "utf8");
};

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, VESOLVE_PROGRAM_ID)[0];
const u64 = (value) => new anchor.BN(value).toArrayLike(Buffer, "le", 8);

export async function runAcceleratorAutomation({
	connection = new Connection(
		process.env.SOLVE3_RPC_URL ?? process.env.SOLVE3_DEVNET_RPC ?? DEFAULT_RPC,
		"confirmed",
	),
	dryRun = false,
	log = (action, details = {}) =>
		console.log(JSON.stringify({ timestamp: new Date().toISOString(), action, ...details })),
} = {}) {
	const config = readJson("accelerator-config", {});
	if (config.automatic === false) {
		log("accelerator_automation_off");
		return { status: "off" };
	}

	const wallets = readJson("admin-auto-vote-wallets", {});
	let acceleratorWallet = config.acceleratorWalletPubkey;
	if (!acceleratorWallet) {
		const keys = Object.keys(wallets);
		if (keys.length !== 1) {
			log("accelerator_wallet_not_set", { autoVoteWallets: keys.length });
			return { status: "no_wallet" };
		}
		acceleratorWallet = keys[0];
		if (!dryRun) {
			writeJson("accelerator-config", {
				...config,
				acceleratorWalletPubkey: acceleratorWallet,
				updatedBy: "accelerator-keeper",
				updatedAt: Date.now(),
			});
		}
		log("accelerator_wallet_auto_selected", { acceleratorWallet });
	}
	if (!wallets[acceleratorWallet]) {
		log("accelerator_wallet_missing_from_auto_vote", { acceleratorWallet });
		return { status: "wallet_not_configured" };
	}

	const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), {
		commitment: "confirmed",
	});
	const program = new anchor.Program(idl, provider);
	const protocol = await program.account.protocol.fetch(pda([Buffer.from("protocol")]));
	const currentEpoch = protocol.currentEpoch.toNumber();
	const epoch = await program.account.epoch.fetchNullable(
		pda([Buffer.from("epoch_data"), u64(currentEpoch)]),
	);
	if (!epoch) {
		log("accelerator_no_epoch_data", { currentEpoch });
		return { status: "no_epoch_data" };
	}

	const gaugeRows = await program.account.gauge.all();
	const weightByGauge = new Map(
		epoch.gaugeWeights.map((entry) => [entry.gauge.toString(), toUnits(entry.weight.toString())]),
	);
	const gauges = gaugeRows.map(({ publicKey, account }) => ({
		poolAddress: account.poolAddress.toString(),
		tokenMintA: account.tokenMintA.toString(),
		tokenMintB: account.tokenMintB.toString(),
		status: account.status,
		weightUnits: weightByGauge.get(publicKey.toString()) ?? 0,
	}));
	const weightByPool = new Map(gauges.map((gauge) => [gauge.poolAddress, gauge.weightUnits]));

	// 1-3: partners
	const partners = readJson("accelerator-partners", {});
	const applications = readJson("partner-applications", []);
	const now = Date.now();
	const enrollments = findEnrollments({
		applications,
		gauges,
		knownPools: new Set(Object.keys(partners)),
		currentEpoch,
		now,
	});
	for (const enrollment of enrollments) {
		partners[enrollment.poolAddress] = enrollment;
		log("accelerator_partner_enrolled", {
			pool: enrollment.poolAddress,
			project: enrollment.projectName,
		});
	}
	const expired = expiredPartners(Object.values(partners), currentEpoch);
	for (const poolAddress of expired) {
		partners[poolAddress] = { ...partners[poolAddress], status: "completed", updatedAt: now };
		log("accelerator_partner_completed", { pool: poolAddress });
	}
	if (!dryRun && (enrollments.length > 0 || expired.length > 0)) {
		writeJson("accelerator-partners", partners);
	}

	// 4: the match, as the accelerator wallet's allocation
	const locks = await program.account.lock.all([
		{ memcmp: { offset: 8, bytes: acceleratorWallet } },
	]);
	const acceleratorPowerUnits = locks.reduce(
		(sum, { account }) => sum + toUnits(account.votingPower.toString()),
		0,
	);
	const matches = computeMatches({
		partners: Object.values(partners),
		currentEpoch,
		totalVotingPowerUnits: toUnits(epoch.totalVotingPower.toString()),
		acceleratorPowerUnits,
		weightUnitsForPool: (poolAddress) => weightByPool.get(poolAddress) ?? 0,
	});
	const allocation = toAllocation(matches);
	const current = wallets[acceleratorWallet].pools ?? [];
	const same =
		current.length === allocation.length &&
		allocation.every((next) =>
			current.some((have) => have.poolAddress === next.poolAddress && have.percent === next.percent),
		);
	log("accelerator_match", { currentEpoch, acceleratorPowerUnits, allocation, unchanged: same });
	if (!same && !dryRun) {
		wallets[acceleratorWallet] = { ...wallets[acceleratorWallet], pools: allocation, updatedAt: now };
		writeJson("admin-auto-vote-wallets", wallets);
	}
	return { status: "ok", currentEpoch, allocation, enrolled: enrollments.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const dryRun = process.argv.includes("--dry-run");
	runAcceleratorAutomation({ dryRun }).catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

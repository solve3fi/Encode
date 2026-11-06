#!/usr/bin/env node
// Devnet rehearsal scenarios. Usage: node scenarios.mjs <step>
//   fund   - protocol SOLV3 account, SOLV3 split from alice, test tokens minted
//   locks  - alice 1 lock, bob 2 locks, carol 1 lock (permanent)
//   vote   - alice 100% SOLV3/tUSDC; bob lock A 70/30, lock B 100% tSOL/tUSDC; carol 100% tSOL/tUSDC
//   bribe  - alice bribes both gauges with the test bribe token
import { BN } from "@coral-xyz/anchor";
import {
	TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction,
	createMintToInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { IDS, MINTS, admin, conn, loadState, pda, programFor, saveState, wallet } from "./lib.mjs";

const step = process.argv[2];
const TSOL = MINTS.tsol;
const METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const protocolKey = pda("vesolve", [Buffer.from("protocol")]);
const state = loadState();
const wallets = { alice: wallet("alice"), bob: wallet("bob"), carol: wallet("carol"), lp1: wallet("lp1"), lp2: wallet("lp2") };
const ata = (mint, owner, off = false) => getAssociatedTokenAddressSync(mint, owner, off);
const send = (signer, ...ixs) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [signer]);
const u64le = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const gaugeFor = (key) => pda("vesolve", [Buffer.from("gauge"), protocolKey.toBuffer(), new PublicKey(state[key].pool).toBuffer()]);
const SOLV3 = (n) => BigInt(n) * 10n ** 9n;
const USD = (n) => BigInt(n) * 10n ** 6n;

if (step === "fund") {
	console.log("protocol ATA", await send(admin, createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(MINTS.solv3, protocolKey, true), protocolKey, MINTS.solv3)));
	const aliceAta = ata(MINTS.solv3, wallets.alice.publicKey);
	for (const [who, amt] of [["bob", 800_000], ["carol", 800_000], ["lp1", 400_000], ["lp2", 400_000]]) {
		const dest = ata(MINTS.solv3, wallets[who].publicKey);
		console.log(who, "SOLV3", amt, await send(wallets.alice, createAssociatedTokenAccountIdempotentInstruction(wallets.alice.publicKey, dest, wallets[who].publicKey, MINTS.solv3), createTransferInstruction(aliceAta, dest, wallets.alice.publicKey, SOLV3(amt))));
	}
	const mints = [
		[MINTS.tusdc, ["lp1", "lp2", "bob"], USD(1_000_000)],
		[TSOL, ["lp1", "lp2"], 100_000n * 10n ** 9n],
		[MINTS.bribe, ["alice"], USD(1_000_000)],
	];
	for (const [mint, owners, amount] of mints) {
		for (const who of owners) {
			const dest = ata(mint, wallets[who].publicKey);
			console.log(who, mint.toBase58().slice(0, 6), await send(admin, createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, dest, wallets[who].publicKey, mint), createMintToInstruction(mint, dest, admin.publicKey, amount)));
		}
	}
}

if (step === "locks") {
	const vesolve = (w) => programFor("vesolve", w);
	const plan = [["alice", 2_000_000], ["bob", 400_000], ["bob", 400_000], ["carol", 800_000]];
	const locks = state.locks ?? {};
	for (const [who, amt] of plan) {
		const p = vesolve(wallets[who]);
		const proto = await p.account.protocol.fetch(protocolKey);
		const id = proto.nextNftTokenId;
		const veMint = pda("vesolve", [Buffer.from("ve_token"), u64le(id)]);
		const metadata = PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA.toBuffer(), veMint.toBuffer()], METADATA)[0];
		const sig = await p.methods.createLock(new BN(SOLV3(amt).toString()), new BN(0)).accounts({
			user: wallets[who].publicKey, userTokenAccount: ata(MINTS.solv3, wallets[who].publicKey), tokenMint: MINTS.solv3,
			protocolTokenAccount: ata(MINTS.solv3, protocolKey, true), metadata, tokenProgram: TOKEN_PROGRAM_ID,
		}).rpc();
		(locks[who] ??= []).push(id.toNumber());
		console.log(who, "lock", id.toString(), amt, sig);
		saveState({ locks });
	}
}

if (step === "vote") {
	const locks = state.locks;
	const proto = (await programFor("vesolve").account.protocol.fetch(protocolKey));
	const epochNo = proto.currentEpoch;
	const epoch = pda("vesolve", [Buffer.from("epoch_data"), u64le(epochNo)]);
	const A = gaugeFor("solv3_tusdc");
	const B = gaugeFor("tsol_tusdc");
	const plan = [
		["alice", locks.alice[0], [[A, 100]]],
		["bob", locks.bob[0], [[A, 70], [B, 30]]],
		["bob", locks.bob[1], [[B, 100]]],
		["carol", locks.carol[0], [[B, 100]]],
	];
	for (const [who, id, votes] of plan) {
		const p = programFor("vesolve", wallets[who]);
		try {
			const sig = await p.methods.vote(new BN(id), votes.map(([gauge, weight]) => ({ gauge, weight: new BN(weight) })))
				.accounts({ user: wallets[who].publicKey, epoch, autoVoteEnrollment: null, allocationVoter: null })
				.remainingAccounts(votes.map(([g]) => ({ pubkey: g, isSigner: false, isWritable: true }))).rpc();
			console.log(who, "vote lock", id, JSON.stringify(votes.map(([g, w]) => [g.toBase58().slice(0, 6), w])), sig);
		} catch (e) {
			console.log(who, "vote FAILED lock", id, String(e.message ?? e).split("\n").slice(0, 6).join(" | "));
		}
	}
}

if (step === "bribe") {
	const p = programFor("vesolve", wallets.alice);
	for (const [key, amt] of [["solv3_tusdc", 1000], ["tsol_tusdc", 500]]) {
		try {
			const sig = await p.methods.createBribe(new BN(USD(amt).toString())).accounts({
				user: wallets.alice.publicKey, gauge: gaugeFor(key), tokenMint: MINTS.bribe, userTokenAccount: ata(MINTS.bribe, wallets.alice.publicKey), tokenProgram: TOKEN_PROGRAM_ID,
			}).rpc();
			console.log(key, "bribe", amt, sig);
		} catch (e) {
			console.log(key, "bribe FAILED", String(e.message ?? e).split("\n").slice(0, 6).join(" | "));
		}
	}
}

const solveAs = (w) => programFor("solve", w);
const tickArrayKey = (pool, start) => pda("solve", [Buffer.from("tick_array"), pool.toBuffer(), Buffer.from(String(start))]);
const SPAN = 88 * 64;

if (step === "extra-arrays") {
	for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
		const s = state[key];
		const pool = new PublicKey(s.pool);
		const held = Math.floor(s.tick / SPAN) * SPAN;
		for (const start of [held + 2 * SPAN, held - 2 * SPAN]) {
			const tickArray = tickArrayKey(pool, start);
			if (await conn.getAccountInfo(tickArray)) continue;
			console.log(key, "tick array", start, await solveAs(admin).methods.initializeTickArray(start).accounts({ solve: pool, funder: admin.publicKey, tickArray }).rpc());
		}
	}
}

if (step === "lp") {
	const positions = state.positions ?? {};
	const plan = [
		["solv3_tusdc", "lp1", -85696, -84672, "100000000000000"],
		["solv3_tusdc", "lp2", -85248, -85120, "100000000000000"],
		["tsol_tusdc", "lp1", -19456, -18496, "5000000000000"],
		["tsol_tusdc", "lp2", -19072, -18880, "5000000000000"],
	];
	for (const [key, who, lower, upper, liq] of plan) {
		if ((state.positions ?? {})[`${key}:${who}`]) continue;
		const s = state[key];
		const pool = new PublicKey(s.pool);
		const owner = wallets[who];
		const p = solveAs(owner);
		const positionMint = (await import("@solana/web3.js")).Keypair.generate();
		const position = pda("solve", [Buffer.from("position"), positionMint.publicKey.toBuffer()]);
		const positionToken = ata(positionMint.publicKey, owner.publicKey);
		try {
			await p.methods.openPosition({ positionBump: 255 }, lower, upper).accounts({
				funder: owner.publicKey, owner: owner.publicKey, position, positionMint: positionMint.publicKey, positionTokenAccount: positionToken, solve: pool,
			}).signers([positionMint]).rpc();
			const lowerStart = Math.floor(lower / SPAN) * SPAN;
			const upperStart = Math.floor(upper / SPAN) * SPAN;
			const sig = await p.methods.increaseLiquidity(new BN(liq), new BN("18446744073709551615"), new BN("18446744073709551615")).accounts({
				solve: pool, positionAuthority: owner.publicKey, position, positionTokenAccount: positionToken,
				tokenOwnerAccountA: ata(new PublicKey(s.mintA), owner.publicKey), tokenOwnerAccountB: ata(new PublicKey(s.mintB), owner.publicKey),
				tokenVaultA: new PublicKey(s.vaultA), tokenVaultB: new PublicKey(s.vaultB),
				tickArrayLower: tickArrayKey(pool, lowerStart), tickArrayUpper: tickArrayKey(pool, upperStart), solvesConfig: new PublicKey(state.config),
			}).rpc();
			console.log(key, who, "liquidity", liq, sig);
			(positions[`${key}:${who}`] = { position: position.toBase58(), mint: positionMint.publicKey.toBase58(), lower, upper });
			saveState({ positions });
		} catch (e) {
			console.log(key, who, "LP FAILED", String(e.message ?? e).split("\n").slice(0, 8).join(" | "));
		}
	}
}

if (step === "stake") {
	const positions = state.positions;
	for (const [k, v] of Object.entries(positions)) {
		const [key, who] = k.split(":");
		const pool = new PublicKey(state[key].pool);
		try {
			console.log(k, "stake_position", await programFor("vesolve", wallets[who]).methods.stakePosition().accounts({
				owner: wallets[who].publicKey, gauge: gaugeFor(key), pool, position: new PublicKey(v.position), positionMint: new PublicKey(v.mint), tokenProgram: TOKEN_PROGRAM_ID,
			}).rpc());
		} catch (e) {
			console.log(k, "STAKE FAILED", String(e.message ?? e).split("\n").slice(0, 8).join(" | "));
		}
	}
}

if (step === "swap") {
	// bob trades tUSDC -> base and back on both pools to accrue fees
	const bob = wallets.bob;
	for (const key of ["solv3_tusdc", "tsol_tusdc"]) {
		const s = state[key];
		const pool = new PublicKey(s.pool);
		const held = Math.floor(s.tick / SPAN) * SPAN;
		const usdcIsB = s.mintB === MINTS.tusdc.toBase58();
		for (const aToB of [!usdcIsB, usdcIsB]) {
			const dir = aToB ? -1 : 1;
			const arrays = [held, held + dir * SPAN, held + 2 * dir * SPAN].map((st) => tickArrayKey(pool, st));
			const amount = aToB ? (s.mintA === MINTS.tusdc.toBase58() ? 2_000_000_000n : 20_000_000_000n) : 2_000_000_000n;
			try {
				const bobA = ata(new PublicKey(s.mintA), bob.publicKey);
				const bobB = ata(new PublicKey(s.mintB), bob.publicKey);
				const ixs = [
					createAssociatedTokenAccountIdempotentInstruction(bob.publicKey, bobA, bob.publicKey, new PublicKey(s.mintA)),
					createAssociatedTokenAccountIdempotentInstruction(bob.publicKey, bobB, bob.publicKey, new PublicKey(s.mintB)),
				];
				await send(bob, ...ixs);
				const sig = await solveAs(bob).methods.swap(new BN(String(aToB ? (usdcIsB ? 20_000_000_000n : 2_000_000_000n) : (usdcIsB ? 2_000_000_000n : 20_000_000_000n))), new BN(0), new BN(aToB ? "4295048016" : "79226673515401279992447579055"), true, aToB).accounts({
					tokenAuthority: bob.publicKey, solve: pool, tokenOwnerAccountA: bobA, tokenVaultA: new PublicKey(s.vaultA), tokenOwnerAccountB: bobB, tokenVaultB: new PublicKey(s.vaultB),
					tickArray0: arrays[0], tickArray1: arrays[1], tickArray2: arrays[2], solvesConfig: new PublicKey(state.config),
				}).rpc();
				console.log(key, aToB ? "a->b" : "b->a", sig);
			} catch (e) {
				console.log(key, "SWAP FAILED", String(e.message ?? e).split("\n").slice(0, 8).join(" | "));
			}
		}
	}
}

if (step === "claim") {
	const positions = state.positions;
	const v = programFor("vesolve");
	for (const [k, pos] of Object.entries(positions)) {
		const [key, who] = k.split(":");
		const s = state[key];
		const pool = new PublicKey(s.pool);
		const owner = wallets[who];
		const resolved = await v.methods.configureNativeGauge(true).accounts({
			admin: admin.publicKey, solvesConfig: new PublicKey(state.config), pool, tokenMintA: new PublicKey(s.mintA), tokenMintB: new PublicKey(s.mintB), rewardMint: MINTS.solv3, solveProgram: IDS.solve,
		}).pubkeys();
		const positionMint = new PublicKey(pos.mint);
		const lowerStart = Math.floor(pos.lower / SPAN) * SPAN;
		const upperStart = Math.floor(pos.upper / SPAN) * SPAN;
		const rewardAta = ata(MINTS.solv3, owner.publicKey);
		const p = solveAs(owner);
		try {
			await send(owner, createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, rewardAta, owner.publicKey, MINTS.solv3));
			const before = BigInt((await conn.getTokenAccountBalance(rewardAta)).value.amount);
			const update = await p.methods.updateFeesAndRewards().accounts({
				solve: pool, position: new PublicKey(pos.position), tickArrayLower: tickArrayKey(pool, lowerStart), tickArrayUpper: tickArrayKey(pool, upperStart),
			}).instruction();
			const collect = await p.methods.collectReward(0).accounts({
				solve: pool, positionAuthority: owner.publicKey, position: new PublicKey(pos.position), positionTokenAccount: ata(positionMint, owner.publicKey),
				rewardOwnerAccount: rewardAta, rewardVault: resolved.rewardVault, tokenProgram: TOKEN_PROGRAM_ID,
			}).instruction();
			await send(owner, update, collect);
			const after = BigInt((await conn.getTokenAccountBalance(rewardAta)).value.amount);
			console.log(k, "claimed SOLV3 raw", (after - before).toString(), "=", Number(after - before) / 1e9);
		} catch (e) {
			console.log(k, "CLAIM FAILED", String(e.message ?? e).split("\n").slice(0, 8).join(" | "));
		}
	}
}

#!/usr/bin/env node
// Devnet: makes NEW_ADMIN (the epoch keeper's wallet) the vesolve admin, the DEX fee authority and the DEX
// collect-protocol-fees authority, signing as the current authority (the deployer key). The vesolve admin
// change is two-step: this proposes it, and NEW_ADMIN must accept (scripts on the server do that).
// Idempotent. The DEX reward-emissions super authority is deliberately left alone.
//   NEW_ADMIN=<pubkey> node scripts/devnet/handover-keeper-admin.mjs
import { PublicKey } from "@solana/web3.js";
import { admin, loadState, pda, programFor } from "./lib.mjs";

const next = new PublicKey(process.env.NEW_ADMIN ?? "");
const vesolve = programFor("vesolve");
const solve = programFor("solve");
const config = new PublicKey(loadState().config);

const show = async (label) => {
	const protocol = await vesolve.account.protocol.fetch(pda("vesolve", [Buffer.from("protocol")]));
	const adminConfig = await vesolve.account.adminConfig.fetch(pda("vesolve", [Buffer.from("admin_config")]));
	const dex = await solve.account.solvesConfig.fetch(config);
	console.log(label, JSON.stringify({
		protocolAdmin: protocol.admin.toBase58(),
		pendingAdmin: adminConfig.pendingAdmin.toBase58(),
		feeAuthority: dex.feeAuthority.toBase58(),
		collectProtocolFeesAuthority: dex.collectProtocolFeesAuthority.toBase58(),
		rewardEmissionsSuperAuthority: dex.rewardEmissionsSuperAuthority.toBase58(),
	}, null, 1));
	return { protocol, adminConfig, dex };
};

let { protocol, adminConfig, dex } = await show("before");
if (!protocol.admin.equals(next) && !adminConfig.pendingAdmin.equals(next)) {
	if (!protocol.admin.equals(admin.publicKey)) throw new Error("this key is not the current vesolve admin");
	console.log("propose_admin", await vesolve.methods.proposeAdmin(next).accounts({ admin: admin.publicKey }).rpc());
}
if (!dex.feeAuthority.equals(next)) {
	if (!dex.feeAuthority.equals(admin.publicKey)) throw new Error("this key is not the DEX fee authority");
	console.log("set_fee_authority", await solve.methods.setFeeAuthority()
		.accounts({ solvesConfig: config, feeAuthority: admin.publicKey, newFeeAuthority: next }).rpc());
}
if (!dex.collectProtocolFeesAuthority.equals(next)) {
	if (!dex.collectProtocolFeesAuthority.equals(admin.publicKey)) throw new Error("this key is not the collect-fees authority");
	console.log("set_collect_protocol_fees_authority", await solve.methods.setCollectProtocolFeesAuthority()
		.accounts({ solvesConfig: config, collectProtocolFeesAuthority: admin.publicKey, newCollectProtocolFeesAuthority: next }).rpc());
}
await show("after");

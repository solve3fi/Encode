import "server-only";
import { AnchorProvider, type Idl, Program, type Wallet } from "@coral-xyz/anchor";
import type { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { type Keypair, PublicKey } from "@solana/web3.js";
import type BN from "bn.js";
import { VESOLVE_IDL } from "@/configs/vesolveIdl";

// A hand-built Anchor Wallet instead of `new Wallet(authority)` — under
// Next's webpack bundling of this server route, @coral-xyz/anchor's `Wallet`
// resolves to a type-only export ("Wallet is not a constructor" at runtime),
// even though the class exists in the package's own Node build. Anchor's
// Wallet interface is small enough to satisfy directly from a Keypair.
const keypairWallet = (authority: Keypair): Wallet => ({
	publicKey: authority.publicKey,
	payer: authority,
	signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => {
		if ("partialSign" in tx) tx.partialSign(authority);
		else tx.sign([authority]);
		return tx;
	},
	signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => {
		for (const tx of txs) {
			if ("partialSign" in tx) tx.partialSign(authority);
			else tx.sign([authority]);
		}
		return txs;
	},
});

type RawProtocol = { nextNftTokenId: BN };
type AccountClient<T> = { fetch: (address: PublicKey) => Promise<T> };

// Anchor's generic Idl type can't be satisfied by this hand-written IDL
// const without exactly matching many nested literal types it wasn't
// designed to be authored against by hand, so the Program is built with the
// loose `Idl` type and this accessor is used instead of
// `program.account.protocol` directly — same convention as
// src/hooks/useVesolveProgram.ts's `vesolveAccount.protocol`.
export const vesolveProtocolAccount = (
	program: Program<Idl>,
): AccountClient<RawProtocol> =>
	(program.account as unknown as Record<string, AccountClient<RawProtocol>>)
		.protocol;

// Self-contained server-side copy of the PDA derivation in
// src/hooks/useVesolveProgram.ts, rather than importing that file directly —
// it transitively pulls in DappProvider.tsx ("use client", wallet-adapter),
// and this project already hit one bug this session
// (src/app/api/token-list-extra/route.ts) from a server route reading an
// export that crossed a "use client" boundary silently wrong. Not worth
// re-risking for a handful of PDA seeds.
export const VESOLVE_PROGRAM_ID = new PublicKey(
	(VESOLVE_IDL as Idl & { address: string }).address,
);
const PROTOCOL_SEED = Buffer.from("protocol");
const VE_LOCK_SEED = Buffer.from("ve_lock");
const VE_TOKEN_SEED = Buffer.from("ve_token");
export const METADATA_PROGRAM_ID = new PublicKey(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const u64LeBytes = (value: number | bigint): Buffer => {
	const buf = Buffer.alloc(8);
	let bn = BigInt(value);
	const eight = BigInt(8);
	for (let i = 0; i < 8; i++) {
		buf[i] = Number(bn & BigInt(0xff));
		bn >>= eight;
	}
	return buf;
};

export const getProtocolPDA = (): [PublicKey, number] =>
	PublicKey.findProgramAddressSync([PROTOCOL_SEED], VESOLVE_PROGRAM_ID);

export const getLockPDA = (veTokenId: number | bigint): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VE_LOCK_SEED, u64LeBytes(veTokenId)],
		VESOLVE_PROGRAM_ID,
	);

export const getVeMintPDA = (veTokenId: number | bigint): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[VE_TOKEN_SEED, u64LeBytes(veTokenId)],
		VESOLVE_PROGRAM_ID,
	);

export const getMetadataPDA = (veMint: PublicKey): [PublicKey, number] =>
	PublicKey.findProgramAddressSync(
		[
			Buffer.from("metadata"),
			METADATA_PROGRAM_ID.toBuffer(),
			veMint.toBuffer(),
		],
		METADATA_PROGRAM_ID,
	);

// Builds an Anchor Program the server can use to compose (not necessarily
// send) vesolve instructions, e.g. create_lock inside the airdrop claim
// transaction. `authority` only needs to be a valid fee-payer wallet shape
// for AnchorProvider's constructor — it is not necessarily a required
// signer of every instruction built from this Program.
export const getVesolveServerProgram = (
	connection: Connection,
	authority: Keypair,
): Program => {
	const provider = new AnchorProvider(connection, keypairWallet(authority), {
		commitment: "confirmed",
	});
	return new Program(VESOLVE_IDL as Idl, provider);
};

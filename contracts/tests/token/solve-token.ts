import type { Program } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getOrCreateAssociatedTokenAccount,
	TOKEN_PROGRAM_ID,
	transfer,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";
import type { Token } from "../../target/types/token";

describe("solve token", () => {
	const provider = anchor.AnchorProvider.env();
	anchor.setProvider(provider);

	const program = anchor.workspace.token as Program<Token>;
	const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
		"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
	);

	let bob: anchor.web3.Keypair;
	let alice: anchor.web3.Keypair;

	let mint: anchor.web3.PublicKey;
	let mintConfig: anchor.web3.PublicKey;
	let metaDataAddress: anchor.web3.PublicKey;

	const tokenMeta = {
		decimals: 9,
		name: "SolveToken",
		symbol: "SOLVE",
		uri: "https://5vfxc4tr6xoy23qefqbj4qx2adzkzapneebanhcalf7myvn5gzja.arweave.net/7UtxcnH13Y1uBCwCnkL6APKsge0hAgacQFl-zFW9NlI",
	};

	before(async () => {
		bob = anchor.web3.Keypair.generate();
		alice = anchor.web3.Keypair.generate();

		await Promise.all([
			provider.connection.requestAirdrop(
				bob.publicKey,
				10 * anchor.web3.LAMPORTS_PER_SOL,
			),
			provider.connection.requestAirdrop(
				alice.publicKey,
				10 * anchor.web3.LAMPORTS_PER_SOL,
			),
		]);

		await new Promise((resolve) => setTimeout(resolve, 2000));

		[mint] = anchor.web3.PublicKey.findProgramAddressSync(
			[Buffer.from("mint")],
			program.programId,
		);

		[mintConfig] = anchor.web3.PublicKey.findProgramAddressSync(
			[Buffer.from("mint_config"), mint.toBuffer()],
			program.programId,
		);

		[metaDataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
			[
				Buffer.from("metadata"),
				TOKEN_METADATA_PROGRAM_ID.toBuffer(),
				mint.toBuffer(),
			],
			TOKEN_METADATA_PROGRAM_ID,
		);
	});

	it("Initialize Mint", async () => {
		const configData =
			await program.account.mintConfig.fetchNullable(mintConfig);
		if (configData) {
			console.log("Mint Config already exists at ", mint.toBase58());
			return;
		}

		const context = {
			authority: provider.wallet.publicKey,
			metadata: metaDataAddress,
			mintConfig,
			mint,
			rent: anchor.web3.SYSVAR_RENT_PUBKEY,
			systemProgram: anchor.web3.SystemProgram.programId,
			tokenProgram: TOKEN_PROGRAM_ID,
			metadataProgram: TOKEN_METADATA_PROGRAM_ID,
		};
		const tx = await program.methods
			.initializeMint(
				tokenMeta.decimals,
				tokenMeta.name,
				tokenMeta.symbol,
				tokenMeta.uri,
			)
			.accounts(context)
			.rpc();

		console.log("Mint Config created at ", mintConfig.toBase58());
		console.log("tx", tx);
	});

	it("Mint Tokens", async () => {
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			provider.connection,
			provider.wallet.payer,
			mint,
			provider.wallet.publicKey,
		);

		const context = {
			authority: provider.wallet.publicKey,
			mint,
			mintConfig,
			tokenAccount: tokenAccount.address,
			instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
			tokenProgram: TOKEN_PROGRAM_ID,
			systemProgram: anchor.web3.SystemProgram.programId,
			associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		};

		const tx = await program.methods
			.mintTokens(new BN(100 * 10 ** 9))
			.accounts(context)
			.rpc();

		assert.ok(tx);
	});

	it("Mint Tokens to Bob", async () => {
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			provider.connection,
			provider.wallet.payer,
			mint,
			bob.publicKey,
		);

		const context = {
			authority: provider.wallet.publicKey,
			mint,
			mintConfig,
			tokenAccount: tokenAccount.address,
			instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
			tokenProgram: TOKEN_PROGRAM_ID,
			systemProgram: anchor.web3.SystemProgram.programId,
			associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		};

		const tx = await program.methods
			.mintTokens(new BN(1000000000))
			.accounts(context)
			.rpc();

		assert.ok(tx);

		const bobBalance = await provider.connection.getTokenAccountBalance(
			tokenAccount.address,
		);
		assert.ok(bobBalance.value.amount === "1000000000");
	});

	it("Bob can not mint tokens", async () => {
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			provider.connection,
			bob,
			mint,
			bob.publicKey,
		);

		const context = {
			authority: bob.publicKey,
			mint,
			mintConfig,
			tokenAccount: tokenAccount.address,
			instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
			tokenProgram: TOKEN_PROGRAM_ID,
			systemProgram: anchor.web3.SystemProgram.programId,
			associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
		};

		try {
			await program.methods
				.mintTokens(new BN(1000000000))
				.accounts(context)
				.signers([bob])
				.rpc();
		} catch (error) {
			assert.isTrue(error instanceof anchor.AnchorError);
			assert.strictEqual(error.error.errorMessage, "Unauthorized mint access");
		}
	});

	it("Transfer token to Alice", async () => {
		const aliceWallet = new anchor.web3.PublicKey(
			"UrZ9FRPZhcKMXUANfQxLNPwZHpQKaKumaxXvdjEP9MH",
		);
		const tokenAccount = await getOrCreateAssociatedTokenAccount(
			provider.connection,
			provider.wallet.payer,
			mint,
			provider.wallet.publicKey,
		);

		const aliceTokenAccount = await getOrCreateAssociatedTokenAccount(
			provider.connection,
			provider.wallet.payer,
			mint,
			aliceWallet,
		);

		const tx = await transfer(
			provider.connection,
			provider.wallet.payer,
			tokenAccount.address,
			aliceTokenAccount.address,
			provider.wallet.publicKey,
			100000000000,
		);

		assert.ok(tx);
	});
});

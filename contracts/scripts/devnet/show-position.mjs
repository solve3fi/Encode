// Prints the liquidity of the position whose NFT mint is argv[2]. Read-only.
import { PublicKey } from "@solana/web3.js";
import { pda, programFor } from "./lib.mjs";
const mint = new PublicKey(process.argv[2]);
const position = pda("solve", [Buffer.from("position"), mint.toBuffer()]);
const p = await programFor("solve").account.position.fetch(position);
console.log("position", position.toBase58(), "liquidity", p.liquidity.toString(), "ticks", p.tickLowerIndex, p.tickUpperIndex, "pool", p.solve.toBase58().slice(0, 8));

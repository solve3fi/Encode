// Lists which fee-tier accounts exist on the devnet clean-DEX config (what the pool UI shows as enabled).
import { PDAUtil } from "@solve3fi/sdk";
import { PublicKey } from "@solana/web3.js";
import { createResilientConnection } from "./lib/resilient-rpc.mjs";

const PROGRAM = new PublicKey(process.env.SOLVE3_DEX ?? "HnosXNWPvKSFkY6xjUpCJ9nhbvTRhdfNTfWpgp3m4GK");
const CONFIG = new PublicKey(process.env.SOLVE3_CONFIG ?? "F2QtwRjDpdVR25n3ZMWpmAKdMK21LDdi3pTGUTc8ELef");
const SPACINGS = [1, 2, 3, 4, 8, 16, 64, 96, 128, 256, 384, 512, 640];
const connection = createResilientConnection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed", { attempts: 12, maxDelayMs: 20000 });
const keys = SPACINGS.map((spacing) => PDAUtil.getFeeTier(PROGRAM, CONFIG, spacing).publicKey);
const infos = await connection.getMultipleAccountsInfo(keys);
for (const [i, spacing] of SPACINGS.entries()) console.log(`tick spacing ${spacing}: ${infos[i] ? "enabled" : "not enabled"}`);

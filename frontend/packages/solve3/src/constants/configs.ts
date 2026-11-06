import { PublicKey } from "@solana/web3.js";

import contractIdl from "../artifacts/solve3.json";

export const VE_PROGRAM_INTERFACE = JSON.parse(JSON.stringify(contractIdl));

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
	"metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

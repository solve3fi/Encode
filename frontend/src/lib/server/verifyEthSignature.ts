import "server-only";
import { verifyMessage } from "ethers";

/**
 * Verifies an Ethereum personal_sign message server-side and returns the
 * recovered signer address (checksummed), or null if the signature is
 * invalid/malformed. Used to prove control of a 0x address from the airdrop
 * snapshot — nobody has a Solana keypair for those, so this is the identity
 * proof instead (the claimant signs with MetaMask, we ecrecover and check
 * it matches the allocation's owner address).
 */
export const recoverEthSigner = (
	message: string,
	signature: string,
): string | null => {
	try {
		return verifyMessage(message, signature);
	} catch {
		return null;
	}
};

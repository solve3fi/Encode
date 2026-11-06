import { expect, test } from "bun:test";
import BN from "bn.js";
import {
	claimedSolv3ToLock,
	formatSolv3,
	highestVeNft,
} from "./rewardClaimLockMerge";

test("keeps the largest veNFT and breaks ties by lower identifier", () => {
	const locks = [
		{ identifier: new BN(9), tokenAmount: new BN(100) },
		{ identifier: new BN(3), tokenAmount: new BN(200) },
		{ identifier: new BN(2), tokenAmount: new BN(200) },
	];
	expect(highestVeNft(locks)?.identifier.toNumber()).toBe(2);
	expect(highestVeNft([])).toBeUndefined();
});

test("locks at most the claimed SOLV3, excluding pre-existing balance", () => {
	expect(claimedSolv3ToLock(500n, 800n, 400n)).toBe(300n);
	expect(claimedSolv3ToLock(500n, 900n, 200n)).toBe(200n);
	expect(claimedSolv3ToLock(500n, 400n, 200n)).toBe(0n);
	expect(claimedSolv3ToLock(500n, 900n, 0n)).toBe(0n);
});

test("shows exact SOLV3 fractions", () => {
	expect(formatSolv3(1_234_000_001n)).toBe("1.234000001");
	expect(formatSolv3(2_000_000_000n)).toBe("2");
});

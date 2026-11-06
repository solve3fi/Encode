import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isListedInTokenPicker } from "../src/lib/tokenPicker.ts";

const list = JSON.parse(readFileSync(new URL("../src/configs/tokenLists/default.tokenlist.json", import.meta.url), "utf8"));
const legacy = list.tokens.filter((token) => token.chainId === 102);
const removed = legacy.filter((token) => !isListedInTokenPicker(token));
assert.deepEqual(removed.map((token) => token.symbol).sort(), ["SOLV3", "xSOLV3", "devUSDC", "devUSDT", "devSAMO", "devTMAC", "WOOF", "TEST"].sort());
assert.deepEqual(legacy.filter(isListedInTokenPicker).map((token) => token.symbol).sort(), ["MEOW", "SOL"]);

for (const address of [
	"9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn", // active SOLV3
	"FrN7oiLccXBSRCJGoAACUHSp3Efvji7mkwfGpZXcV6Up", // active devUSDC
	"EmvAdJAFdPFgRtraDYhosM7riLpPq35b38TzWJ6Fb6ow", // approved TIGGER
	"6RydWWDfVxTgmDWHSwrcEitrjySqMohnf4vfSWx4ka1f", // tSOL
	"BdsGWxAqx8FkoMrG4XXPhVnJYw63TnrNEyUgGS8idxm7", // TBRIBE
]) assert.equal(isListedInTokenPicker({ chainId: 102, address }), true);

// A community token with the same ticker is not the retired mint.
assert.equal(isListedInTokenPicker({ chainId: 102, address: "new-community-mint", symbol: "TEST" }), true);
for (const token of removed) {
	for (const chainId of [101, 103, 104]) assert.equal(isListedInTokenPicker({ ...token, chainId }), true);
	assert.equal(isListedInTokenPicker({ ...token, symbol: "RENAMED" }), false);
}
console.log("PASS: eight legacy devnet mints hidden; active, community, and other-network tokens preserved.");

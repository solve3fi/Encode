// Legacy devnet mints retired from the default token picker. Match by mint,
// not symbol: the active SOLV3 and devUSDC use the same symbols as old tokens.
// Keep their metadata available to existing positions and explicit mint lookups.
const RETIRED_DEVNET_MINTS = new Set([
	"Gmxv83QkYpmT2NXwRAEbqfxbeuzftLsHyiBmLpSGj6at", // old SOLV3
	"AuWNjJrBhuyRna415rW1S6StEjs4TFUTgu6bF7CYrCo1", // xSOLV3
	"BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k", // old devUSDC
	"H8UekPGwePSmQ3ttuYGPU1szyFfjZR4N53rymSFwpLPm", // devUSDT
	"Jd4M8bfJG3sAkd82RsGWyEXoaBXQP7njFzBwEaCTuDa", // devSAMO
	"Afn8YB1p4NsoZeS5XJBZ18LTfEy5NFPwN46wapZcBQr6", // devTMAC
	"BetzELXJMGXJGkzxZbMqAzwLJ4M7sUrsqpW8JZp2WG2e", // WOOF
	"DzkTGZGQsh8zsYo275JSQgwqRmREKb3D617EMCg2njao", // TEST
]);

export function isListedInTokenPicker(token: { chainId: number; address: string }): boolean {
	return token.chainId !== 102 || !RETIRED_DEVNET_MINTS.has(token.address);
}

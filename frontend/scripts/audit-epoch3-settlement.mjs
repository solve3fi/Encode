// Read-only reconciliation of the controlled epoch 2 -> 3 devnet test.
import { Connection } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const mint = "9Xn8ko7AwH8HBRLt6Ci6oYxFjPN1sBoUrkDWeTPCPacn";
const transactions = [
  ["rollover", "3H51Fdy7Y8jG2eogCG7cW919KB3YjHXzSAuCYAhLnRXHtCHjchtjMBY4g5uyhbPnNBhsNTjUTWJ2odGCVuXgB4uN", 0n],
  ["developer", "2P5BLYFNVZKJiszAbqUjycd7DC59EAxiA1fkfBu8cX8nbakXfjMXcR123aksVBDHqGndHY5Rv2fVQ9dYxKL2kBuq", 49940800000000n],
  ["BONK3", "5Cjs8rqNhaooE6cmniQwLZeWwK2xh7WeA5Vz9U2MW9YAeW68W9gQUcNzCHumjEhnxo9xXMaABhaUGF5cptMCA634", 239715840000000n],
  ["WIF3", "4m9QhjgtMBkwMdxFNH4Kqw2rijDH4TnEYLX3smNsdcqF1Z1dHgQhP1YV4EovPi4UzLhqAuTkxdV6mTV4tJKKrRpx", 359573760000000n],
  ["PEPE3", "563W3vbArCcouxdpDYRfs3HiaVgpfcDj1vM8F8J7QrhCuYnqHnwRnc6KQAute3r5C97W98J21Pjgp3FfxPxdpHuD", 599289600000000n],
  ["epoch3-vote", "2PjckqQVh75vypnwbQxUT5bz9i69r6NiT45jqQAgPNn5g8bSBwXNmXzymXfwem6UqDrm3Vnq5fUKctCTjdJxqnd3", 0n],
];
for (const [action, signature, expected] of transactions) {
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx?.meta || tx.meta.err) throw new Error(`${action}: missing or failed transaction`);
  const changes = (tx.meta.postTokenBalances ?? []).filter((balance) => balance.mint === mint).map((balance) => {
    const before = tx.meta.preTokenBalances?.find((item) => item.accountIndex === balance.accountIndex);
    return { owner: balance.owner, delta: (BigInt(balance.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0")).toString(), balance: balance.uiTokenAmount.amount };
  });
  const minted = changes.reduce((total, item) => total + BigInt(item.delta), 0n);
  if (minted !== expected) throw new Error(`${action}: expected ${expected}, got ${minted}`);
  console.log(JSON.stringify({ action, signature, slot: tx.slot, blockTime: tx.blockTime, expectedRawAmount: expected.toString(), changes, verified: true }));
}

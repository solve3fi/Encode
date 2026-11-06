import { readFileSync } from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
const idl = JSON.parse(readFileSync(new URL('../src/configs/vesolve.json', import.meta.url), 'utf8'));
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const wallet = { publicKey: PublicKey.default, signTransaction: async () => { throw new Error('Read-only'); }, signAllTransactions: async () => { throw new Error('Read-only'); } };
const program = new Program(idl, new AnchorProvider(connection, wallet, {}));
const [gauges, epochs, vaults] = await Promise.all([program.account.gauge.all(), program.account.epoch.all(), program.account.vaultData.all()]);
console.log(JSON.stringify({ gauges:gauges.map(g=>({address:g.publicKey.toString(),pool:g.account.poolAddress.toString(),active:g.account.isActive})), epochs:epochs.map(e=>({epoch:e.account.epoch.toString(),power:e.account.totalVotingPower.toString(),weights:e.account.gaugeWeights.map(g=>({gauge:g.gauge.toString(),weight:g.weight.toString()}))})), vaults:vaults.map(v=>({gauge:v.account.gauge.toString(),epoch:v.account.epoch.toString(),feeA:v.account.poolRewardsA.toString(),feeB:v.account.poolRewardsB.toString()})) },null,2));

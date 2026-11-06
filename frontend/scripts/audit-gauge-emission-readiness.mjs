// Public RPC only: inspect upgrade/account compatibility without signing anything.
import anchor from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { SolveContext } from '@solve3fi/sdk';
import idl from '../src/configs/vesolve.json' with { type: 'json' };

const connection = new Connection(process.env.SOLVE3_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
const wallet = { publicKey: PublicKey.default, signTransaction: async () => { throw new Error('Read only'); }, signAllTransactions: async () => { throw new Error('Read only'); } };
const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' }));
const dex = SolveContext.from(connection, wallet, new PublicKey('Bwkxu4ZnWgPAwCCfBmT3D95EmdiMVuY88Rs7mTBaKysb'));
const address = (seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const u64 = (value) => new anchor.BN(value).toArrayLike(Buffer, 'le', 8);
const owner = new PublicKey('HGUPXpPUhD6PiTSWexebRSsgCT1uDAgiKk2DvdRHsq6o');
const protocol = await program.account.protocol.fetch(address([Buffer.from('protocol')]));
const epoch = protocol.currentEpoch.toString();
const locks = await program.account.lock.all([{ memcmp: { offset: 8, bytes: owner.toString() } }]);
const userVote = await program.account.userVote.fetchNullable(address([Buffer.from('user_vote'), owner.toBuffer(), u64(epoch)]));
const rawAccounts = await connection.getProgramAccounts(program.programId, { commitment: 'confirmed' });
const decode = (type) => {
  const discriminator = Buffer.from(idl.accounts.find((item) => item.name.replaceAll('_', '').toLowerCase() === type.toLowerCase()).discriminator);
  return rawAccounts.filter((item) => item.account.data.subarray(0, 8).equals(discriminator)).map((item) => {
    try {
      const state = program.coder.accounts.decode(type, item.account.data);
      return { address: item.pubkey.toString(), bytes: item.account.data.length, compatible: true, state };
    } catch (error) {
      return { address: item.pubkey.toString(), bytes: item.account.data.length, compatible: false, error: error.message };
    }
  });
};
const gauges = await program.account.gauge.all();
const pools = [];
for (const gauge of gauges) {
  const pool = await dex.fetcher.getPool(gauge.account.poolAddress, { maxAge: 0 });
  if (!pool) throw new Error(`Missing gauge pool ${gauge.account.poolAddress}`);
  pools.push({ gauge: gauge.publicKey.toString(), active: gauge.account.isActive, pool: gauge.account.poolAddress.toString(), protocolFeeRate: pool.protocolFeeRate, rewards: pool.rewardInfos.map((reward) => ({ mint: reward.mint.toString(), vault: reward.vault.toString(), growthGlobalX64: reward.growthGlobalX64.toString() })) });
}
const rewards = decode('gaugeReward').map(({ state, ...item }) => ({ ...item, ...(state ? { totalWeight: (state.totalWeight ?? state.totalStakedLiquidity)?.toString(), lastFundedEpoch: state.lastFundedEpoch?.toString(), periodFinish: state.periodFinish?.toString() } : {}) }));
const stakes = decode('gaugeStake').map(({ state, ...item }) => ({ ...item, ...(state ? { owner: state.owner.toString(), position: state.position.toString(), weight: state.weight?.toString(), liquidity: state.liquidity?.toString(), accruedRewards: state.accruedRewards?.toString() } : {}) }));
console.log(JSON.stringify({ observedAt: new Date().toISOString(), genesisHash: await connection.getGenesisHash(), currentEpoch: epoch, epochStart: protocol.epochStartTime.toString(), epochEnd: protocol.epochStartTime.add(protocol.epochResetTime).toString(), owner: owner.toString(), locks: locks.map(({ publicKey, account }) => ({ address: publicKey.toString(), id: account.veTokenId.toString(), lastVoteEpoch: account.lastVoteEpoch.toString(), votedCurrentEpoch: account.lastVoteEpoch.eq(protocol.currentEpoch) })), userVote: userVote ? { epoch: userVote.epoch.toString(), votes: userVote.votes.map((vote) => ({ gauge: vote.gauge.toString(), weight: vote.weight.toString() })) } : null, rewards, stakes, pools }, null, 2));

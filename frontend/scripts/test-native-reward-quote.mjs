import assert from 'node:assert/strict';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { collectRangeRewardsQuote, nativeRewardEnd } from '../src/lib/nativeRewardQuote.ts';
import { gaugeEmissionAllocation } from '../src/lib/gaugeEmissionAllocation.ts';

const key = n => new PublicKey(Buffer.alloc(32, n));
const zero = () => new BN(0);
const x64 = n => new BN(n).shln(64);
const primary = Buffer.alloc(32); primary[0] = 2; primary.writeBigUInt64LE(100n, 2);
const pool = {
  liquidity: new BN(400), tickCurrentIndex: 0, rewardLastUpdatedTimestamp: zero(),
  rewardInfos: [0, 1, 2].map(i => ({ mint: key(10 + i), vault: key(20 + i),
    authority: i === 1 ? new PublicKey(primary) : PublicKey.default,
    emissionsPerSecondX64: x64((i + 1) * 10), growthGlobalX64: zero() })),
};
const params = {
  solve: pool, position: { liquidity: new BN(100), tickLowerIndex: -10, tickUpperIndex: 10,
    rewardInfos: [0, 1, 2].map(() => ({ amountOwed: zero(), growthInsideCheckpoint: zero() })) },
  tickLower: { initialized: true, rewardGrowthsOutside: [zero(), zero(), zero()] },
  tickUpper: { initialized: true, rewardGrowthsOutside: [zero(), zero(), zero()] },
  tokenExtensionCtx: { currentEpoch: 0, rewardTokenMintsWithProgram: [0, 1, 2].map(() => ({
    tokenProgram: TOKEN_PROGRAM_ID, tlvData: Buffer.alloc(0) })) },
  timeStampInSeconds: new BN(200),
};
assert.equal(nativeRewardEnd(pool).toString(), '100');
assert.deepEqual(collectRangeRewardsQuote(params).rewardOwed.map(x => x.toString()), ['250', '1000', '1500'],
  'Native slot stops at epoch end; two independent reward slots keep accruing');
pool.rewardLastUpdatedTimestamp = new BN(150);
assert.deepEqual(collectRangeRewardsQuote(params).rewardOwed.map(x => x.toString()), ['0', '250', '375']);
assert.deepEqual(collectRangeRewardsQuote({ ...params, timeStampInSeconds: new BN(100) }).rewardOwed.map(x => x.toString()), ['0', '0', '0'],
  'Clock skew must not create negative rewards');
pool.rewardLastUpdatedTimestamp = zero();
pool.rewardInfos[2].authority = key(33);
assert.equal(nativeRewardEnd(pool), null, 'Unmigrated legacy extension is not a native schedule');
assert.deepEqual(collectRangeRewardsQuote(params).rewardOwed.map(x => x.toString()), ['500', '1000', '1500']);
pool.rewardInfos[2].authority = PublicKey.default;
pool.rewardInfos[1].authority = PublicKey.default;
assert.equal(nativeRewardEnd(pool), null);
params.solve.tickCurrentIndex = 10;
assert.deepEqual(collectRangeRewardsQuote(params).rewardOwed.map(x => x.toString()), ['0', '0', '0'], 'Upper range bound is exclusive');
console.log('PASS: real SDK native reward deadline, independent rewards, clock skew, legacy detection and out-of-range quote');
assert.equal(gaugeEmissionAllocation(new BN(1000), new BN(1), new BN(3)).toString(), '333');
assert.equal(gaugeEmissionAllocation(new BN(1000), new BN(0), new BN(0)).toString(), '0');
assert.throws(() => gaugeEmissionAllocation(new BN(1000), new BN(4), new BN(3)), /Invalid/);
assert.equal(gaugeEmissionAllocation(new BN('1057146854400000'), new BN(1), new BN(3)).toString(), '352382284800000');
console.log('PASS: exact vote-weighted weekly allocation independent of late/resumed stream rate');

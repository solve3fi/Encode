import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { deriveDevnetPrices, valueTokenAmounts } from '../src/lib/devnetPricing.ts';
const stable = 'active-devUSDC';
function pool(address, mintA, mintB, ratio, amountA=1000, amountB=1000, decimalsA=9, decimalsB=6) {
 return {address,mintA,mintB,decimalsA,decimalsB,liquidity:'1000000',
  sqrtPrice:new Decimal(ratio).div(new Decimal(10).pow(decimalsA-decimalsB)).sqrt().mul(new Decimal(2).pow(64)).floor().toFixed(0),
  amountA:new Decimal(amountA).mul(new Decimal(10).pow(decimalsA)).toFixed(0),
  amountB:new Decimal(amountB).mul(new Decimal(10).pow(decimalsB)).toFixed(0)};
}
const near = (actual,expected) => assert.ok(new Decimal(actual).sub(expected).abs().lt('0.000000001'),`${actual} != ${expected}`);
assert.equal(deriveDevnetPrices([],stable).get(stable).toString(),'1');
const pools=[pool('stable-pool','SOLV3',stable,2),pool('meme-pool','MEME','SOLV3',0.25),
 pool('empty','EMPTY',stable,100),pool('unconnected','X','Y',1),
 pool('dust','SOLV3',stable,999,0.00001,0.01),pool('inverse',stable,'INVERSE',4)];
pools[2].liquidity='0';
const prices=deriveDevnetPrices(pools,stable);
near(prices.get('SOLV3'),2);near(prices.get('MEME'),0.5);near(prices.get('INVERSE'),0.25);
assert.equal(prices.get(stable).toString(),'1');
assert.equal(prices.has('EMPTY'),false);assert.equal(prices.has('X'),false);
assert.equal(prices.has('old-devUSDC'),false);
const reversed=deriveDevnetPrices([...pools].reverse(),stable);
for(const [mint,price] of prices) assert.equal(reversed.get(mint).toString(),price.toString());
const tvl=valueTokenAmounts({SOLV3:100,[stable]:50},prices);
near(tvl.total,250);assert.equal(tvl.isComplete,true);
const reward=valueTokenAmounts({SOLV3:10},prices);
near(reward.total,20);near(reward.total.div(tvl.total).mul(52).mul(100),416);
near(valueTokenAmounts({[stable]:12.34},deriveDevnetPrices([],stable)).total,12.34);
assert.equal(valueTokenAmounts({UNKNOWN:0},prices).isComplete,true);
assert.equal(valueTokenAmounts({UNKNOWN:1,[stable]:10},prices).isComplete,false);
assert.equal(valueTokenAmounts({[stable]:NaN},prices).isComplete,false);
assert.equal(valueTokenAmounts({[stable]:-1},prices).isComplete,false);
console.log('PASS: exact peg, mixed decimals, inverse/multi-hop pricing, funded-depth selection, empty/unconnected pools, totals and shared-mint APR inputs.');

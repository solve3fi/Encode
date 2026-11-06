const $=s=>document.querySelector(s);
const usd=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct=n=>`${n>=0?'+':''}${n.toFixed(2)}%`;
const date=at=>new Date(at*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const name=c=>c.kind==='hold'?'Hold 50 / 50':c.kind==='static'?`Static ${c.width===10?'wide':c.width*100+'%'}`:`${c.kind==='volatility'?`${c.width}× daily volatility`:'Delayed '+c.width*100+'%'} · ${c.balancing?'balanced':'no swaps'} · ${c.cooldownHours}h cooldown`;
let research;
function renderDepth(){const r=research.depthSensitivity.find(r=>r.multiple===Number($('#backtest-depth').value));$('#backtest-depth-result').textContent=`${usd(r.endingUSD)} ending value · ${pct(r.returnPct)} return · ${usd(r.excessVsHoldUSD)} versus holding.`;}
function chart(chosen,hold){
 const data=chosen.history,all=data.flatMap((h,i)=>[h.netUSD,hold.history[i].netUSD]);
 const low=Math.min(...all)*.999,high=Math.max(...all)*1.001;
 const x=i=>58+i/(data.length-1)*820,y=v=>218-(v-low)/(high-low)*190;
 const line=values=>values.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
 let grid='';for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;grid+=`<line x1="58" y1="${y(v)}" x2="878" y2="${y(v)}" stroke="#e7eaee"/><text x="50" y="${y(v)+4}" text-anchor="end" fill="#727c8b" font-size="12">${Math.round(v).toLocaleString()}</text>`;}
 $('#backtest-chart').innerHTML=grid+`<path d="${line(hold.history.map(h=>h.netUSD))}" fill="none" stroke="#9aa5b3" stroke-width="2"/><path d="${line(data.map(h=>h.netUSD))}" fill="none" stroke="#1479ec" stroke-width="2.5"/><text x="58" y="248" fill="#727c8b" font-size="12">${date(data[0].at)}</text><text x="878" y="248" text-anchor="end" fill="#727c8b" font-size="12">${date(data.at(-1).at)}</text>`;
}
async function load(){try{
 const response=await fetch('./research/orca-solusdc.json');if(!response.ok)throw Error('Research results unavailable.');research=await response.json();
 const chosen=research.test.find(r=>r.candidate.id===research.selected.id),hold=research.test.find(r=>r.candidate.kind==='hold');
 const metrics=[['Selected net return',pct(chosen.returnPct),`${usd(chosen.netProfitUSD)} on $10,000`],['Compared with holding',usd(chosen.excessVsHoldUSD),`Holding returned ${pct(hold.returnPct)}`],['Estimated LP fees',usd(chosen.feesUSD),'Current depth scenario'],['Maximum drawdown',chosen.maxDrawdownPct.toFixed(2)+'%',`${chosen.timeInRangePct.toFixed(1)}% time in range`]];
 $('#backtest-metrics').innerHTML=metrics.map(([label,value,foot])=>`<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`).join('');
 $('#backtest-period').textContent=`${date(chosen.startAt)} – ${date(chosen.endAt)} UTC · ${name(chosen.candidate)}`;chart(chosen,hold);
 $('#backtest-table').innerHTML='<thead><tr><th>Strategy</th><th>Net end</th><th>Return</th><th>vs holding</th><th>Est. fees</th><th>Drawdown</th><th>In range</th><th>Rebalances</th></tr></thead><tbody>'+research.test.map(r=>`<tr class="${r.candidate.id===research.selected.id?'research-selected':''}"><td>${escape(name(r.candidate))}${r.candidate.id===research.selected.id?' <strong>Selected</strong>':''}</td><td>${usd(r.endingUSD)}</td><td>${pct(r.returnPct)}</td><td>${usd(r.excessVsHoldUSD)}</td><td>${usd(r.feesUSD)}</td><td>${r.maxDrawdownPct.toFixed(2)}%</td><td>${r.timeInRangePct.toFixed(1)}%</td><td>${r.rebalanceCount}</td></tr>`).join('')+'</tbody>';
 const t=research.solve3Transfer;
 $('#backtest-transfer').innerHTML=`<strong>The same strategy needs different economics.</strong><p>At Solve3’s sampled ${usd(t.dailyVolume)}/day net swap-like flow, the modeled return is <strong>${pct(t.returnPct)}</strong> (${usd(t.netProfitUSD)}), or ${usd(t.excessVsHoldUSD)} versus holding. This is a counterfactual using current Solve3 liquidity and only ${t.sampleHours.toFixed(1)} hours of flow, not historical Solve3 performance.</p><p>If a ve33 gauge sends all trading fees to voters, LP fee income becomes zero. The modeled return without LP fees is ${pct(t.zeroLpFeeReturnPct)}; verified emissions need to be modeled separately.</p>`;
 $('#backtest-method').innerHTML=`<p>${research.rows.toLocaleString()} consecutive Orca hourly candles: ${date(research.firstAt)} – ${date(research.lastAt)}. Pool: <code>${escape(research.pool)}</code>.</p><p>175 candidates. Train on the first 60%, shortlist 12, select on the next 20%, then evaluate once on the final 20%. Screen for ≤35% drawdown and ≥50% range occupancy. Holding stays the benchmark. Selected: ${escape(name(research.selected))}; trailing lookback 72 hours, no idle reserve. Research parameters are separate from live keeper settings.</p><p>Pool fee 0.04%, LP share 87%, modeled cost $0.50 per action, initial deployment and final exit included. Balancing candidates also pay 4 bps pool fee + 5 bps slippage. No compounding.</p><details><summary>Assumptions and limits</summary><ul>${research.limitations.map(l=>`<li>${escape(l)}</li>`).join('')}</ul></details>`;
 $('#backtest-data').hidden=false;$('#backtest-status').textContent='';$('#backtest-depth').addEventListener('change',renderDepth);renderDepth();
 }catch(error){$('#backtest-status').textContent=error.message;}}
load();

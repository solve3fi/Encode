import {units,short,price} from './model.js';
const $=s=>document.querySelector(s);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={'So11111111111111111111111111111111111111112':'wSOL','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v':'USDC'};
const symbol=mint=>symbols[mint]||short(mint);
const explorer=(address,label=short(address))=>`<a href="https://explorer.solana.com/address/${encodeURIComponent(address)}" target="_blank" rel="noreferrer">${esc(label)} ↗</a>`;
let last=null,busy=false;
function setBusy(value){busy=value;$('#mainnet-refresh').disabled=value;$('#mainnet-wallet').disabled=value;$('#mainnet-export').disabled=value||!last;}
async function refresh(){
 if(busy)return;setBusy(true);$('#mainnet-error').textContent='';$('#mainnet-data').hidden=true;last=null;
 $('#mainnet-status').textContent='Verifying mainnet genesis, deployment bytes and pool identities…';
 try{
  const{MainnetReader,MAINNET}=await import('./trial-engine.js');
  const extra=$('#mainnet-extra-pool').value.trim(),owner=$('#mainnet-owner').value.trim();
  const pools=[...MAINNET.pools];if(extra&&!pools.includes(extra))pools.push(extra);
  last=await new MainnetReader().observe(pools,owner||undefined);render();
 }catch(error){$('#mainnet-error').textContent=error.message||'Mainnet observation failed. Retry shortly.';$('#mainnet-status').textContent='Mainnet data is unavailable. No current balances or positions are being displayed.';}
 finally{setBusy(false);}
}
function render(){
 $('#mainnet-data').hidden=false;
 $('#mainnet-status').textContent=`Observed ${new Date(last.observedAt).toLocaleString()} · finalized slots ${last.slotStart}–${last.slotEnd} · refresh manually for a new observation.`;
 $('#mainnet-pools').innerHTML=last.pools.map(p=>`<section class="panel trial-card"><span class="eyebrow">SOLVE3 / MAINNET</span><h2 class="mainnet-pair">${esc(symbol(p.mintA))} / ${esc(symbol(p.mintB))}</h2><p class="live-address">${explorer(p.address,p.address)}</p><div class="live-pool-number">${price(Number(p.priceBPerA))} ${esc(symbol(p.mintB))}</div><p>Pool price per ${esc(symbol(p.mintA))} · not an independent market oracle</p><dl><div><dt>Trading fee</dt><dd>${p.feeRate/10000}%</dd></div><div><dt>Pool protocol share of swap fees</dt><dd>${p.protocolFeeRate/100}%</dd></div><div><dt>Current tick / spacing</dt><dd>${p.tick} / ${p.tickSpacing}</dd></div><div><dt>Vault reserve · ${esc(symbol(p.mintA))}</dt><dd>${units(p.reserveA,p.decimalsA)}</dd></div><div><dt>Vault reserve · ${esc(symbol(p.mintB))}</dt><dd>${units(p.reserveB,p.decimalsB)}</dd></div><div><dt>Raw active liquidity</dt><dd>${esc(p.liquidity)}</dd></div><div><dt>Pause flags</dt><dd>${p.tradingPauses===0?'None':p.tradingPauses}</dd></div></dl><p class="trial-note">Vault balances include all pool inventory and may include fee obligations. They are not a portfolio valuation or claimable balance.</p><p class="live-address">${esc(p.mintA)}<br>${esc(p.mintB)}</p></section>`).join('');
 $('#mainnet-position-count').textContent=last.owner?`${last.positions.length} in selected pools`:'Enter a public wallet address to inspect';
 $('#mainnet-positions').innerHTML=last.owner?(last.positions.length?last.positions.map(position).join(''):'<div class="empty">No owned positions found in the selected pools within the supported inventory limits.</div>'):'<div class="empty">Wallet inventory has not been requested.</div>';
 $('#mainnet-coverage').textContent=last.coverage+' Owed fees and rewards are checkpointed amounts; reward funding and activity eligibility are unknown. Wallet ownership does not authorize ALM management.';
 $('#mainnet-identity').innerHTML=`<div><dt>Cluster</dt><dd>Solana mainnet · finalized</dd></div><div><dt>Program</dt><dd class="live-address">${explorer(last.programId)}</dd></div><div><dt>SolvesConfig</dt><dd class="live-address">${explorer(last.solvesConfig)}</dd></div><div><dt>ProgramData SHA-256</dt><dd class="live-address">${esc(last.programDataSha256)}</dd></div><div><dt>Wallet</dt><dd class="live-address">${last.owner?explorer(last.owner):'Not requested'}</dd></div>`;
}
function position(p){
 const pool=last.pools.find(x=>x.address===p.pool);
 return `<article class="live-position-detail"><h3>${esc(symbol(pool.mintA))} / ${esc(symbol(pool.mintB))} <span class="status-pill ${p.inRange?'':'out'}">${BigInt(p.liquidity)===0n?'Retained':p.inRange?'In range':'Out of range'}</span></h3><p class="live-address">${explorer(p.address,p.address)}${p.bundleIndex===undefined?'':` · bundle index ${p.bundleIndex}`}</p><dl><div><dt>Tick range</dt><dd>${p.lower} → ${p.upper}</dd></div><div><dt>Position principal · ${esc(symbol(pool.mintA))}</dt><dd>${units(p.amountA,pool.decimalsA)}</dd></div><div><dt>Position principal · ${esc(symbol(pool.mintB))}</dt><dd>${units(p.amountB,pool.decimalsB)}</dd></div><div><dt>Checkpointed fees · A / B</dt><dd>${units(p.feeA,pool.decimalsA)} / ${units(p.feeB,pool.decimalsB)}</dd></div><div><dt>Raw liquidity</dt><dd>${esc(p.liquidity)}</dd></div></dl><p>${p.frozen||p.delegated?'<span class="live-warning">Frozen or delegated NFT · manual review required.</span>':'Observed NFT ownership only · no ALM management authorization.'}</p><p class="trial-note">Reward checkpoints (raw base units; not confirmed claimable): ${p.rewardCheckpoints.filter(r=>BigInt(r.owed)>0n).map(r=>`${esc(short(r.mint))}: ${esc(r.owed)}`).join(' · ')||'0'}</p></article>`;
}
$('#mainnet-refresh').addEventListener('click',refresh);
$('#mainnet-wallet').addEventListener('click',async()=>{
 if(busy)return;$('#mainnet-error').textContent='';
 const provider=window.solana?.isPhantom?window.solana:window.solflare?.isSolflare?window.solflare:null;
 if(!provider){$('#mainnet-error').textContent='Paste your public wallet address above. No compatible wallet extension is available in this browser.';return;}
 try{const connected=await provider.connect();const key=connected?.publicKey||provider.publicKey;if(!key)throw new Error('Wallet did not return a public address.');$('#mainnet-owner').value=key.toBase58();await refresh();}catch(error){$('#mainnet-error').textContent=error.message||'Wallet connection cancelled.';}
});
$('#mainnet-export').addEventListener('click',()=>{if(!last)return;const url=URL.createObjectURL(new Blob([JSON.stringify(last,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='solve3-mainnet-observation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});

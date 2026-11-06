// Owner-only tool. Preview writes a reviewable manifest; apply requires that exact
// manifest and an explicitly supplied target RPC whose genesis hash matches it.
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const [mode, manifestPath] = process.argv.slice(2);
if (!['preview','apply'].includes(mode) || !manifestPath)
	throw new Error('Usage: genesis-reset.mjs preview|apply manifest.json');
const need = (name) => { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; };
const client = new pg.Client({connectionString:need('QUEST_RESET_OWNER_DB_URL'),connectionTimeoutMillis:5000});
await client.connect();
try {
	if (mode === 'preview') {
		const result = await client.query('SELECT quest_genesis.preview_reset($1,$2,$3) AS document',[
			need('QUEST_RESET_CUTOFF'),need('QUEST_GENESIS_ENVIRONMENT_ID'),need('QUEST_GENESIS_HASH')]);
		await writeFile(manifestPath, JSON.stringify(result.rows[0].document,null,2)+'\n',{flag:'wx'});
		console.log(JSON.stringify({mode,documentSha256:result.rows[0].document.documentSha256,manifestPath}));
	} else {
		const document = JSON.parse(await readFile(manifestPath,'utf8'));
		if (document.body?.targetNetwork !== 'MAINNET' || document.body.targetEnvironment !== need('QUEST_GENESIS_ENVIRONMENT_ID') ||
			document.body.targetGenesis !== need('QUEST_GENESIS_HASH')) throw new Error('Target pins differ from reviewed manifest');
		const rpc = new URL(need('QUEST_GENESIS_RPC_URL'));
		if (rpc.protocol !== 'https:' && !(rpc.protocol === 'http:' && ['localhost','127.0.0.1'].includes(rpc.hostname)))
			throw new Error('Target RPC requires HTTPS');
		const response = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
			body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getGenesisHash'}),signal:AbortSignal.timeout(10000)});
		if (!response.ok) throw new Error('Target RPC unavailable');
		const value = await response.json();
		if (value.error || value.result !== document.body.targetGenesis) throw new Error('Target RPC genesis mismatch');
		const result = await client.query('SELECT quest_genesis.apply_reset($1) AS result',[document]);
		console.log(JSON.stringify(result.rows[0].result));
	}
} finally {await client.end();}

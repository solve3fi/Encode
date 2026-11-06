"use client";

import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import home from "@/components/ProtocolHome/ProtocolHome.module.css";
import { AGENT_API } from "@/configs/agent";
import api from "./AgentApi.module.css";
import extra from "./AgentIntro.module.css";

const BASE = AGENT_API.baseUrl;

const ROUTES = [
	["GET", "/v1/gauges", "read", "This week's timing and every pool you can vote for, with each pool's share of votes."],
	["GET", "/v1/locks/{owner}", "read", "veSOLV3 locks owned by a wallet."],
	["GET", "/v1/claimable/{owner}", "read", "Every unclaimed voting reward for a wallet, net of any auto-vote fee."],
	["GET", "/v1/vote-plan/{owner}/{lockId}", "read", "A suggested vote split for a lock. An estimate, not advice."],
	["GET", "/v1/autovote", "read", "Whether auto-vote is offered, who votes, and the fee."],
	["GET", "/v1/autovote/status/{owner}", "read", "Per-lock auto-vote status for a wallet."],
	["POST", "/v1/tx/claim-all", "tx", "Unsigned, simulated transactions that claim every reward."],
	["POST", "/v1/tx/vote", "tx", "An unsigned vote. Optimised unless you pass a split."],
	["POST", "/v1/tx/lock", "tx", "An unsigned transaction creating a permanent lock."],
	["POST", "/v1/tx/increase-lock", "tx", "An unsigned transaction adding SOLV3 to a lock."],
	["POST", "/v1/tx/autovote/enable", "tx", "An unsigned transaction turning auto-vote on for a lock."],
	["POST", "/v1/tx/autovote/disable", "tx", "An unsigned transaction turning auto-vote off for a lock."],
] as const;

const price = (t: string) => (t === "read" ? AGENT_API.priceRead : AGENT_API.priceTx);

const Code = ({ children }: { children: string }) => <pre className={extra.code}>{children}</pre>;

const Shell = ({ children }: { children: React.ReactNode }) => (
	<div className={home.page}>
		<div className={home.aurora} aria-hidden="true">
			<i />
			<i />
			<b />
		</div>
		<Header variant="marketing" />
		<main className={home.main}>{children}</main>
		<Footer variant="marketing" extras />
	</div>
);

export const AgentApiOverview = () => (
	<Shell>
		<section className={`${home.heroCopy} ${api.heroOne}`}>
			<p className={home.eyebrow}>
				<span className={home.ping} />
				Solve3 Agent API · Devnet beta
			</p>
			<h1>
				Pay per request.
				<br />
				<span className={home.grad}>Nothing to buy first.</span>
			</h1>
			<p className={home.lede}>
				Software can ask the Solve3 Agent questions and get ready-to-sign transactions back. Each request is billed in {AGENT_API.asset} automatically, a few cents at a time, with no account, no API key and no prepaid balance.
			</p>
			<div className={home.actions}>
				<Link href="/beta/agent/api/setup" className={home.primary}>Set it up</Link>
				<a href={`${BASE}/openapi.json`} className={home.ghost}>OpenAPI spec</a>
			</div>
			<p className={home.small}>
				Using Claude or Codex? <Link href="/beta/agent/api/setup#assistants">Connect it as a tool →</Link>
			</p>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Do I have to pre-purchase?</span>
			<h2>
				No. <span className={home.grad}>It takes {AGENT_API.asset} automatically.</span>
			</h2>
			<div className={api.answer}>
				<div>
					<span className={api.big}>No prepaying</span>
					<h3>No account, no balance</h3>
					<p>You never top up anything with Solve3. You just keep a little {AGENT_API.asset} in the wallet your software uses.</p>
				</div>
				<div>
					<span className={api.big}>Per request</span>
					<h3>Billed one call at a time</h3>
					<p>{AGENT_API.priceRead} for a read, {AGENT_API.priceTx} to build a transaction. The amount is shown to your software before it pays.</p>
				</div>
				<div>
					<span className={api.big}>Only on success</span>
					<h3>Failed calls are free</h3>
					<p>You are charged only after a successful answer. Bad input, not found, or a failed simulation costs nothing.</p>
				</div>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>How a call is paid</span>
			<h2>
				Four steps, <span className={home.grad}>all automatic.</span>
			</h2>
			<ol className={api.flow}>
				<li><strong>Ask</strong><span>Your software sends a normal request, for example GET /v1/claimable/&lt;wallet&gt;.</span></li>
				<li><strong>Get the price</strong><span>The server replies 402 Payment Required: the price, the token, and who gets paid.</span></li>
				<li><strong>Pay</strong><span>An x402 client signs a {AGENT_API.asset} transfer for exactly that amount and retries the same request. It takes a moment.</span></li>
				<li><strong>Get the answer</strong><span>The payment settles on-chain and you receive the JSON or the unsigned transaction.</span></li>
			</ol>
			<ul className={api.notes}>
				<li><b>What you need in the wallet:</b> {AGENT_API.asset}. The network fee is covered by the payment service, so you don't need SOL just to pay.</li>
				<li><b>What you pay in:</b> {AGENT_API.asset} on {AGENT_API.network}. Test tokens, no monetary value, while Solve3 is on Devnet.</li>
				<li><b>High volume?</b> Each call is its own small payment. A prepaid or batched option can be added later if people need it.</li>
				<li><b>Safe by default:</b> the API never signs for anyone. It returns unsigned transactions that the wallet owner approves.</li>
			</ul>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Pricing</span>
			<h2>Two prices.</h2>
			<div className={home.three}>
				<div className={home.tile}>
					<h3>Read</h3>
					<div className={extra.price}><b>{AGENT_API.priceRead}</b><span>per call</span></div>
					<p>Locks, claimable rewards, this week's pools, a suggested split, auto-vote status.</p>
				</div>
				<div className={home.tile}>
					<h3>Build a transaction</h3>
					<div className={extra.price}><b>{AGENT_API.priceTx}</b><span>per call</span></div>
					<p>Claim all, vote, lock, add to a lock, auto-vote on or off. Always unsigned and pre-simulated.</p>
				</div>
				<div className={home.tile}>
					<h3>Discovery</h3>
					<div className={extra.price}><b>Free</b><span>no payment</span></div>
					<p><a href={`${BASE}/openapi.json`}>/openapi.json</a>, <a href={`${BASE}/llms.txt`}>/llms.txt</a> and /health.</p>
				</div>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Reference</span>
			<h2>Every route.</h2>
			<p className={home.sectionLede}>
				Base address: <span className={api.kv}>{BASE}</span>. Full request and response shapes are in the <a href={`${BASE}/openapi.json`}>OpenAPI spec</a>.
			</p>
			<div className={api.tableWrap}>
				<table className={api.table}>
					<thead>
						<tr><th>Method</th><th>Path</th><th>Price</th><th>What it does</th></tr>
					</thead>
					<tbody>
						{ROUTES.map(([method, path, tier, text]) => (
							<tr key={method + path}>
								<td><span className={`${api.verb} ${method === "GET" ? api.get : api.post}`}>{method}</span></td>
								<td><code>{path}</code></td>
								<td className={api.tier}>{price(tier)}</td>
								<td>{text}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Good to know</span>
			<h2>The fine print.</h2>
			<ul className={api.notes}>
				<li><b>Devnet beta.</b> Everything runs on Solana Devnet with test tokens. The agent will not run on mainnet until the protocol is live there.</li>
				<li><b>Estimates, not advice.</b> Suggested splits use the data available. On Devnet, tokens have no price, so suggestions are basic.</li>
				<li><b>Payments go to the Solve3 treasury:</b> <span className={api.kv}>{AGENT_API.treasury}</span>. A well-behaved client refuses to pay anyone else.</li>
				<li><b>Token:</b> <span className={api.kv}>{AGENT_API.usdcMint}</span> ({AGENT_API.asset}).</li>
			</ul>
		</section>

		<section className={home.final}>
			<h2>
				Ready to <span className={home.grad}>connect it?</span>
			</h2>
			<p>The setup guide covers a plain script, Claude, and Codex.</p>
			<div className={home.actions}>
				<Link href="/beta/agent/api/setup" className={home.primary}>Open the setup guide</Link>
				<Link href="/beta/agent/intro" className={home.ghost}>What is the agent?</Link>
			</div>
		</section>
	</Shell>
);

const CLAUDE_CODE = `claude mcp add solve3-agent \\
  -e SOLVE3_PAYER_KEYPAIR_PATH=/path/to/payer.json \\
  -- node --import tsx /path/to/X402-agent/src/mcp.ts`;

const CLAUDE_DESKTOP = `{
  "mcpServers": {
    "solve3-agent": {
      "command": "node",
      "args": ["--import", "tsx", "/path/to/X402-agent/src/mcp.ts"],
      "env": { "SOLVE3_PAYER_KEYPAIR_PATH": "/path/to/payer.json" }
    }
  }
}`;

const CODEX = `[mcp_servers.solve3-agent]
command = "node"
args = ["--import", "tsx", "/path/to/X402-agent/src/mcp.ts"]
env = { SOLVE3_PAYER_KEYPAIR_PATH = "/path/to/payer.json" }`;

const CURL = `curl -i ${BASE}/v1/gauges
# HTTP/1.1 402 Payment Required   <- the price and who to pay, in the payment-required header`;

const JS = `import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { readFileSync } from "node:fs";

const signer = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync("payer.json", "utf8"))),
);
const client = new x402Client().register("solana:*", new ExactSvmScheme(signer));
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay("${BASE}/v1/claimable/<wallet>");
console.log(await res.json());`;

const SIGN = `import { Connection, Transaction } from "@solana/web3.js";
// bundle = the JSON returned by a /v1/tx/... call; wallet = the owner's Keypair
for (const t of bundle.transactions) {
  const tx = Transaction.from(Buffer.from(t.transaction, "base64"));
  tx.sign(wallet);                       // the owner signs; the API never does
  await connection.sendRawTransaction(tx.serialize());
}
// Transactions expire after about a minute (see lastValidBlockHeight), so sign soon after building.`;

export const AgentApiSetup = () => (
	<Shell>
		<section className={`${home.heroCopy} ${api.heroOne}`}>
			<p className={home.eyebrow}>
				<span className={home.ping} />
				Setup guide · Devnet beta
			</p>
			<h1>
				From zero to your first call
				<br />
				<span className={home.grad}>in about ten minutes.</span>
			</h1>
			<p className={home.lede}>
				You need a small wallet that holds a little {AGENT_API.asset}, and one of three ways to call the API: a Claude or Codex tool, or a short script. The wallet only pays the few cents per call and can't touch your locks.
			</p>
			<div className={home.actions}>
				<a href="#assistants" className={home.primary}>Connect Claude or Codex</a>
				<Link href="/beta/agent/api" className={home.ghost}>How billing works</Link>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Step 1</span>
			<h2>Make a small payer wallet.</h2>
			<ul className={api.notes}>
				<li><b>Use a new, separate wallet</b> with a few dollars at most. It is only for paying API fees. Never use the wallet that owns your locks.</li>
				<li><b>Create the file.</b> Any Solana keypair JSON works, for example <span className={api.kv}>solana-keygen new --outfile payer.json</span>.</li>
				<li><b>Add devUSDC.</b> Get free test devUSDC from the <a href="/devnet">Solve3 devnet faucet</a> by connecting the wallet (100 per day), or send some to the wallet's address. It must be the {AGENT_API.asset} token ({AGENT_API.usdcMint.slice(0, 6)}…).</li>
				<li><b>No SOL needed to pay.</b> The payment service covers the network fee. {AGENT_API.asset} is enough.</li>
			</ul>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Step 2</span>
			<h2>Get the connector.</h2>
			<p className={home.sectionLede}>
				The connector is a small program (an MCP server) that lets an AI assistant call the API for you. During the beta it ships from the Solve3 agent repository; a published package is planned.
			</p>
			<Code>{`git clone https://github.com/solve3fi/X402-agent.git
cd X402-agent
npm install`}</Code>
			<p className={home.small}>You need Node.js 22 or newer. Access to the repository is required during the beta.</p>
		</section>

		<section className={home.section} id="assistants">
			<span className={home.eyebrow}>Step 3 · Claude and Codex</span>
			<h2>
				Connect it as <span className={home.grad}>a tool.</span>
			</h2>
			<p className={home.sectionLede}>
				Replace <span className={api.kv}>/path/to</span> with your real paths. After connecting, restart the app.
			</p>
			<div className={api.stack}>
				<div className={home.tile}>
					<h3>Claude Code</h3>
					<p>One command:</p>
					<Code>{CLAUDE_CODE}</Code>
				</div>
				<div className={home.tile}>
					<h3>Claude Desktop</h3>
					<p>Add to <span className={api.kv}>claude_desktop_config.json</span> (Settings, Developer, Edit config):</p>
					<Code>{CLAUDE_DESKTOP}</Code>
				</div>
				<div className={home.tile}>
					<h3>Codex</h3>
					<p>Add to <span className={api.kv}>~/.codex/config.toml</span>:</p>
					<Code>{CODEX}</Code>
				</div>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Step 4</span>
			<h2>Try it.</h2>
			<p className={home.sectionLede}>Ask your assistant in plain English. It picks the right tool and pays automatically.</p>
			<ul className={api.notes}>
				<li>"What can wallet <span className={api.kv}>&lt;address&gt;</span> claim on Solve3?"</li>
				<li>"Show this week's Solve3 pools and suggest how to vote lock 6."</li>
				<li>"Build the transaction to claim everything for <span className={api.kv}>&lt;address&gt;</span>. Don't send it."</li>
				<li>"How much have I spent on Solve3 calls today?"</li>
			</ul>
			<p className={home.small}>
				Tools available: gauges, locks, claimable, vote plan, auto-vote status, and builders for claim-all, vote, lock, add to lock and auto-vote on or off, plus a free spend check.
			</p>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Staying safe</span>
			<h2>
				Built-in <span className={home.grad}>spending limits.</span>
			</h2>
			<ul className={api.notes}>
				<li><b>Per-call limit:</b> refuses anything above $0.05 (change with <span className={api.kv}>SOLVE3_MAX_PRICE_PER_CALL_USD</span>).</li>
				<li><b>Daily limit:</b> $1.00 a day, remembered across restarts (change with <span className={api.kv}>SOLVE3_DAILY_CAP_USD</span>).</li>
				<li><b>Only pays Solve3:</b> it refuses to pay any address other than the Solve3 treasury, or any token it doesn't recognise.</li>
				<li><b>Never signs for you:</b> transaction tools return unsigned transactions. You review and sign them yourself, for example on the <Link href="/beta/agent">agent page</Link>.</li>
			</ul>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Without an assistant</span>
			<h2>Call it from a script.</h2>
			<div className={api.stack}>
				<div className={home.tile}>
					<h3>See the price</h3>
					<p>An unpaid request shows the 402 challenge:</p>
					<Code>{CURL}</Code>
				</div>
				<div className={home.tile}>
					<h3>Pay and read</h3>
					<p>An x402 client pays and retries for you:</p>
					<Code>{JS}</Code>
				</div>
				<div className={home.tile}>
					<h3>Sign what it builds</h3>
					<p>Transaction routes return unsigned transactions:</p>
					<Code>{SIGN}</Code>
				</div>
			</div>
		</section>

		<section className={home.section}>
			<span className={home.eyebrow}>Troubleshooting</span>
			<h2>If something goes wrong.</h2>
			<ul className={api.notes}>
				<li><b>"Payment required".</b> The connector has no payer wallet. Check <span className={api.kv}>SOLVE3_PAYER_KEYPAIR_PATH</span> and restart the assistant.</li>
				<li><b>"refused: … limit".</b> A spending limit stopped a payment, which is the safety working. Raise the limit only if you meant to.</li>
				<li><b>Payment fails.</b> The wallet needs {AGENT_API.asset} ({AGENT_API.usdcMint.slice(0, 6)}…) and it must already have a token account for it. Receiving USDC from the faucet creates one.</li>
				<li><b>"Could not reach the API".</b> You weren't charged. Try again in a minute, and check <a href={`${BASE}/health`}>{BASE}/health</a>.</li>
				<li><b>The transaction expired.</b> Build it again and sign within a minute.</li>
			</ul>
		</section>

		<section className={home.final}>
			<h2>
				You're set. <span className={home.grad}>Ask away.</span>
			</h2>
			<p>Devnet beta. Test tokens have no monetary value, and suggestions are estimates, not advice.</p>
			<div className={home.actions}>
				<Link href="/beta/agent/api" className={home.primary}>Pricing and reference</Link>
				<Link href="/beta/agent" className={home.ghost}>Open the agent</Link>
			</div>
		</section>
	</Shell>
);

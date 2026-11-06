#!/usr/bin/env bash
# Stores a Helius DEVNET RPC URL for the rehearsal. Run it yourself in WSL; the URL is read
# silently and never printed:
#   bash scripts/devnet/set-rpc.sh
# Accepts a Helius URL with an ?api-key= (mainnet or devnet host) or just the API key.
# Writes ~/.solve3-devnet-keys/rpc.txt (scripts) and NEXT_PUBLIC_DEVNET_RPC_URL in the UI's .env.local.
set -euo pipefail
UI_ENV="${UI_ENV:-/mnt/d/Projects/s3ui/.env.local}"
RPC_TXT="$HOME/.solve3-devnet-keys/rpc.txt"
read -rsp "Paste your Helius URL or API key (input hidden): " INPUT
echo
export INPUT UI_ENV RPC_TXT
node -e '
const fs = require("fs");
let key = process.env.INPUT.trim().replace(/^["\x27]|["\x27]$/g, "");
if (key.startsWith("http")) { const u = new URL(key); if (!u.hostname.includes("helius")) { console.error("not a Helius URL"); process.exit(1); } key = u.searchParams.get("api-key") || ""; }
if (!key) { console.error("no api key found"); process.exit(1); }
const devnet = `https://devnet.helius-rpc.com/?api-key=${key}`;
fs.writeFileSync(process.env.RPC_TXT, devnet + "\n", { mode: 0o600 });
let ui = fs.existsSync(process.env.UI_ENV) ? fs.readFileSync(process.env.UI_ENV, "utf8") : "";
ui = ui.split(/\r?\n/).filter((l) => l && !l.startsWith("NEXT_PUBLIC_DEVNET_RPC_URL=")).join("\n");
fs.writeFileSync(process.env.UI_ENV, ui + `\nNEXT_PUBLIC_DEVNET_RPC_URL=${devnet}\n`);
fetch(devnet, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }) })
  .then((r) => r.json())
  .then((b) => console.log(b.result === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" ? "OK: Devnet RPC works and is saved for the scripts and the UI" : "WARNING: reply did not look like Devnet: " + JSON.stringify(b).slice(0, 80)))
  .catch((e) => console.log("WARNING: request failed: " + e.message));
'
echo "Restart the UI dev server so it picks up NEXT_PUBLIC_DEVNET_RPC_URL."

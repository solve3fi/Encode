import fs from "node:fs";

// The vesolve-build:local Docker image has no Anchor CLI, only cargo, so
// `anchor build`'s automatic IDL generation isn't available. This wraps the
// same mechanism the CLI uses internally: anchor-lang's idl-build feature
// adds a hidden #[test] per instruction/account/event/error/the program
// itself, each of which prints its own IDL fragment wrapped in
// "--- IDL begin <kind> ---" / "--- IDL end <kind> ---" markers when run
// with --nocapture. This script parses those markers back out of the
// captured test output and reassembles them into one IDL file, the same
// merge `anchor build` would have done.
//
// Usage:
//   1. Capture the fragments (MUST use --test-threads=1 -- cargo runs tests
//      in parallel by default, which interleaves concurrent tests' stdout
//      line-by-line and corrupts the begin/end pairing):
//        cargo test --manifest-path programs/vesolve/Cargo.toml \
//          --features idl-build -- __anchor_private_print_idl \
//          --nocapture --test-threads=1 > /tmp/idl_raw_output.txt
//   2. node scripts/merge-idl.mjs /tmp/idl_raw_output.txt path/to/vesolve.json

const RAW_PATH = process.argv[2] ?? "/tmp/idl_raw_output.txt";
const OUT_PATH = process.argv[3] ?? "idl-generated.json";
const PROGRAM_ADDRESS = process.env.PROGRAM_ADDRESS ?? "HMqzJpD85Z74R1vhor9LWm6KFhK6tYVChzjzyBRyjUmN";

const text = fs.readFileSync(RAW_PATH, "utf8");

function extractBlocks(kind) {
  const beginMarker = `--- IDL begin ${kind} ---`;
  const endMarker = `--- IDL end ${kind} ---`;
  const blocks = [];
  let searchFrom = 0;
  for (;;) {
    const start = text.indexOf(beginMarker, searchFrom);
    if (start === -1) break;
    const jsonStart = start + beginMarker.length;
    const end = text.indexOf(endMarker, jsonStart);
    if (end === -1) throw new Error(`Unterminated ${kind} block at offset ${start}`);
    const jsonText = text.slice(jsonStart, end).trim();
    blocks.push(JSON.parse(jsonText));
    searchFrom = end + endMarker.length;
  }
  return blocks;
}

const programBlocks = extractBlocks("program");
if (programBlocks.length !== 1) {
  throw new Error(`Expected exactly one program block, found ${programBlocks.length}. Did you forget --test-threads=1?`);
}
const idl = programBlocks[0];

const eventBlocks = extractBlocks("event");
idl.events = [];
const typesByName = new Map((idl.types ?? []).map((t) => [t.name, t]));
for (const block of eventBlocks) {
  idl.events.push(block.event);
  for (const type of block.types ?? []) {
    typesByName.set(type.name, type);
  }
}
idl.types = Array.from(typesByName.values());

const errorBlocks = extractBlocks("errors");
if (errorBlocks.length !== 1) {
  throw new Error(`Expected exactly one errors block, found ${errorBlocks.length}. Did you forget --test-threads=1?`);
}
idl.errors = errorBlocks[0].errors ?? errorBlocks[0];

idl.address = PROGRAM_ADDRESS;

// The idl-build test harness prints each account/type/event's fully
// qualified Rust path (e.g. "vesolve::states::protocol::Protocol") as its
// "name", not the bare struct name ("Protocol") anchor's own CLI produces.
// Discriminators are unaffected (the #[account]/#[event] macros hash the
// plain ident, not the path), but every name string -- and every "defined"
// reference to one, e.g. a field typed as another struct -- must be
// shortened to match, since the JS client derives its camelCase
// program.account.<name>/program.types accessors from these exact strings.
const shortName = (name) => name.includes("::") ? name.slice(name.lastIndexOf("::") + 2) : name;

function shortenDefinedRefs(node) {
  if (Array.isArray(node)) {
    for (const item of node) shortenDefinedRefs(item);
  } else if (node && typeof node === "object") {
    if (node.defined && typeof node.defined.name === "string") {
      node.defined.name = shortName(node.defined.name);
    }
    for (const value of Object.values(node)) shortenDefinedRefs(value);
  }
}

for (const account of idl.accounts ?? []) account.name = shortName(account.name);
for (const type of idl.types ?? []) type.name = shortName(type.name);
for (const event of idl.events ?? []) event.name = shortName(event.name);
shortenDefinedRefs(idl.instructions);
shortenDefinedRefs(idl.types);
shortenDefinedRefs(idl.events);

// idl-build prints no fixed address for well-known program/sysvar accounts, which
// the anchor CLI does. Fill them in so address-resolving clients (the SVM tests)
// work. Token-interface accounts in *_v2 instructions are caller-supplied and stay open.
const KNOWN_ADDRESSES = {
  system_program: "11111111111111111111111111111111",
  rent: "SysvarRent111111111111111111111111111111111",
  token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associated_token_program: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
};
for (const ix of idl.instructions) {
  for (const account of ix.accounts ?? []) {
    const known = KNOWN_ADDRESSES[account.name];
    if (!known || account.address) continue;
    if (account.name === "token_program" && ix.name.endsWith("_v2")) continue;
    account.address = known;
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify(idl, null, 2));
console.log(`Wrote ${OUT_PATH}`);
console.log(`instructions: ${idl.instructions.length}`);
console.log(`accounts: ${(idl.accounts ?? []).length}`);
console.log(`types: ${idl.types.length}`);
console.log(`events: ${idl.events.length}`);
console.log(`errors: ${idl.errors.length}`);

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import ts from "typescript";

const require = createRequire(import.meta.url);
const address = (n) => new PublicKey(new Uint8Array(32).fill(n));
let wallet = address(1), network = "devnet", epoch = 3;
let lastVoteEpoch = 3;
const program = {};
const protocol = () => ({ currentEpoch: new BN(epoch), tokenMint: address(2) });
const rawLock = () => ({
	owner: wallet, veTokenId: new BN(1), veMint: address(3), amount: new BN(100),
	votingPower: new BN(100), unlockTime: new BN(0), lastVoteEpoch: new BN(lastVoteEpoch),
});
let userVote = null;
let invalidated = [];
const mocks = {
	"@solana/wallet-adapter-react": { useWallet: () => ({ publicKey: wallet }) },
	"@/providers/ClusterProvider": { useCluster: () => ({ network }) },
	"@/stores/vote/hooks/useVoteConfig": { useVoteConfig: () => ({ data: { epoch: new BN(epoch) } }) },
	"./hooks/useVoteConfig": { useVoteConfig: () => ({ data: { epoch: new BN(epoch) } }) },
	"@tanstack/react-query": {
		useQuery: (options) => options,
		useMutation: (options) => options,
		useQueryClient: () => ({ invalidateQueries: async ({ queryKey }) => invalidated.push(queryKey) }),
	},
	"@/hooks/useVesolveProgram": {
		useVesolveProgram: () => program,
		getProtocolPDA: () => [address(4)], getLockPDA: () => [address(5)],
		getUserVotePDA: () => [address(6)],
		vesolveAccount: {
			lock: () => ({ all: async () => [{ publicKey: address(5), account: rawLock() }], fetchNullable: async () => rawLock() }),
			protocol: () => ({ fetchNullable: async () => protocol() }),
			userVote: () => ({ fetchNullable: async () => userVote }),
		},
	},
	"@lingui/react": { useLingui: () => ({ i18n: { _: (text) => text } }) },
	"@/components/Notifications": { notification: { success() {}, error() {} } },
};

function load(relative, overrides = {}) {
	const source = fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
	const js = ts.transpileModule(source, { compilerOptions: {
		module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
	} }).outputText;
	const module = { exports: {} };
	const dependencies = { ...mocks, ...overrides };
	new Function("require", "module", "exports", js)(
		(id) => id in dependencies ? dependencies[id] : require(id), module, module.exports,
	);
	return module.exports;
}

const { useLocks } = load("src/stores/lock/hooks/useLocks.ts");
const { useLockData } = load("src/stores/lock/hooks/useLockData.ts");
const { useUserVote } = load("src/stores/vote/hooks/useUserVote.ts");
const { useCreateVote } = load("src/stores/vote/hooks/useCreateVote.ts");
const oldLocksQuery = useLocks();
assert.equal((await oldLocksQuery.queryFn())[0].used, true);
assert.equal(oldLocksQuery.refetchInterval, 15_000);
const oldLockQuery = useLockData(1);
assert.equal(oldLockQuery.refetchInterval, 15_000);
assert.deepEqual(oldLockQuery.queryKey.slice(0, 2), ["vesolve-lock", 1]);
epoch = 4;
assert.notDeepEqual(useLocks().queryKey, oldLocksQuery.queryKey, "An epoch change must bypass the old voted-status cache");
assert.notDeepEqual(useLockData(1).queryKey, oldLockQuery.queryKey);
assert.equal((await useLocks().queryFn())[0].used, false, "Last week's vote is not a current-epoch vote");
assert.equal((await useLockData(1).queryFn()).lastVoteEpoch.toNumber(), 3, "Historical lock data is never erased");
lastVoteEpoch = 4;
assert.equal((await useLocks().queryFn())[0].used, true, "A legitimate current-week manual/auto-vote remains voted");
const devnetLockKey = useLockData(1).queryKey;
network = "mainnet-beta";
assert.notDeepEqual(useLockData(1).queryKey, devnetLockKey, "Networks cannot share lock state");
network = "devnet";
const userQuery = useUserVote(network, epoch);
assert.deepEqual(userQuery.queryKey, ["vesolve-user-vote", network, epoch, wallet.toString()]);
assert.equal(userQuery.refetchInterval, 15_000);
assert.equal(await userQuery.queryFn(), null);
await useCreateVote().onSuccess();
for (const prefix of ["vesolve-epoch", "vesolve-votes", "vesolve-locks", "vesolve-lock", "vesolve-user-vote"])
	assert.ok(invalidated.some(([key]) => key === prefix), `A successful vote must refresh ${prefix}`);

// A small hook harness tests the actual components without adding a test
// renderer dependency. React's key determines which scoped hook state survives.
function hooks() {
	let cursor = 0;
	const slots = [], effects = [];
	return {
		render: (fn) => { cursor = 0; return fn(); },
		flush: () => { for (const effect of effects.splice(0)) effect(); },
		react: {
			...require("react"),
			useRef: (initial) => slots[cursor++] ??= { current: initial },
			useMemo: (fn) => fn(),
			useState: (initial) => {
				const slot = cursor++;
				if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
				return [slots[slot], (value) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
			},
			useEffect: (fn, deps) => {
				const slot = cursor++, previous = slots[slot];
				if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) effects.push(fn);
				slots[slot] = deps;
			},
		},
	};
}
const providerHooks = hooks();
const voteStoreModule = load("src/stores/vote/index.ts");
const { VoteProvider } = load("src/stores/vote/VoteProvider.tsx", {
	react: providerHooks.react, ".": voteStoreModule,
});
const renderProvider = () => providerHooks.render(() => VoteProvider({ children: "vote-screen" }));
let scope = renderProvider();
const firstKey = scope.key;
const firstStore = providerHooks.render(() => scope.type(scope.props)).props.value;
firstStore.getState().actions.setLockId(9);
scope = renderProvider();
assert.equal(scope.key, firstKey, "Repeated current-epoch polls do not reset edits");
assert.equal(providerHooks.render(() => scope.type(scope.props)).props.value, firstStore);
epoch++;
assert.notEqual(renderProvider().key, firstKey, "A confirmed epoch rollover remounts draft and transaction state");
const nextEpochKey = renderProvider().key;
wallet = address(8);
assert.notEqual(renderProvider().key, nextEpochKey);
const nextWalletKey = renderProvider().key;
network = "mainnet-beta";
assert.notEqual(renderProvider().key, nextWalletKey);
network = "devnet";
wallet = address(1);

const gauge = address(10), poolAddress = address(11);
const pool = { getData: () => ({ tokenMintA: address(12), tokenMintB: address(13), feeRate: 3000 }), getAddress: () => poolAddress };
let draft = [], chainVote;
function hydrationHarness() {
	const runtime = hooks();
	const { VoteLists } = load("src/components/Vote/VoteLists.tsx", {
		react: runtime.react,
		"@mantine/core": { Avatar: { Group: "AvatarGroup" }, Box: "Box", Group: "Group", Stack: "Stack", Text: "Text" },
		"@tabler/icons-react": {}, "mantine-datatable": { DataTable: "DataTable" },
		"@/components/Pool/AcceleratorBadge": {}, "@/components/ProtocolStatus/DataState": {},
		"@/components/Reward/RewardEmissionApr": {},
		"@/hooks/useAcceleratedPools": { useAcceleratedPools: () => new Map() },
		"@/hooks/useToken": { useAllTokens: () => ({}) },
		"@/lib/format": {}, "@/lib/voteDisplay": { gaugeVotingPower: () => new BN(0) },
		"@/stores/pool/hooks/usePools": { usePools: () => ({ data: [pool] }) },
		"@/stores/vote/hooks/useUserVote": { useUserVote: () => ({ data: chainVote }) },
		"@/stores/vote/hooks/useVote": { useVote: () => ({ data: { votes: new BN(0) } }) },
		"@/stores/vote/hooks/useVotes": { useVotes: () => ({ data: [{ pool: poolAddress, gauge }] }) },
		"@/stores/vote/VoteProvider": {
			useVote: (selector) => selector({ voteState: draft, searchQuery: "" }),
			useVoteActions: () => ({ setVoteState: (item) => { draft = [...draft, item]; } }),
		},
		"../Token/TokenBalance": {}, "./VoteLists.module.css": {},
		"./VoteListsMobile": {}, "./VotePercentHandle": {}, "./VoteReward": {},
	});
	return () => { runtime.render(VoteLists); runtime.flush(); };
}
let renderHydration = hydrationHarness();
chainVote = undefined;
renderHydration();
assert.deepEqual(draft, [], "Loading is not a confirmed empty vote");
chainVote = { votes: [{ gauge, weight: new BN(100) }] };
renderHydration();
assert.equal(draft[0].votePercent, 100, "The current epoch's on-chain allocation is restored");
assert.equal(draft[0].getAddress().toString(), poolAddress.toString(), "Hydration preserves SDK methods");
draft = [{ ...draft[0], votePercent: 25 }];
renderHydration();
assert.equal(draft[0].votePercent, 25, "A poll must not overwrite edited allocations");
draft = [];
renderHydration();
assert.deepEqual(draft, [], "Reset is not immediately undone by rehydration");
renderHydration = hydrationHarness(); // React remount after scope changes.
chainVote = null;
renderHydration();
chainVote = { votes: [{ gauge, weight: new BN(100) }] };
renderHydration();
assert.deepEqual(draft, [], "A later background vote does not silently replace an already initialized draft");
renderHydration = hydrationHarness();
renderHydration();
assert.equal(draft[0].votePercent, 100, "Reopening restores that legitimate current-epoch vote");
console.log("PASS: epoch-scoped lock status, network/wallet separation, live vote refresh, scoped draft/mutation reset, and safe current-vote hydration");

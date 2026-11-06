import { afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let connected = false;
let lockState: any = { data: undefined, isError: false };
let rewardState: any = { data: undefined, isError: false };
let epochState: any = { data: { epoch: 4 }, isError: false };

mock.module("@solana/wallet-adapter-react", () => ({ useWallet: () => ({ publicKey: connected ? {} : null }) }));
mock.module("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
mock.module("../src/components/Wallet", () => ({ WalletConnect: () => <button>Connect wallet</button> }));
mock.module("../src/providers/ClusterProvider", () => ({ useCluster: () => ({ network: "devnet" }) }));
mock.module("../src/stores/lock/hooks/useLocks", () => ({ useLocks: () => lockState }));
mock.module("../src/hooks/useVoteRewards", () => ({ useVoteRewards: () => rewardState }));
mock.module("../src/stores/vote/hooks/useVoteConfig", () => ({ useVoteConfig: () => epochState }));
const { WeeklyChecklist } = await import("../src/components/ProtocolHome/WeeklyChecklist");
const zero = { isZero: () => true };
const positive = { isZero: () => false };
afterEach(() => { connected = false; lockState = { data: undefined, isError: false }; rewardState = { data: undefined, isError: false }; epochState = { data: { epoch: 4 }, isError: false }; });

test("disconnected wallet requests connection without claiming progress", () => {
	const html = renderToStaticMarkup(<WeeklyChecklist />);
	expect(html).toContain("Connect wallet");
	expect(html).not.toContain("✓");
});
test("partial voting and available rewards are reported independently", () => {
	connected = true;
	lockState.data = [{ used: true }, { used: false }];
	rewardState.data = [{ rewardAmount: zero, poolRewardAmountA: positive, poolRewardAmountB: zero, bribes: [] }];
	const html = renderToStaticMarkup(<WeeklyChecklist />);
	expect(html).toContain("1 of 2 locks voted in epoch 4");
	expect(html).toContain("1 gauge/epoch reward entries available");
	expect(html).toContain("02");
});
test("read failures remain unknown rather than complete", () => {
	connected = true;
	lockState = { data: [{ used: true }], isError: true };
	rewardState = { data: [], isError: true };
	const html = renderToStaticMarkup(<WeeklyChecklist />);
	expect(html).toContain("Unable to verify votes");
	expect(html).toContain("Unable to read voter rewards");
	expect(html).not.toContain("✓");
});
test("epoch rollover removes the completed voting state", () => {
	connected = true;
	epochState.data = { epoch: 5 };
	lockState.data = [{ used: false }];
	rewardState.data = [];
	const html = renderToStaticMarkup(<WeeklyChecklist />);
	expect(html).toContain("0 of 1 locks voted in epoch 5");
	expect(html).toContain("No claimable voter rewards found");
});

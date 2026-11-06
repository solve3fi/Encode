/** Promotional suggestions, never evidence of a completed quest or wallet activity. */
export const SOCIAL_POST_DRAFTS = Object.freeze([
	"Your SOL has survived enough group chats. Give it a better destination: explore swaps and concentrated liquidity with @solve3fi. Take a look: https://solve3.fi",
	"Another day, another 47-tab DeFi research session. Here's one worth keeping: @solve3fi. Explore Solana swaps and liquidity pools: https://solve3.fi",
	"Less 'wen utility', more actual buttons. Swap on Solana and explore concentrated liquidity with @solve3fi. Your next tab: https://solve3.fi",
	"Doomscrolling is technically a strategy. Exploring a Solana DEX is a better use of the next five minutes. Meet @solve3fi: https://solve3.fi",
	"Your watchlist has commitment issues. Your liquidity range doesn't have to. Explore concentrated liquidity on Solana with @solve3fi: https://solve3.fi",
	"The group chat found another ticker. I found a place to explore swaps and liquidity. Meet @solve3fi, a DEX on Solana: https://solve3.fi",
	"New tab, fewer excuses. @solve3fi brings swaps and concentrated liquidity to Solana. Explore the pools and see what fits: https://solve3.fi",
	"Some people collect browser tabs. Some explore liquidity ranges. Be interesting: take a look at @solve3fi and its Solana pools. https://solve3.fi",
	"DeFi doesn't need another mysterious screenshot. Here's an actual app to explore: @solve3fi. Solana swaps, liquidity pools, your call. https://solve3.fi",
	"Your portfolio doesn't need another motivational quote. Your research might need @solve3fi. Explore swaps and concentrated liquidity on Solana: https://solve3.fi",
	"Hot take: clicking through a real DEX beats arguing about one. Explore Solana swaps and liquidity on @solve3fi. Bring curiosity: https://solve3.fi",
	"If your DeFi routine is refresh, refresh, panic, try a little research. Explore @solve3fi's Solana swaps and liquidity pools: https://solve3.fi",
	"Concentrated liquidity. Unconcentrated attention span. Somehow, we're making this work. Explore the pools on @solve3fi: https://solve3.fi",
	"The algorithm wants another hour of your life. @solve3fi only needs a tab to show you Solana swaps and liquidity pools. Start here: https://solve3.fi",
	"A liquidity range is a choice. Buying whatever the group chat shouts is also a choice. Explore the first one with @solve3fi: https://solve3.fi",
	"Solana moves fast. Your 'I'll check it later' list does not. Put @solve3fi on today's list: explore swaps and concentrated liquidity. https://solve3.fi",
	"Nobody asked for my next DeFi tab. Naturally, here it is: @solve3fi. Explore a Solana DEX built around swaps and liquidity: https://solve3.fi",
	"Less chart astrology, more product research. Meet @solve3fi and explore Solana swaps and concentrated liquidity pools for yourself: https://solve3.fi",
	"Your next rabbit hole has a pool list. Explore @solve3fi, swap on Solana, and take a closer look at concentrated liquidity: https://solve3.fi",
	"The timeline has opinions. @solve3fi has an app you can actually explore. Check out its Solana swaps and liquidity pools: https://solve3.fi",
	"Touch grass. Hydrate. Research a Solana DEX before the next group-chat thesis. @solve3fi is worth a look for swaps and liquidity: https://solve3.fi",
	"A DEX link with an invitation to look for yourself. Radical concept, I know. Explore swaps and concentrated liquidity on @solve3fi: https://solve3.fi",
	"You can keep scrolling, or investigate what concentrated liquidity looks like on @solve3fi. Solana swaps and pools are a click away: https://solve3.fi",
	"Another crypto thread could have been a link to a working app. Here's the link: @solve3fi. Explore Solana swaps and liquidity pools. https://solve3.fi",
	"Save the dramatic announcement voice. Open @solve3fi, explore Solana swaps and concentrated liquidity, and decide for yourself. Start here: https://solve3.fi",
] as const);

export function nextDraftIndex(index: number): number {
	return (index + 1) % SOCIAL_POST_DRAFTS.length;
}

export function socialPostUrl(text: string): string {
	return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

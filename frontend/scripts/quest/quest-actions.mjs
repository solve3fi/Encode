const actions={
 qualifyingSwaps:['/swap','Go to Swap'],activeTradingDays:['/swap','Go to Swap'],
 swapVolumeUsd:['/swap','Go to Swap'],distinctPoolsTraded:['/swap','Explore pools'],
 featuredPoolsJoined:['/liquidity','Add liquidity'],lpInRangeHours:['/liquidity','Manage liquidity'],
 qualifiedTraderReferrals:['/pass','Get your link'],qualifiedLpReferrals:['/pass','Get your link'],
};
export function weeklyQuestAction(metric) {
 const action=actions[metric];return action?{href:action[0],cta:action[1]}:{href:undefined,cta:'View your Pass'};
}

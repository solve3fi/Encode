/** Read existing governance progress; never creates a separate weekly XP award. */
export function votingQuestProgress({ ready, voting }) {
	if (!ready) return { state: 'locked', label: 'Sign in to see progress', xp: null };
	if (!voting || !Number.isSafeInteger(voting.currentEpoch) || voting.currentEpoch < 0 ||
		!Number.isSafeInteger(voting.xpPerEpoch) || voting.xpPerEpoch <= 0 || typeof voting.votedThisEpoch !== 'boolean') {
		return { state: 'unavailable', label: 'Progress unavailable', xp: null };
	}
	return { state: voting.votedThisEpoch ? 'done' : 'todo', label: voting.votedThisEpoch ? 'Voted this epoch' : 'Not voted this epoch', xp: voting.xpPerEpoch };
}

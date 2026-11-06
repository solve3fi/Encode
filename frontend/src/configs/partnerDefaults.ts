/** Signed message that proves a wallet owns the partner defaults it is saving. */
export const partnerDefaultsMessage = (
	wallet: string,
	vote: boolean,
	autolock: boolean,
): string =>
	`solve3 partner defaults: ${wallet} vote=${vote ? 1 : 0} autolock=${autolock ? 1 : 0}`;

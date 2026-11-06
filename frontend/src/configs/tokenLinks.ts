export const TOKEN_LINKS_STORE = "token-links";

export type TokenLinkOverride = {
	website?: string;
	twitter?: string;
	updatedBy: string;
	updatedAt: number;
};

export type TokenLinksById = Record<string, TokenLinkOverride>;

export const TOKEN_LINKS_ADMIN_ACTION = "update token links";

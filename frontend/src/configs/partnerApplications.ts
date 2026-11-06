/** Store name and signed-read action for the pilot requests submitted on /partners. */
export const PARTNER_APPLICATIONS_STORE = "partner-applications";
export const PARTNER_APPLICATIONS_READ_ACTION = "read partner applications";

export type PartnerApplication = {
	project: string;
	pair: string;
	mint: string;
	contact: string;
	accelerator?: boolean;
	submittedAt: number;
};

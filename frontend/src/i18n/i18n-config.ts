export const i18n = {
	defaultLocale: "en",
	locales: ["en"],
	localeCookie: "locale",
	prefixDefault: false,
};

export type SupportedLocale = (typeof i18n.locales)[number];
export type Languages = { name: string; code: SupportedLocale; icon: string }[];

export const languages: Languages = [
	{ name: "English", code: "en", icon: "🇬🇧" },
];

import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-json";
import { i18n } from "./src/i18n/i18n-config";

export default defineConfig({
	sourceLocale: i18n.defaultLocale,
	locales: [...i18n.locales, "pseudo"],
	pseudoLocale: "pseudo",
	format: formatter({ style: "minimal" }),
	orderBy: "messageId",
	rootDir: ".",
	fallbackLocales: {
		default: i18n.defaultLocale,
	},
	catalogs: [
		{
			path: "<rootDir>/src/locales/{locale}",
			include: ["<rootDir>/src"],
			exclude: ["**/node_modules/**"],
		},
	],
});

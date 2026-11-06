import { bool } from "@solana/buffer-layout-utils";
import { PublicKey } from "@solana/web3.js";

export const formatLog = (obj: object) => {
	const objs = Object.entries(obj);
	return objs.reduce(
		(acc, [key, value]) => {
			switch (typeof value) {
				case "boolean":
					acc[key] = bool(`${value}`);
					break;

				case "object":
					if (value instanceof PublicKey) {
						acc[key] = value.toBase58();
					} else {
						acc[key] = value ? value.toString() : "";
					}

					break;
				default:
					acc[key] = value.toString();
					break;
			}
			return acc;
		},
		{} as Record<string, unknown>,
	);
};

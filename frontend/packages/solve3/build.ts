import { build } from "bun";

const main = async () => {
	await build({
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "browser",
		format: "esm",
		sourcemap: "external",
		minify: true,
		external: ["@coral-xyz/anchor", "@solana/web3.js", "@solana/spl-token"],
	});

	const proc = Bun.spawn(
		["tsc", "--emitDeclarationOnly", "--declaration", "--outDir", "dist"],
		{
			cwd: process.cwd(),
			stdio: ["inherit", "inherit", "inherit"],
		},
	);

	await proc.exited;
};

main();

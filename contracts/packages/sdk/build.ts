import { build } from "bun";

const main = async () => {
	// Build CommonJS version
	await build({
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		format: "cjs",
		splitting: false,
		sourcemap: "external",
		minify: true,
		naming: "index.js",
	});

	// Build ESM version
	await build({
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "browser",
		format: "esm",
		splitting: false,
		sourcemap: "external",
		minify: true,
		naming: "index.esm.js",
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

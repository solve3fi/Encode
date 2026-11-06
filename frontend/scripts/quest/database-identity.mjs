import { readFileSync } from "node:fs";

/**
 * The single environment-identity statement a Quest worker must run on the
 * *same connection and login role* it will use. Loaded once at module load.
 */
export const QUEST_IDENTITY_SQL = readFileSync(
	new URL("../../db/quest/verify_environment_identity.sql", import.meta.url),
	"utf8",
);

function isNonEmptyString(value) {
	return typeof value === "string" && value.length > 0;
}

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read and normalize the Quest database identity row over an existing
 * connection.
 *
 * This function never connects, owns, or releases the connection: the caller
 * is responsible for the connection lifecycle. It only issues one query and
 * validates/normalizes the result into the exact `database` shape expected by
 * `assertQuestDevnetStartup` in `./devnet-startup-contract.mjs`.
 *
 * @param {{ query: (sql: string) => Promise<unknown> }} connection
 */
export async function readQuestDatabaseIdentity(connection) {
	const result = await connection.query(QUEST_IDENTITY_SQL);
	const rows = result?.rows;
	if (!Array.isArray(rows) || rows.length !== 1) {
		throw new Error("Quest database identity requires exactly one row");
	}
	const row = rows[0];
	if (!isPlainObject(row)) {
		throw new Error("Quest database identity row is malformed");
	}
	const {
		databaseName,
		sessionUser,
		currentUser,
		superuser,
		canCreateQuestObjects,
		canCreatePublicObjects,
		canCreateDatabaseObjects,
		canMutateIdentity,
		identity,
	} = row;
	for (const field of ["databaseName", "sessionUser", "currentUser"]) {
		if (!isNonEmptyString(row[field])) {
			throw new Error("Quest database identity requires non-empty strings");
		}
	}
	for (const field of [
		"superuser",
		"canCreateQuestObjects",
		"canCreatePublicObjects",
		"canCreateDatabaseObjects",
		"canMutateIdentity",
	]) {
		if (typeof row[field] !== "boolean") {
			throw new Error(
				"Quest database identity requires boolean privilege flags",
			);
		}
	}
	if (identity !== null && !isPlainObject(identity)) {
		throw new Error("Quest database identity row is malformed");
	}
	return {
		databaseName,
		sessionUser,
		currentUser,
		superuser,
		canCreateQuestObjects,
		canCreatePublicObjects,
		canCreateDatabaseObjects,
		canMutateIdentity,
		identity,
	};
}

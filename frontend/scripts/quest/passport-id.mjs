// Passport IDs are canonical lowercase UUIDs in the Quest Devnet database.
const PASSPORT_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertPassportId(value) {
	if (typeof value !== "string" || !PASSPORT_ID.test(value)) {
		throw new TypeError("passportId must be a canonical lowercase UUID");
	}
	return value;
}

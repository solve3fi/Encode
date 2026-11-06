// The browser's bundled `Buffer` (a polyfill, not Node's native class) does
// not implement writeBigUInt64LE/readBigUInt64LE/writeBigInt64LE/readBigInt64LE
// in this build — confirmed via runtime check (typeof Buffer.prototype.write-
// BigUInt64LE === "undefined" in the client bundle). Several dependencies
// (our own PDA derivation, and @solve3fi/sdk's bundled pool-fetching code)
// call these methods internally, which previously failed as either a thrown
// "is not a function" (our own create_lock flow) or a silently-swallowed
// rejection that left queries (e.g. the Vote page's pool list) hanging
// forever. Patching the shared Buffer.prototype once, here, fixes every
// caller — including third-party bundled code we can't edit directly.
type BufferWithBigInt = {
	writeBigUInt64LE?: (value: bigint, offset?: number) => number;
	readBigUInt64LE?: (offset?: number) => bigint;
	writeBigInt64LE?: (value: bigint, offset?: number) => number;
	readBigInt64LE?: (offset?: number) => bigint;
};

if (typeof Buffer !== "undefined") {
	const proto = Buffer.prototype as unknown as BufferWithBigInt & {
		[index: number]: number;
	};

	if (typeof proto.writeBigUInt64LE !== "function") {
		proto.writeBigUInt64LE = function (
			this: { [index: number]: number },
			value: bigint,
			offset = 0,
		): number {
			let v = BigInt(value);
			const eight = BigInt(8);
			for (let i = 0; i < 8; i++) {
				this[offset + i] = Number(v & BigInt(0xff));
				v >>= eight;
			}
			return offset + 8;
		};
	}

	if (typeof proto.readBigUInt64LE !== "function") {
		proto.readBigUInt64LE = function (
			this: { [index: number]: number },
			offset = 0,
		): bigint {
			let v = BigInt(0);
			const eight = BigInt(8);
			for (let i = 7; i >= 0; i--) {
				v = (v << eight) | BigInt(this[offset + i]);
			}
			return v;
		};
	}

	if (typeof proto.writeBigInt64LE !== "function") {
		proto.writeBigInt64LE = function (
			this: { [index: number]: number },
			value: bigint,
			offset = 0,
		): number {
			return (proto.writeBigUInt64LE as (value: bigint, offset?: number) => number).call(
				this,
				BigInt.asUintN(64, value),
				offset,
			);
		};
	}

	if (typeof proto.readBigInt64LE !== "function") {
		proto.readBigInt64LE = function (
			this: { [index: number]: number },
			offset = 0,
		): bigint {
			return BigInt.asIntN(
				64,
				(proto.readBigUInt64LE as (offset?: number) => bigint).call(this, offset),
			);
		};
	}
}

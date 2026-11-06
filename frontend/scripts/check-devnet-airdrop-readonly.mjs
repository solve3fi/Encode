import { readFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import { BorshAccountsCoder, BorshInstructionCoder } from "@coral-xyz/anchor";
const idl = JSON.parse(readFileSync(new URL('../src/configs/vesolve.json', import.meta.url), 'utf8'));
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const signature = '2agc5oYEFJXSA4foq9kheJKfui1QkFsYJhQf2ms2oAR3eM7TBAy16HaVrndb8Vi13GJCR99mRzBtXwDBnNn6jbVa';
const transaction = await connection.getTransaction(signature, { commitment:'confirmed', maxSupportedTransactionVersion:0 });
if (!transaction || transaction.meta?.err) throw new Error('Devnet claim transaction not confirmed successfully');
const coder = new BorshInstructionCoder(idl);
const message = transaction.transaction.message;
const keys = message.staticAccountKeys;
for (const ix of message.compiledInstructions) {
    if (keys[ix.programIdIndex].toString() !== idl.address) continue;
    const decoded = coder.decode(Buffer.from(ix.data));
    const definition = idl.instructions.find((item) => item.name === decoded?.name);
    const lockIndex = definition?.accounts.findIndex((item) => item.name === 'lock');
    if (lockIndex === undefined || lockIndex < 0) continue;
    const lockAddress = keys[ix.accountKeyIndexes[lockIndex]];
    const account = await connection.getAccountInfo(lockAddress);
    const lock = new BorshAccountsCoder(idl).decode('Lock', account.data);
    const unlockTime = lock.unlockTime ?? lock.unlock_time;
    console.log(JSON.stringify({ signature, instruction:decoded.name, lockAddress:lockAddress.toString(), owner:lock.owner.toString(), amount:lock.amount.toString(), unlockTime:unlockTime.toString() }));
}

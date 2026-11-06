import {PublicKey,MessageV1,VersionedMessage} from "@solana/web3.js";

// web3.js 1.99 can read v1 but deliberately cannot serialize it. Copy its
// decoded fields without rebuilding it as a legacy transaction or dropping
// transactionConfig. This is a read-only evidence copy, never a signing path.
export function copyRpcMessage(message){
 if(message.version!==1)return VersionedMessage.deserialize(Uint8Array.from(message.serialize()));
 const fail=()=>{throw new Error("RPC message: malformed version 1 evidence");};
 const keys=message.staticAccountKeys,header=message.header,instructions=message.compiledInstructions,config=message.transactionConfig;
 if(!(message instanceof MessageV1)||!Array.isArray(keys)||keys.length<1||keys.length>64||!Array.isArray(instructions)||instructions.length>64||message.addressTableLookups.length!==0||!header||!config)fail();
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 if(!integer(header.numRequiredSignatures,keys.length)||header.numRequiredSignatures<1||!integer(header.numReadonlySignedAccounts,header.numRequiredSignatures)||!integer(header.numReadonlyUnsignedAccounts,keys.length-header.numRequiredSignatures))fail();
 const names=["computeUnitLimit","heapSize","loadedAccountsDataSizeLimit","priorityFee"];
 if(Object.keys(config).length!==names.length||names.some(name=>!Object.hasOwn(config,name)||config[name]!==null&&!integer(config[name],name==="priorityFee"?Number.MAX_SAFE_INTEGER:0xffffffff)))fail();
 const clonedKeys=keys.map(key=>new PublicKey(key.toBytes()));
 if(new Set(clonedKeys.map(key=>key.toBase58())).size!==keys.length)fail();
 new PublicKey(message.recentBlockhash);
 let bytes=1+3+4+32+1+1+keys.length*32+header.numRequiredSignatures*64;
 for(const name of names)if(config[name]!==null)bytes+=name==="priorityFee"?8:4;
 const clonedInstructions=instructions.map(ix=>{
  if(!integer(ix.programIdIndex,keys.length-1)||!Array.isArray(ix.accountKeyIndexes)||ix.accountKeyIndexes.length>255||ix.accountKeyIndexes.some(index=>!integer(index,keys.length-1))||!(ix.data instanceof Uint8Array))fail();
  bytes+=4+ix.accountKeyIndexes.length+ix.data.length;
  return {programIdIndex:ix.programIdIndex,accountKeyIndexes:[...ix.accountKeyIndexes],data:Uint8Array.from(ix.data)};
 });
 if(bytes>4096)fail();
 return new MessageV1({header:{...header},staticAccountKeys:clonedKeys,recentBlockhash:message.recentBlockhash,compiledInstructions:clonedInstructions,transactionConfig:{...config}});
}

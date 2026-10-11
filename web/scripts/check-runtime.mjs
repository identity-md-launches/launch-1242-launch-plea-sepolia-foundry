import fs from 'node:fs';
import {createPublicClient,http,keccak256} from 'viem';
const manifest=JSON.parse(fs.readFileSync('web/src/deployment.json','utf8'));
const c=createPublicClient({transport:http(manifest.network.rpcUrls[0])});
const results=[];
for(const item of [...manifest.contracts,{name:'PleaHook',address:'0x3d4CcAc329010b8beA3b14498d9a45EAB00c68Cc'}]){
 const built=JSON.parse(fs.readFileSync(`out/${item.name}.sol/${item.name}.json`));
 const references=Object.values(built.deployedBytecode.immutableReferences).flat();
 const normalize=code=>{const bytes=Buffer.from(code.slice(2),'hex');for(const {start,length} of references)bytes.fill(0,start,start+length);return `0x${bytes.toString('hex')}`;};
 const expected=keccak256(normalize(built.deployedBytecode.object));const actual=keccak256(normalize(await c.getBytecode({address:item.address})));
 results.push({name:item.name,address:item.address,expected,actual,matched:expected===actual,references});
}
console.log(results.map(({name,matched})=>({name,matched})));
fs.writeFileSync('artifacts/runtime-verification.json',JSON.stringify(results,null,2)+'\n');
if(results.some(r=>!r.matched))process.exitCode=1;
else fs.writeFileSync('web/src/runtime.json',JSON.stringify(results.map(({name,expected,references})=>({name,expected,references}))));

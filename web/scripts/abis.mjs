import fs from 'node:fs';
import {keccak256,toHex} from 'viem';
const manifest=JSON.parse(fs.readFileSync(new URL('../src/deployment.json',import.meta.url)));
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const results=[];
for(const name of [...manifest.contracts.map(c=>c.name),'PleaHook','IIntake']){
 const file=new URL(`../../out/${name==='IIntake'?'IPleaParts':name}.sol/${name}.json`,import.meta.url);
 const abi=JSON.parse(fs.readFileSync(file)).abi;
 const actual=keccak256(toHex(JSON.stringify(canonical(abi)))).slice(2);
 const expected=manifest.contracts.find(c=>c.name===name)?.abiHash;
 if(expected && actual!==expected)throw Error(`${name} ABI hash mismatch: ${actual} != ${expected}`);
 fs.writeFileSync(new URL(`../src/abi/${name}.json`,import.meta.url),JSON.stringify(abi));
 results.push({name,canonicalKeccak:actual,matched:expected?true:'source-derived; no pinned hash'});
}
fs.writeFileSync(new URL('../../artifacts/abi-verification.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(results);

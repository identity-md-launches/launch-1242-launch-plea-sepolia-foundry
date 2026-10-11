import {loadSnapshot} from '../src/data';
import {writeFileSync} from 'node:fs';
const data=await loadSnapshot();
writeFileSync(new URL('../../artifacts/live-read.json',import.meta.url),JSON.stringify(data,(_,v)=>typeof v==='bigint'?v.toString():v,2));
console.log(JSON.stringify({block:String(data.block),time:String(data.timestamp),alive:data.alive,season:String(data.season),pleas:data.pleas.length,events:data.events.length,nfts:data.nfts.length,constants:data.constants},(_,v)=>typeof v==='bigint'?String(v):v,2));

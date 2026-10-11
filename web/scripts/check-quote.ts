import {loadSnapshot} from '../src/data';
import {quoteSwap} from '../src/swaps';
import {read} from '../src/contracts';
import {parseEther} from 'viem';
const d=await loadSnapshot();const wallet=d.pleas[0].seller;
console.log('Buyer',wallet,'tIMD balance',String(await read('TestIMD','balanceOf',[wallet])));
console.log('Quote',await quoteSwap(d,wallet,parseEther('0.1'),true));

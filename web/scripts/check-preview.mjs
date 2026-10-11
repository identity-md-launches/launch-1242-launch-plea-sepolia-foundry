// Rebuild the eth_call-only helper artifact. This script never deploys a contract.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
execFileSync('forge',['build','web/simulation/BalancePreview.sol','--skip','test','--skip','script'],{stdio:'inherit'});
const built=JSON.parse(fs.readFileSync('out/BalancePreview.sol/BalancePreview.json'));
fs.writeFileSync('web/src/abi/BalancePreview.json',JSON.stringify({abi:built.abi,bytecode:built.deployedBytecode.object}));

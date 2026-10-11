import { parseAbiItem } from "viem";
import { client, addresses, launchBlock } from "./contracts";
import type { Plea } from "./domain";
// Verified Sepolia Intake ABI, Sourcify match 55829826. The Intake HTTP lookup lacks
// CORS; the same canonical oracle URI is emitted in its Completed event.
const completed = parseAbiItem(
  "event Completed(bytes32 indexed requestId,uint8 status,bytes32 resultHash,string uri,bool delivered)",
);
const ids = new Map<string, string>();
export async function oracleIdOf(plea: Plea): Promise<string | undefined> {
  const cached = ids.get(plea.intakeId);
  if (cached) return cached;
  if (plea.oracleId) {
    const hex = plea.oracleId.slice(2, 34);
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    ids.set(plea.intakeId, id);
    return id;
  }
  const receipt = await client.getTransactionReceipt({ hash: plea.tx });
  const head = await client.getBlockNumber();
  const search = async (
    from: bigint,
    to: bigint,
  ): Promise<string | undefined> => {
    try {
      const logs = await client.getLogs({
        address: addresses.Intake,
        event: completed,
        args: { requestId: plea.intakeId },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        const m = log.args.uri?.match(
          /^https:\/\/api\.imd\.fun\/oracle\/requests\/([a-zA-Z0-9-]+)$/,
        );
        if (m) {
          ids.set(plea.intakeId, m[1]);
          return m[1];
        }
      }
    } catch (e) {
      if (to - from < 32n) throw e;
      const mid = (from + to) / 2n;
      return (await search(from, mid)) ?? (await search(mid + 1n, to));
    }
  };
  for (
    let from = receipt.blockNumber ?? launchBlock;
    from <= head;
    from += 2000n
  ) {
    const found = await search(from, from + 1999n < head ? from + 1999n : head);
    if (found) return found;
  }
}

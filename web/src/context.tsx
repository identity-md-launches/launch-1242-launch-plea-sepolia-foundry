import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type Hex,
  type EIP1193Provider,
} from "viem";
import {
  client,
  addresses,
  abis,
  deployment,
  sepolia,
  read,
} from "./contracts";
import {
  loadSnapshot,
  loadWallet,
  verifyDeployment,
  type Snapshot,
  type WalletData,
} from "./data";
import { eq, gasLimit } from "./domain";
import { explainError } from "./errors";
export type Progress = (stage: string, hash?: Hex) => void;
export type Send = (
  contract: string,
  fn: string,
  args?: readonly unknown[],
  swap?: boolean,
  label?: string,
) => Promise<Hex>;
export type TxSession = {
  send: Send;
  approve: (token: string, spender: string, amount: bigint) => Promise<void>;
};
type Provider = EIP1193Provider & {
  on?: (event: string, fn: (value: any) => void) => void;
  removeListener?: (event: string, fn: (value: any) => void) => void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
type AppContext = {
  data?: Snapshot;
  wallet?: WalletData;
  walletError?: string;
  account?: Address;
  now: bigint;
  error?: string;
  loading: boolean;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  connecting: boolean;
  connectionError?: string;
  busy: boolean;
  run: (
    action: (session: TxSession) => Promise<Hex>,
    progress: Progress,
  ) => Promise<Hex>;
};
const Context = createContext<AppContext>(null!);
export const useApp = () => useContext(Context);
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot>(),
    [wallet, setWallet] = useState<WalletData>(),
    [walletError, setWalletError] = useState<string>();
  const [account, setAccount] = useState<Address>(),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [connecting, setConnecting] = useState(false),
    [connectionError, setConnectionError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(Date.now());
  const active = useRef(false),
    accountRef = useRef(account);
  accountRef.current = account;
  const refresh = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    try {
      const result = await loadSnapshot();
      setData(result);
      setError(undefined);
    } catch (e) {
      setError(explainError(e));
    } finally {
      setLoading(false);
      active.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const tickTimer = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      clearInterval(tickTimer);
    };
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    setWallet(undefined);
    setWalletError(undefined);
    if (data && account)
      void loadWallet(account, data)
        .then((w) => {
          if (!stopped) setWallet(w);
        })
        .catch((e) => {
          if (!stopped) setWalletError(explainError(e));
        });
    return () => {
      stopped = true;
    };
  }, [data, account]);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const accounts = (list: Address[]) => {
      setAccount(list[0]);
      setConnectionError(undefined);
    };
    const chain = () => {
      setWallet(undefined);
      void refresh();
    };
    void provider
      .request({ method: "eth_accounts" })
      .then((list) => accounts(list as Address[]))
      .catch(() => {});
    provider.on?.("accountsChanged", accounts);
    provider.on?.("chainChanged", chain);
    return () => {
      provider.removeListener?.("accountsChanged", accounts);
      provider.removeListener?.("chainChanged", chain);
    };
  }, [refresh]);
  const connect = async () => {
    setConnecting(true);
    setConnectionError(undefined);
    try {
      if (!window.ethereum)
        throw Error(
          "Open this site in an Ethereum wallet browser, or install a browser wallet, then use Connect.",
        );
      const list = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as Address[];
      setAccount(list[0]);
    } catch (e) {
      setConnectionError(explainError(e));
    } finally {
      setConnecting(false);
    }
  };
  const run = async (
    action: (session: TxSession) => Promise<Hex>,
    progress: Progress,
  ) => {
    if (busy)
      throw Error(
        "A transaction is already in progress. Finish it in your wallet first.",
      );
    if (!account || !window.ethereum)
      throw Error("Connect in the top bar to continue.");
    if (!data || error || Date.now() - data.loadedAt > 120000)
      throw Error(
        "Live data is not current. Refresh the page before sending a transaction.",
      );
    setBusy(true);
    const initialAccount = account;
    const provider = window.ethereum;
    try {
      await verifyDeployment();
      progress("Check your wallet");
      const chain = await provider.request({ method: "eth_chainId" });
      if (chain !== "0xaa36a7")
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xaa36a7" }],
          });
        } catch (e: any) {
          if (e.code === 4902) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [deployment.walletAddChain],
            });
            await provider.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0xaa36a7" }],
            });
          } else throw e;
        }
      const wc = createWalletClient({
        account: initialAccount,
        chain: sepolia,
        transport: custom(provider),
      });
      const send: Send = async (
        contract,
        fn,
        args = [],
        swap = false,
        label = fn,
      ) => {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as Address[];
        if (
          !eq(accounts[0], initialAccount) ||
          !eq(accountRef.current, initialAccount)
        )
          throw Error(
            "The active wallet changed. Review this action and retry.",
          );
        progress(`Preparing ${label}`);
        const request = {
          account: initialAccount,
          address: addresses[contract],
          abi: abis[contract],
          functionName: fn,
          args,
        };
        const estimate = await client.estimateContractGas({
          ...request,
          gas: 12_000_000n,
        });
        const gas = gasLimit(estimate, swap, data.constants.creditGas);
        await client.simulateContract({ ...request, gas });
        progress(`Confirm ${label} in your wallet`);
        const hash = await wc.writeContract({ ...request, gas });
        progress(`${label} pending`, hash);
        const receipt = await client.waitForTransactionReceipt({
          hash,
          confirmations: 1,
          timeout: 180000,
        });
        if (receipt.status !== "success")
          throw Error(
            `${label} reverted on chain. Refresh the preview and retry; gas was spent.`,
          );
        return hash;
      };
      const approve = async (
        token: string,
        spender: string,
        amount: bigint,
      ) => {
        const allowance = await read(token, "allowance", [
          initialAccount,
          addresses[spender],
        ]);
        if (allowance < amount)
          await send(
            token,
            "approve",
            [addresses[spender], amount],
            false,
            `Approve ${token === "OracleIMD" ? "oracle IMD" : token === "TestIMD" ? "tIMD" : "PLEA"}`,
          );
      };
      const hash = await action({ send, approve });
      progress("Confirmed", hash);
      void refresh();
      return hash;
    } finally {
      setBusy(false);
    }
  };
  const now = data
    ? data.timestamp +
      BigInt(Math.max(0, Math.floor((tick - data.loadedAt) / 1000)))
    : 0n;
  return (
    <Context.Provider
      value={{
        data,
        wallet,
        walletError,
        account,
        now,
        error,
        loading,
        refresh,
        connect,
        disconnect: () => setAccount(undefined),
        connecting,
        connectionError,
        busy,
        run,
      }}
    >
      {children}
    </Context.Provider>
  );
}

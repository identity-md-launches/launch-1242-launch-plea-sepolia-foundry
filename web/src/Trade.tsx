import { useState, useEffect } from "react";
import { formatUnits } from "viem";
import { useApp } from "./context";
import {
  TxButton,
  WalletHint,
  External,
  Notice,
  FaucetButton,
} from "./components";
import { amountOf, fmt, minimumOut, duration, type Plea } from "./domain";
import { quoteSwap, quoteExecute, swapArgs } from "./swaps";
import { explainError } from "./errors";
const accountUrl = "https://imd-acc-sepolia-test-run.site.identitymd.eth.limo";
export function TradeForm({
  sell = false,
  approvedPlea,
}: {
  sell?: boolean;
  approvedPlea?: Plea;
}) {
  const { data, wallet, account, now } = useApp();
  const [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("1"),
    [quoteRecord, setQuote] = useState<{
      out: bigint;
      spent: bigint;
      at: number;
      key: string;
    }>(),
    [quoting, setQuoting] = useState(false),
    [error, setError] = useState("");
  const input = approvedPlea?.amount ?? amountOf(amount);
  const quoteKey = `${account}:${input}:${sell}:${approvedPlea?.id}`;
  const quote = quoteRecord?.key === quoteKey ? quoteRecord : undefined;
  const balance = sell || approvedPlea ? wallet?.plea : wallet?.imd;
  useEffect(() => {
    setQuote(undefined);
    setError("");
  }, [amount, account, approvedPlea?.id, sell]);
  const invalid =
    input <= 0n
      ? "Enter an amount above zero."
      : balance !== undefined && input > balance
        ? "The amount is above your balance."
        : undefined;
  const preview = async () => {
    if (!data || !account || invalid) return;
    setQuoting(true);
    setError("");
    try {
      const [out, spent] = approvedPlea
        ? [await quoteExecute(account, input), input]
        : await quoteSwap(data, account, input, !sell);
      if (out <= 0n)
        throw Error("The pool would return no tokens. Try another amount.");
      setQuote({ out, spent, at: Date.now(), key: quoteKey });
    } catch (e) {
      setQuote(undefined);
      setError(explainError(e));
    } finally {
      setQuoting(false);
    }
  };
  const quoteFresh = quote && Date.now() - quote.at < 60000;
  let minOut: bigint | undefined;
  let slipError: string | undefined;
  try {
    minOut = minimumOut(quote?.out ?? 0n, slippage);
  } catch (e) {
    slipError = explainError(e);
  }
  const label = approvedPlea ? "Execute sale" : sell ? "Sell PLEA" : "Buy PLEA";
  return (
    <section className="trade-form" aria-label={label}>
      <h2>{approvedPlea ? "Your sale is approved" : label}</h2>
      {approvedPlea ? (
        <p>
          Sell {fmt(input, 0)} PLEA within{" "}
          <strong>
            {duration(
              approvedPlea.verdictAt + data!.constants.EXECUTE_WINDOW - now,
            )}
          </strong>
          .
        </p>
      ) : (
        <>
          <label htmlFor={sell ? "sell-amount" : "buy-amount"}>
            {sell ? "PLEA to sell" : "tIMD to spend"}
          </label>
          <div className="amount-field">
            <input
              id={sell ? "sell-amount" : "buy-amount"}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={sell ? "1000" : "0.1"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby={`${sell ? "sell" : "buy"}-balance`}
            />
            <span>{sell ? "PLEA" : "tIMD"}</span>
          </div>
        </>
      )}
      <p id={`${sell ? "sell" : "buy"}-balance`} className="small muted">
        {account
          ? `Balance: ${fmt(balance)} ${sell || approvedPlea ? "PLEA" : "tIMD"}`
          : "Your balance appears after connecting."}
      </p>
      {amount && invalid && <p className="error-text">{invalid}</p>}
      {approvedPlea && (
        <>
          <label htmlFor="slippage">Slippage tolerance (%)</label>
          <input
            id="slippage"
            inputMode="decimal"
            value={slippage}
            onChange={(e) => setSlippage(e.target.value)}
            aria-describedby="slippage-help"
          />
          <p id="slippage-help" className="small muted">
            0.1–5%. Your sale reverts if the output is below the minimum.
          </p>
          {slipError && <p className="error-text">{slipError}</p>}
        </>
      )}
      <WalletHint verb={sell || approvedPlea ? "sell PLEA" : "buy PLEA"} />
      <button
        className="button"
        disabled={!account || !data || !wallet || !!invalid || quoting}
        onClick={() => void preview()}
        aria-busy={quoting}
      >
        {quoting
          ? "Reading the pool…"
          : sell || approvedPlea
            ? "Preview sale"
            : "Preview buy"}
      </button>
      {error && <Notice error>{error}</Notice>}
      {quote && (
        <dl className="quote" aria-live="polite">
          <div>
            <dt>You pay</dt>
            <dd>
              {fmt(quote.spent, 6)} {sell || approvedPlea ? "PLEA" : "tIMD"}
            </dd>
          </div>
          <div>
            <dt>You receive (preview)</dt>
            <dd>
              {fmt(quote.out, 6)} {sell || approvedPlea ? "tIMD" : "PLEA"}
            </dd>
          </div>
          {approvedPlea && (
            <div>
              <dt>Minimum received</dt>
              <dd>{fmt(minOut, 6)} tIMD</dd>
            </div>
          )}
        </dl>
      )}
      {quote && !quoteFresh && (
        <p className="small">
          This preview expired. Preview again before trading.
        </p>
      )}
      {!approvedPlea && (
        <p className="small muted">
          PoolSwapTest has no minimum-output protection. Your preview is an
          estimate; the final amount can change before confirmation.
        </p>
      )}
      <TxButton
        label={label}
        primary={!sell}
        disabled={!wallet || !quoteFresh || !!invalid || !!slipError}
        action={async ({ send, approve }) => {
          if (!data || !account || !quote || Date.now() - quote.at > 60000)
            throw Error("Preview again before trading.");
          if (approvedPlea) {
            await approve("PLEA", "CabalGate", input);
            return send(
              "CabalGate",
              "executeSell",
              [minimumOut(quote.out, slippage)],
              true,
              "Execute sale",
            );
          }
          await approve(sell ? "PLEA" : "TestIMD", "PoolSwapTest", input);
          return send(
            "PoolSwapTest",
            "swap",
            swapArgs(data, account, input, !sell),
            true,
            label,
          );
        }}
      />
      <p className="small muted">
        An approval may be requested first. Every transaction uses Sepolia ETH
        for gas.
      </p>
    </section>
  );
}
export function Buy() {
  const { data, wallet, account, now } = useApp();
  const c = data?.constants;
  const dead =
    data && data.startedAt > 0n && now >= data.lastVerdictAt + c!.DEADMAN;
  return (
    <>
      <div className="page-heading">
        <h1>Enter the court.</h1>
        <p>Buy PLEA freely. Cashback follows you.</p>
      </div>
      <div className="two-column">
        <TradeForm />
        <aside className="side-notes">
          <h2>Start with test IMD</h2>
          <p>
            Get tIMD for the Sepolia pool. You’ll also need Sepolia ETH for gas.
          </p>
          <WalletHint verb="use the tIMD faucet" />
          <FaucetButton />
          <p className="small">
            Need gas?{" "}
            <External href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia">
              Sepolia ETH faucet
            </External>
          </p>
          <h2>Every trade gives back</h2>
          <p>
            {c
              ? `${Number(c.IMD_FEE_BPS + c.PLEA_BURN_BPS) / 100}%: ${Number(c.CASHBACK_BPS) / 100}% back to you as sIMD, ${Number(c.PRIZE_BPS) / 100}% to ${dead ? "pool liquidity" : "this season’s prizes"}.`
              : "Reading the live fee schedule…"}
          </p>
          <p className="small muted">
            The total also includes the owner’s share, pool liquidity and PLEA
            burned. Fees are charged on the filled trade.
          </p>
          {data && now < data.startedAt + c!.LAUNCH_WINDOW && (
            <Notice>
              Launch fee: {Number(data.launchExtra) / 100}% extra, falling to
              zero in {duration(data.startedAt + c!.LAUNCH_WINDOW - now)}. Buy
              cap: {fmt(c!.LAUNCH_MAX_BUY, 0)} PLEA.
            </Notice>
          )}
          {data && now >= data.startedAt + c!.LAUNCH_WINDOW && (
            <p className="small">
              The {Number(c!.LAUNCH_WINDOW) / 60}-minute launch window has
              ended. The launch fee and {fmt(c!.LAUNCH_MAX_BUY, 0)} PLEA cap no
              longer apply.
            </p>
          )}
          <h2>Your position</h2>
          {account ? (
            <dl className="stats-list">
              <div>
                <dt>PLEA held</dt>
                <dd>{fmt(wallet?.plea, 0)}</dd>
              </div>
              <div>
                <dt>Tracked cost basis</dt>
                <dd>{fmt(wallet?.basis[0], 5)} IMD</dd>
              </div>
              <div>
                <dt>Tracked PLEA</dt>
                <dd>{fmt(wallet?.basis[1], 0)}</dd>
              </div>
              <div>
                <dt>Cashback earned</dt>
                <dd>{fmt(wallet?.stacked, 5)} sIMD</dd>
              </div>
            </dl>
          ) : (
            <p>Connect in the top bar to see your cost basis and cashback.</p>
          )}
          <External href={accountUrl}>View sIMD in imd/acc</External>
        </aside>
      </div>
      {dead && (
        <div className="section-block" id="sell">
          <h2>PLEA trades freely forever.</h2>
          <TradeForm sell />
        </div>
      )}
    </>
  );
}
export { accountUrl };

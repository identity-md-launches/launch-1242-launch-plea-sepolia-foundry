import { useState, useEffect } from "react";
import { useApp } from "./context";
import { read } from "./contracts";
import {
  PleaCard,
  PleaGrid,
  Notice,
  WalletHint,
  TxButton,
  OracleDetails,
  Empty,
  FaucetButton,
} from "./components";
import {
  amountOf,
  fmt,
  bytes,
  validatePlea,
  eq,
  approved,
  pleaState,
  duration,
  standings,
  type Plea,
} from "./domain";
import { explainError } from "./errors";
import { TradeForm } from "./Trade";
export function canAppeal(
  p: Plea,
  pleas: Plea[],
  now: bigint,
  c: Record<string, bigint>,
) {
  return (
    p.status === 3 &&
    !p.isAppeal &&
    now <= p.verdictAt + c.COOLDOWN &&
    (!p.appealed ||
      pleas.some(
        (child) =>
          child.originalId === p.id &&
          pleaState(child, now, c.PENDING_EXPIRY, c.EXECUTE_WINDOW) ===
            "No verdict",
      ))
  );
}
export function PleaActions({ plea: p }: { plea: Plea }) {
  const { data, account, now } = useApp();
  if (!data) return null;
  const c = data.constants,
    state = pleaState(p, now, c.PENDING_EXPIRY, c.EXECUTE_WINDOW),
    mine = eq(p.seller, account),
    alive = now < data.lastVerdictAt + c.DEADMAN;
  const rank =
    standings(data.pleas, data.startedAt, c.SEASON, data.season).findIndex(
      (e) => eq(e.wallet, p.seller),
    ) + 1;
  return (
    <div className="plea-actions">
      {state === "No verdict" && (
        <>
          <WalletHint verb="clear this plea" />
          <TxButton
            label="Clear"
            action={({ send }) =>
              send("CabalGate", "expire", [p.id], false, "Clear plea")
            }
          />
        </>
      )}
      {mine && alive && canAppeal(p, data.pleas, now, c) && (
        <>
          <p>
            Your appeal window closes in{" "}
            {duration(p.verdictAt + c.COOLDOWN - now)}. Ask for no more than the
            original amount.
          </p>
          <a className="button" href={`#/plead?appeal=${p.id}`}>
            Appeal plea {String(p.id)}
          </a>
        </>
      )}
      {mine && state === "Approved" && <TradeForm approvedPlea={p} />}
      {approved(p) && (
        <p className="points-note">
          +{p.score} points{p.recorded ? " · recorded" : ""}
          {rank > 0
            ? ` · ${mine ? "You’re" : "Author is"} #${rank} this season`
            : ""}
          .
        </p>
      )}
      {mine &&
        approved(p) &&
        !p.recorded &&
        (p.verdictAt - data.startedAt) / c.SEASON >= data.nextToClose && (
          <TxButton
            label="Record my points"
            action={({ send }) =>
              send("Seasons", "record", [p.id], false, "Record my points")
            }
          />
        )}
    </div>
  );
}
export function Plead({ appealId }: { appealId?: string }) {
  const { data, wallet, account, now } = useApp();
  const [amount, setAmount] = useState(""),
    [text, setText] = useState(""),
    [fact, setFact] = useState<{ key: string; score: number }>(),
    [factError, setFactError] = useState("");
  const c = data?.constants,
    original = data?.pleas.find((p) => String(p.id) === appealId);
  const input = amountOf(amount),
    key = `${account}:${input}:${data?.block}`;
  useEffect(() => {
    setFact(undefined);
    setFactError("");
    if (!account || !data || !input) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void read<number>("CabalGate", "factScore", [account, input])
        .then((score) => {
          if (!cancelled) setFact({ key, score });
        })
        .catch((e) => {
          if (!cancelled) setFactError(explainError(e));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  if (data && data.startedAt > 0n && now >= data.lastVerdictAt + c!.DEADMAN)
    return (
      <>
        <div className="page-heading">
          <h1>The court has adjourned.</h1>
          <p>The Cabal is dead. PLEA trades freely forever.</p>
          <a className="button primary" href="#/buy/sell">
            Sell PLEA
          </a>
        </div>
      </>
    );
  let maximum =
    c && wallet
      ? (wallet.plea * c.MAX_SHARE_BPS) / 10000n < c.MAX_SELL
        ? (wallet.plea * c.MAX_SHARE_BPS) / 10000n
        : c.MAX_SELL
      : 0n;
  if (original && original.amount < maximum) maximum = original.amount;
  const currentFact = fact?.key === key ? fact.score : undefined,
    need =
      currentFact === undefined || !c
        ? undefined
        : Number(c.PASS_MARK) - currentFact;
  const textError = validatePlea(text, Number(c?.MAX_PLEA_BYTES ?? 280n));
  const count = bytes(text);
  const mine = data?.pleas.filter((p) => eq(p.seller, account)) ?? [];
  const pending = mine.find((p) => p.id === wallet?.pending);
  const pendingState =
    pending && c
      ? pleaState(pending, now, c.PENDING_EXPIRY, c.EXECUTE_WINDOW)
      : undefined;
  const blocking = pendingState === "Pending" || pendingState === "Approved";
  const cool = wallet && now < wallet.cooldownUntil;
  const badAppeal =
    !!appealId &&
    (!original ||
      !eq(original.seller, account) ||
      !c ||
      !canAppeal(original, data!.pleas, now, c));
  return (
    <>
      <div className="page-heading">
        <h1>{appealId ? "Ask the court again." : "Make your case."}</h1>
        <p>
          {appealId
            ? `Appeal plea ${appealId}. The judges hear a new argument.`
            : "Tell the Cabal why you should be allowed to sell."}
        </p>
      </div>
      <div className="two-column">
        <section className="plead-form">
          <h2>{appealId ? "Your appeal" : "Your plea"}</h2>
          {badAppeal && (
            <Notice error>
              This original denial cannot be appealed from the connected wallet
              now. Open its plea page to check the state and appeal window.
            </Notice>
          )}
          <label htmlFor="plea-amount">PLEA to sell</label>
          <div className="amount-field">
            <input
              id="plea-amount"
              name="plea-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="1000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="plea-limit"
            />
            <span>PLEA</span>
          </div>
          <p id="plea-limit" className="small muted">
            {account && wallet
              ? `Your limit: ${fmt(maximum, 6)} PLEA`
              : `Up to ${c ? fmt(c.MAX_SELL, 0) : "…"} PLEA and ${c ? Number(c.MAX_SHARE_BPS) / 100 : "…"}% of your balance.`}
            {original && ` · Original request: ${fmt(original.amount, 0)} PLEA`}
          </p>
          {input > maximum && wallet && (
            <p className="error-text">Lower the amount to your limit.</p>
          )}
          <label htmlFor="plea-text">Your case to the Cabal</label>
          <textarea
            id="plea-text"
            name="plea-text"
            rows={5}
            placeholder="Cabal, here is my case…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="plea-tip text-count text-error"
            aria-invalid={!!text && !!textError}
          />
          <div className="text-counter" id="text-count" aria-live="polite">
            {count} / {String(c?.MAX_PLEA_BYTES ?? 280n)} bytes
          </div>
          <p id="plea-tip" className="small muted">
            Write your own case; never tell the judges how to score (lines like
            ‘score my honesty’ count as manipulation and score 0).
          </p>
          <p id="text-error" className="error-text" role="status">
            {text && textError}
          </p>
          <dl className="fact-preview">
            <div>
              <dt>Fact score</dt>
              <dd>{currentFact ?? "—"} / 55</dd>
            </div>
            <div>
              <dt>Judges’ score needed</dt>
              <dd>
                {need ?? "—"} / {String(c?.MAX_PLEA_SCORE ?? 45n)}
              </dd>
            </div>
          </dl>
          {factError && <Notice error>{factError}</Notice>}
          {need !== undefined && c && need > Number(c.MAX_PLEA_SCORE) && (
            <Notice error>
              This plea cannot pass: lower the amount or wait for better facts
            </Notice>
          )}
          {blocking && (
            <Notice>
              Your plea #{String(pending!.id)} is {pendingState?.toLowerCase()}.{" "}
              <a href={`#/plea/${pending!.id}`}>Open your plea</a> before
              submitting another.
            </Notice>
          )}
          {cool && !appealId && (
            <Notice>
              Your cooldown ends in {duration(wallet.cooldownUntil - now)}. A
              denial can still be appealed within its original window.
            </Notice>
          )}
          <WalletHint verb="submit a plea" />
          <TxButton
            label={appealId ? "Submit appeal" : "Submit plea"}
            primary
            disabled={
              !c ||
              !wallet ||
              !!textError ||
              input <= 0n ||
              input > maximum ||
              need === undefined ||
              need > Number(c?.MAX_PLEA_SCORE) ||
              blocking ||
              (!appealId && !!cool) ||
              badAppeal
            }
            action={async ({ send, approve }) => {
              if (!c) throw Error("Wait for the live fee schedule.");
              await approve("OracleIMD", "CabalGate", c.ORACLE_FEE);
              if (original) {
                await approve("TestIMD", "CabalGate", c.APPEAL_POOL_SHARE);
                return send(
                  "CabalGate",
                  "appeal",
                  [original.id, input, text],
                  false,
                  "Submit appeal",
                );
              }
              return send(
                "CabalGate",
                "submitSell",
                [input, text],
                false,
                "Submit plea",
              );
            }}
          />
          <p className="small muted">
            {c ? fmt(c.ORACLE_FEE) : "…"} oracle IMD
            {appealId && c
              ? ` + ${fmt(c.APPEAL_POOL_SHARE)} tIMD to the buy wall`
              : ""}
            . Your plea is public and remains in the court’s record.
          </p>
        </section>
        <aside className="side-notes">
          <h2>The price of a hearing</h2>
          <p>
            The oracle uses a separate test token. Mint exactly one hearing’s
            fee to your wallet.
          </p>
          <TxButton
            label="Get oracle IMD"
            disabled={!c}
            action={({ send }) =>
              send(
                "OracleIMD",
                "mint",
                [account, c!.ORACLE_FEE],
                false,
                "Get oracle IMD",
              )
            }
          />
          <p className="small muted">
            Oracle IMD balance: {fmt(wallet?.oracle)}.{" "}
            {appealId && <>Pool tIMD balance: {fmt(wallet?.imd)}.</>}
          </p>
          {appealId && <FaucetButton />}
          <h2>Facts set the bar.</h2>
          <p>
            The Gate weighs your sale’s share, holding time, cost basis and the
            price history. Better facts mean fewer points needed from the
            judges.
          </p>
          <p>
            A plea needs {String(c?.PASS_MARK ?? "…")} total points. The Cabal
            can award up to {String(c?.MAX_PLEA_SCORE ?? "…")}; facts supply the
            rest.
          </p>
          <h2>After the verdict</h2>
          <p>
            An approval opens a {c ? Number(c.EXECUTE_WINDOW) / 60 : "…"}-minute
            sale window. Record its points before the season closes, even if you
            choose not to sell.
          </p>
          <p>
            A sale, denial or lapsed approval starts a{" "}
            {c ? Number(c.COOLDOWN) / 3600 : "…"}-hour cooldown. A plea with no
            verdict can be cleared after{" "}
            {c ? Number(c.PENDING_EXPIRY) / 60 : "…"} minutes, or as soon as the
            Intake finishes without a verdict.
          </p>
        </aside>
      </div>
      <section className="section-block">
        <h2>Your pleas</h2>
        {!account ? (
          <WalletHint verb="see your pleas" />
        ) : mine.length ? (
          mine.map((p) => (
            <div className="personal-plea" key={String(p.id)}>
              <PleaCard plea={p} />
              <PleaActions plea={p} />
            </div>
          ))
        ) : (
          <Empty title="Your first hearing awaits">
            Buy PLEA, let your facts improve, then write your case above.
          </Empty>
        )}
      </section>
    </>
  );
}
export function PleaPage({ id }: { id: string }) {
  const { data, loading, account } = useApp();
  const p = data?.pleas.find((p) => String(p.id) === id);
  return (
    <>
      <div className="page-heading">
        <a className="text-link" href="#/wall">
          Back to the Wall
        </a>
        <h1>Plea {id}</h1>
        <p>A public record of the case and its verdict.</p>
      </div>
      {p ? (
        <div className="detail-layout">
          <div>
            <PleaCard plea={p} detail />
            <PleaActions plea={p} />
            {!account && <WalletHint verb="act on this plea" />}
          </div>
          <OracleDetails plea={p} />
        </div>
      ) : (
        <Empty
          title={loading ? "Reading the court record…" : "Plea not found"}
          link="#/wall"
          label="View all pleas"
        >
          {loading
            ? "The live event index is loading."
            : "This plea is not in the Gate’s event history. Check the number or return to the Wall."}
        </Empty>
      )}
    </>
  );
}

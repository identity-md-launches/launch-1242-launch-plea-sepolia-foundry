import { useEffect, useState } from "react";
import { keccak256, toHex, type Address } from "viem";
import { useApp } from "./context";
import { addresses, addressLink, read } from "./contracts";
import {
  External,
  Empty,
  Name,
  NFTGallery,
  Notice,
  PleaGrid,
  TxButton,
  WalletHint,
} from "./components";
import {
  approved,
  compact,
  duration,
  eq,
  fmt,
  pleaState,
  shares,
  standings,
  validateName,
  when,
  type Entry,
} from "./domain";
import { accountUrl } from "./Trade";
import { explainError } from "./errors";
export const priceOf = (price: bigint) => (price * 10n ** 18n) / 2n ** 96n;
export function Overview() {
  const { data, now } = useApp();
  const dead =
    data &&
    data.startedAt > 0n &&
    now >= data.lastVerdictAt + data.constants.DEADMAN;
  return (
    <>
      <section className="intro-grid">
        <div className="intro-title">
          <h1>Make your case.</h1>
          <p className="lead">Buy freely. Persuade the Cabal to sell.</p>
          <div className="actions">
            <a className="button primary" href="#/buy">
              Buy PLEA
            </a>
            <a className="button" href={dead ? "#/buy/sell" : "#/plead"}>
              {dead ? "Sell PLEA" : "Plead to sell"}
            </a>
          </div>
        </div>
        <div className="intro-copy">
          <p>
            PLEA is a token with a court of public opinion. Anyone can buy. To
            sell while the Cabal lives, write a plea and win the judges’
            approval.
          </p>
          <p>
            Approved pleas earn season points and prizes. Your three best scores
            count; the finest cases become Laureates, preserved on chain.
          </p>
          <p>
            If the Cabal stays silent for{" "}
            {data ? Number(data.constants.DEADMAN) / 3600 : "33"} hours, it
            dies. PLEA then trades freely, forever.
          </p>
        </div>
      </section>
      <dl className="live-strip">
        <div>
          <dt>Price · IMD</dt>
          <dd>{data ? fmt(priceOf(data.price), 8) : "—"}</dd>
        </div>
        <div>
          <dt>PLEA burned</dt>
          <dd>{compact(data?.burned)}</dd>
        </div>
        <div>
          <dt>Pleas judged</dt>
          <dd>
            {data ? data.pleas.filter((p) => p.verdictAt > 0n).length : "—"}
          </dd>
        </div>
        <div>
          <dt>Season prize pot · IMD</dt>
          <dd>{fmt(data?.seasonPot, 4)}</dd>
        </div>
      </dl>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>The latest verdicts</h2>
            <p className="muted">Every case is public. Every word matters.</p>
          </div>
          <a className="text-link" href="#/wall">
            Read the Wall
          </a>
        </div>
        {data ? (
          <PleaGrid
            pleas={data.pleas
              .filter((p) => p.verdictAt > 0n)
              .sort((a, b) => (a.verdictAt > b.verdictAt ? -1 : 1))
              .slice(0, 6)}
            empty="The court has yet to speak"
          />
        ) : (
          <div className="loading-lines" role="status">
            Reading the court’s verdicts from Sepolia…
          </div>
        )}
      </section>
    </>
  );
}
const filters = [
  "All",
  "Approved",
  "Denied",
  "Pending",
  "No verdict",
  "Appeals",
  "Laureates",
];
export function Wall() {
  const { data, now } = useApp();
  const [filter, setFilter] = useState("All");
  const pleas =
    data?.pleas.filter((p) => {
      if (filter === "All") return true;
      if (filter === "Approved") return approved(p);
      if (filter === "Denied") return p.status === 3;
      if (filter === "Appeals") return p.isAppeal;
      if (filter === "Laureates")
        return data.nfts.some((n) => n.pleaId === p.id);
      const state = pleaState(
        p,
        now,
        data.constants.PENDING_EXPIRY,
        data.constants.EXECUTE_WINDOW,
      );
      return filter === "No verdict"
        ? state === "No verdict" || p.status === 6
        : state === filter;
    }) ?? [];
  return (
    <>
      <div className="page-heading">
        <h1>The Wall</h1>
        <p>A ledger of persuasion. The newest pleas appear first.</p>
      </div>
      <div className="filters" aria-label="Filter pleas">
        {filters.map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="result-count small muted" role="status">
        {data
          ? `${pleas.length} ${pleas.length === 1 ? "plea" : "pleas"} · ${filter.toLowerCase()}`
          : "Reading the Gate’s events…"}
      </p>
      {pleas.length ? (
        <PleaGrid pleas={pleas} />
      ) : (
        <Empty
          title={
            data
              ? `No ${filter === "All" ? "" : filter.toLowerCase() + " "}pleas yet`
              : "Loading pleas…"
          }
        >
          {" "}
          {data
            ? "The court’s record will appear here."
            : "Fetching the event history from the launch block."}{" "}
          {filter !== "All" && (
            <button className="text-button" onClick={() => setFilter("All")}>
              Show all pleas
            </button>
          )}
        </Empty>
      )}
    </>
  );
}
function Leaderboard({
  entries,
  pot,
  closed = false,
  payouts = [],
}: {
  entries: Entry[];
  pot: bigint;
  closed?: boolean;
  payouts?: { args: Record<string, any> }[];
}) {
  const { data, account } = useApp();
  return (
    <div className="leaderboard">
      <table>
        <caption className="sr-only">
          {closed
            ? "Closed season winners and actual payouts"
            : "Top ten wallets and projected season prizes"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Rank / wallet</th>
            <th scope="col">Points</th>
            <th scope="col">Share</th>
            <th scope="col">IMD {closed ? "paid" : "prize"}</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => {
            const entry = entries[i],
              occupied = entry && !/^0x0+$/.test(entry.wallet),
              qualified =
                occupied && entry.points >= Number(data!.constants.MIN_POINTS),
              payout = closed
                ? (payouts.find((p) => eq(p.args.wallet, entry?.wallet))?.args
                    .amount ?? 0n)
                : qualified
                  ? (pot * BigInt(shares[i])) / 100n
                  : 0n;
            return (
              <tr
                key={i}
                className={eq(entry?.wallet, account) ? "your-row" : ""}
              >
                <th scope="row">
                  <span className="rank">{i + 1}</span>
                  {occupied ? (
                    <Name address={entry.wallet} />
                  ) : (
                    <span className="muted">Open place</span>
                  )}
                </th>
                <td>{occupied ? entry.points : "—"}</td>
                <td>{shares[i]}%</td>
                <td>
                  {fmt(payout, 5)}
                  {occupied && !qualified && (
                    <span className="table-note">Rolls over</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function Seasons() {
  const { data, wallet, account, now } = useApp();
  if (!data)
    return (
      <>
        <div className="page-heading">
          <h1>Words worth keeping.</h1>
          <p>Reading the season ledger…</p>
        </div>
      </>
    );
  const c = data.constants,
    alive = now < data.lastVerdictAt + c.DEADMAN;
  const ready =
    data.closeBounds[0] && now >= data.closeBounds[2] + c.CLOSE_GRACE;
  const unrecorded = data.pleas
    .filter(
      (p) =>
        approved(p) &&
        !p.recorded &&
        (p.verdictAt - data.startedAt) / c.SEASON === data.nextToClose,
    )
    .map((p) => p.id);
  const ranking = standings(data.pleas, data.startedAt, c.SEASON, data.season),
    rank = ranking.findIndex((e) => eq(e.wallet, account)) + 1;
  return (
    <>
      <div className="page-heading">
        <h1>Words worth keeping.</h1>
        <p>
          Season {String(data.season + 1n)} ·{" "}
          {alive ? `${duration(data.endsAt - now)} left` : "The final season"} ·{" "}
          {fmt(data.seasonPot, 5)} IMD in prizes
        </p>
      </div>
      <div className="section-heading">
        <div>
          <h2>The season’s top ten</h2>
          <p className="muted">
            Your three best scores count. Below {String(c.MIN_POINTS)} points,
            the share rolls over.
          </p>
        </div>
      </div>
      <Leaderboard entries={data.top} pot={data.seasonPot} />
      {account ? (
        <div className="personal-standing">
          <h3>Your standing</h3>
          <p>
            {rank
              ? `You’re #${rank} this season.`
              : "You have no recorded points this season."}{" "}
            Best scores: {wallet ? wallet.best.join(" · ") : "Reading…"}.
          </p>
        </div>
      ) : (
        <WalletHint verb="see your rank and three best scores" />
      )}
      <section className="section-block">
        <h2>The five finest pleas</h2>
        <p className="muted">
          The season’s highest-scoring approved cases become Laureates.
        </p>
        <PleaGrid
          pleas={data.topPleas
            .filter((p) => p.pleaId > 0n)
            .map((p) => data.pleas.find((plea) => plea.id === p.pleaId)!)
            .filter(Boolean)}
          empty="A place in the record is open"
        />
      </section>
      <section className="season-close section-block">
        <h2>Bring a season to a close</h2>
        {data.closeBounds[0] ? (
          <>
            <p>
              Season {String(data.nextToClose + 1n)}{" "}
              {ready
                ? "is ready to close."
                : `can close in ${duration(data.closeBounds[2] + c.CLOSE_GRACE - now)}.`}{" "}
              Closing records {unrecorded.length} remaining approved{" "}
              {unrecorded.length === 1 ? "plea" : "pleas"}, pays eligible
              winners and mints the Laureates.
            </p>
            <p className="small muted">
              Seasons close in order, after a {Number(c.CLOSE_GRACE) / 3600}
              -hour grace period.
            </p>
            <WalletHint verb="close the season" />
            <TxButton
              label={`Close season ${data.nextToClose + 1n}`}
              disabled={!ready}
              action={({ send }) =>
                send(
                  "Seasons",
                  "closeSeason",
                  [unrecorded],
                  false,
                  `Close season ${data.nextToClose + 1n}`,
                )
              }
            />
          </>
        ) : (
          <p>Every available season is closed.</p>
        )}
        {data.finished && data.totalPot > 0n && (
          <>
            <p>{fmt(data.totalPot, 5)} IMD remains after the last close.</p>
            <TxButton
              label="Send leftovers to the buy wall"
              action={({ send }) =>
                send(
                  "Seasons",
                  "flushToWall",
                  [],
                  false,
                  "Send leftovers to the buy wall",
                )
              }
            />
          </>
        )}
      </section>
      <section className="section-block">
        <h2>Hall of Fame</h2>
        <p className="muted">
          Closed seasons, paid prizes and words preserved on chain.
        </p>
        {data.halls.length ? (
          data.halls.map((h) => (
            <details className="hall-season" key={String(h.season)} open>
              <summary>
                Season {String(h.season + 1n)} · {fmt(h.paid, 5)} IMD paid
              </summary>
              <p>
                Prize pot {fmt(h.pot, 5)} IMD. {fmt(h.pot - h.paid, 5)} IMD
                rolled over.
              </p>
              <Leaderboard
                entries={h.top}
                pot={h.pot}
                closed
                payouts={h.payouts}
              />
            </details>
          ))
        ) : (
          <Empty title="The Hall is waiting">
            Close an ended season after its grace period to settle prizes and
            mint the first Laureates.
          </Empty>
        )}
        <NFTGallery nfts={data.nfts} />
      </section>
    </>
  );
}
export function Profile() {
  const { data, account, wallet } = useApp();
  const [name, setName] = useState(""),
    [saved, setSaved] = useState(""),
    [availability, setAvailability] = useState<{
      name: string;
      available: boolean;
    }>(),
    [checking, setChecking] = useState(false),
    [problem, setProblem] = useState("");
  useEffect(() => {
    let current = true;
    setSaved("");
    setName("");
    if (account)
      void read<string>("Laureates", "nameOf", [account])
        .then((n) => {
          if (current) {
            setSaved(n);
            setName(n);
          }
        })
        .catch((e) => {
          if (current) setProblem(explainError(e));
        });
    return () => {
      current = false;
    };
  }, [account]);
  const localError = validateName(name);
  useEffect(() => {
    setAvailability(undefined);
    setProblem("");
    if (!account || !name || localError) return;
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(
      () =>
        void read<Address>("Laureates", "nameOwner", [keccak256(toHex(name))])
          .then((owner) => {
            if (!cancelled)
              setAvailability({
                name,
                available: /^0x0+$/.test(owner) || eq(owner, account),
              });
          })
          .catch((e) => {
            if (!cancelled) setProblem(explainError(e));
          })
          .finally(() => {
            if (!cancelled) setChecking(false);
          }),
      300,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [name, account, localError]);
  const mine = data?.pleas.filter((p) => eq(p.seller, account)) ?? [];
  const available = availability?.name === name && availability.available;
  const keys = [
    ...new Set(
      mine
        .filter((p) => p.recorded)
        .map((p) => (p.verdictAt - data!.startedAt) / data!.constants.SEASON),
    ),
  ].sort((a, b) => (a > b ? -1 : 1));
  return (
    <>
      <div className="page-heading">
        <h1>Your name in the record.</h1>
        <p>A case, a reputation, a place in the court.</p>
      </div>
      <WalletHint verb="set a display name and see your profile" />
      <div className="two-column">
        <section>
          <h2>Display name</h2>
          <label htmlFor="display-name">Your public name</label>
          <input
            id="display-name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            disabled={!account}
            aria-describedby="name-help name-state"
            aria-invalid={!!localError || availability?.available === false}
          />
          <p className="small muted" id="name-help">
            3–20 characters: a–z, 0–9 and _. Names are unique. Reserved: cabal,
            admin, imd, plea, owner.
          </p>
          <p
            id="name-state"
            className={
              localError || availability?.available === false
                ? "error-text"
                : "small"
            }
            role="status"
          >
            {localError ||
              (checking
                ? "Checking availability…"
                : availability
                  ? available
                    ? "This name is available to you."
                    : "This name is taken. Choose another."
                  : "")}
          </p>
          {problem && <Notice error>{problem}</Notice>}
          <div className="actions">
            <TxButton
              label="Set display name"
              primary
              disabled={!name || !!localError || !available || name === saved}
              action={async ({ send }) => {
                const hash = await send(
                  "Laureates",
                  "setName",
                  [name],
                  false,
                  "Set display name",
                );
                setSaved(name);
                return hash;
              }}
            />
            <TxButton
              label="Clear display name"
              disabled={!saved}
              action={async ({ send }) => {
                const hash = await send(
                  "Laureates",
                  "setName",
                  [""],
                  false,
                  "Clear display name",
                );
                setSaved("");
                setName("");
                return hash;
              }}
            />
          </div>
        </section>
        <aside className="side-notes">
          <h2>Your sIMD</h2>
          <dl className="stats-list">
            <div>
              <dt>Stacked by PLEA</dt>
              <dd>{fmt(wallet?.stacked, 5)} sIMD</dd>
            </div>
            <div>
              <dt>sIMD wallet balance</dt>
              <dd>{fmt(wallet?.simd, 5)}</dd>
            </div>
          </dl>
          <External href={accountUrl}>View sIMD in imd/acc</External>
          <h2>Points by season</h2>
          {keys.length ? (
            <dl className="stats-list">
              {keys.map((key) => {
                const standing = standings(
                  data!.pleas,
                  data!.startedAt,
                  data!.constants.SEASON,
                  key,
                ).find((e) => eq(e.wallet, account));
                return (
                  <div key={String(key)}>
                    <dt>Season {String(key + 1n)}</dt>
                    <dd>{standing?.points ?? 0} points</dd>
                  </div>
                );
              })}
            </dl>
          ) : (
            <p className="muted">
              Recorded approvals will appear here. Each season counts your three
              best scores.
            </p>
          )}
        </aside>
      </div>
      <section className="section-block">
        <h2>Your Laureates</h2>
        <NFTGallery
          nfts={data?.nfts.filter((n) => eq(n.owner, account)) ?? []}
        />
      </section>
      <section className="section-block">
        <h2>Your pleas</h2>
        <PleaGrid
          pleas={mine}
          empty={
            account ? "Your case has yet to be heard" : "Your pleas live here"
          }
        />
      </section>
    </>
  );
}
export function Status() {
  const { data, now } = useApp();
  const alive =
    data &&
    data.startedAt > 0n &&
    now < data.lastVerdictAt + data.constants.DEADMAN;
  const metrics = data
    ? [
        ["Last verdict / initial seed", when(data.lastVerdictAt)],
        ["Price", `${fmt(priceOf(data.price), 8)} IMD / PLEA`],
        ["Market cap", `${fmt((data.supply * data.price) / 2n ** 96n, 3)} IMD`],
        ["Current PLEA supply", fmt(data.supply, 0)],
        ["PLEA in market", fmt(data.market, 0)],
        ["Wall IMD", fmt(data.wall, 6)],
        ["Retained IMD", fmt(data.retained, 6)],
        ["PLEA burned", fmt(data.burned, 0)],
        ["Trading opened", when(data.startedAt)],
        ["Launch START", when(data.constants.START)],
        ["Last read", `Block ${data.block} · ${when(data.timestamp)}`],
      ]
    : [];
  return (
    <>
      <div className="page-heading">
        <h1>The state of the court.</h1>
        <p>
          {!data
            ? "Reading the live contracts…"
            : alive
              ? `Cabal alive · dies in ${duration(data.lastVerdictAt + data.constants.DEADMAN - now)} without a verdict`
              : "The Cabal is dead. PLEA trades freely forever."}
        </p>
      </div>
      <div className="two-column">
        <section>
          <h2>On the record</h2>
          <dl className="stats-list status-stats">
            {metrics.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <aside className="side-notes">
          <h2>A clock, not a vote.</h2>
          <p>
            The Cabal’s state is computed from the seed time and the last signed
            verdict. After {data ? Number(data.constants.DEADMAN) / 3600 : "…"}{" "}
            hours of silence, its authority ends permanently.
          </p>
          <h2>The buy wall</h2>
          <p>
            The hook burns PLEA and manages the market and IMD buy wall. Anyone
            can rebalance when there is work to do.
          </p>
          {data?.rebalance ? (
            <>
              <WalletHint verb="rebalance the pool" />
              <TxButton
                label="Rebalance"
                action={({ send }) =>
                  send("PleaHook", "rebalance", [], false, "Rebalance")
                }
              />
            </>
          ) : (
            <p className="muted">
              {data
                ? "The pool does not need rebalancing."
                : "Checking the pool…"}
            </p>
          )}
          <h2>Sepolia testnet</h2>
          <p>These contracts use test tokens. No mainnet assets are needed.</p>
        </aside>
      </div>
      <section className="section-block">
        <h2>Contract addresses</h2>
        <div className="address-list">
          {Object.entries(addresses).map(([name, address]) => (
            <div key={name}>
              <h3>{name}</h3>
              <External href={addressLink(address)}>
                <span className="address">{address}</span>
              </External>
            </div>
          ))}
        </div>
      </section>
      <details className="section-block">
        <summary>Read the live fees, caps and timings</summary>
        <dl className="stats-list constants-list">
          {data &&
            Object.entries(data.constants).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
        </dl>
        <p className="small muted">
          Raw contract units: token amounts use 18 decimals; timings are
          seconds; BPS use a 10,000 denominator.
        </p>
      </details>
    </>
  );
}

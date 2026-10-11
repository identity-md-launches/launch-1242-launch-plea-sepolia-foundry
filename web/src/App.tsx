import { useEffect, useState } from "react";
import { Moon, Sun, ArrowClockwise } from "@phosphor-icons/react";
import { useApp } from "./context";
import { duration, fmt, short } from "./domain";
import { Notice, External } from "./components";
import { Overview, Wall, Seasons, Profile, Status } from "./pages";
import { Buy } from "./Trade";
import { Plead, PleaPage } from "./Plead";
const getRoute = () => location.hash.slice(1) || "/";
export default function App() {
  const {
    data,
    account,
    now,
    error,
    loading,
    refresh,
    connect,
    disconnect,
    connecting,
    connectionError,
  } = useApp();
  const [route, setRoute] = useState(getRoute),
    [dark, setDark] = useState(() => {
      try {
        return localStorage.getItem("plea-theme")
          ? localStorage.getItem("plea-theme") === "dark"
          : matchMedia("(prefers-color-scheme: dark)").matches;
      } catch {
        return false;
      }
    });
  useEffect(() => {
    const fn = () => {
      setRoute(getRoute());
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        document.getElementById("main")?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("plea-theme", dark ? "dark" : "light");
    } catch {}
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#211d19" : "#f4eee3");
  }, [dark]);
  const [path, query] = route.split("?");
  const section = path.split("/")[1] || "overview";
  const dead =
    data &&
    data.startedAt > 0n &&
    now >= data.lastVerdictAt + data.constants.DEADMAN;
  const nav = [
    ["overview", "Overview"],
    ["buy", "Buy"],
    [dead ? "buy/sell" : "plead", dead ? "Sell" : "Plead"],
    ["wall", "Wall"],
    ["seasons", "Seasons"],
    ["profile", "Profile"],
    ["status", "Status"],
  ];
  const cabal = !data
    ? "Reading the Cabal’s clock…"
    : !data.startedAt
      ? "The court is waiting for trading to open."
      : dead
        ? "The Cabal is dead. PLEA trades freely forever."
        : `Cabal alive · dies in ${duration(data.lastVerdictAt + data.constants.DEADMAN - now)} without a verdict`;
  const titles: Record<string, string> = {
    overview: "Make your case",
    buy: "Buy PLEA",
    plead: "Plead to sell",
    wall: "The Wall",
    seasons: "Seasons",
    profile: "Your profile",
    status: "Status",
    plea: `Plea ${path.split("/")[2]}`,
  };
  useEffect(() => {
    document.title = `PLEA — ${titles[section] || "Page not found"}`;
  }, [section, path]);
  useEffect(() => {
    if (path === "/buy/sell")
      document.getElementById("sell")?.scrollIntoView({ block: "start" });
    if (path.startsWith("/seasons/laureate/"))
      document
        .getElementById(`laureate-${path.split("/")[3]}`)
        ?.scrollIntoView({ block: "center" });
  }, [path, data?.nfts.length]);
  let page;
  switch (section) {
    case "overview":
      page = <Overview />;
      break;
    case "buy":
      page = <Buy />;
      break;
    case "plead":
      page = (
        <Plead
          key={route}
          appealId={new URLSearchParams(query).get("appeal") ?? undefined}
        />
      );
      break;
    case "wall":
      page = <Wall />;
      break;
    case "seasons":
      page = <Seasons />;
      break;
    case "profile":
      page = <Profile />;
      break;
    case "status":
      page = <Status />;
      break;
    case "plea":
      page = <PleaPage id={path.split("/")[2]} />;
      break;
    default:
      page = (
        <div className="page-heading">
          <h1>This page is not in the record.</h1>
          <a href="#/">Return to Overview</a>
        </div>
      );
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-top">
          <a className="wordmark" href="#/" aria-label="PLEA overview">
            PLEA
          </a>
          <div className="header-actions">
            <button
              className="icon-button"
              onClick={() => setDark((v) => !v)}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              title={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? (
                <Sun weight="regular" size={21} />
              ) : (
                <Moon weight="regular" size={21} />
              )}
            </button>
            <button
              className="button connect"
              onClick={() => (account ? disconnect() : void connect())}
              disabled={connecting}
              title={account ? "Disconnect this site" : undefined}
            >
              {connecting
                ? "Connecting…"
                : account
                  ? short(account)
                  : "Connect"}
            </button>
          </div>
        </div>
        <div className="header-state">
          <p className="cabal-state">
            <span
              className={`state-dot ${dead ? "dead" : ""}`}
              aria-hidden="true"
            />
            {cabal}
          </p>
          <a className="season-pill" href="#/seasons">
            {data
              ? `Season ${data.season + 1n} · ${dead ? "ended" : `${duration(data.endsAt - now)} left`} · pot ${fmt(data.seasonPot, 4)} IMD`
              : "Reading the season…"}
          </a>
        </div>
        {connectionError && <Notice error>{connectionError}</Notice>}
        <nav className="top-nav" aria-label="Main navigation">
          {nav.map(([key, label], i) => (
            <a
              key={`${key}-${i}`}
              href={key === "overview" ? "#/" : `#/${key}`}
              aria-current={
                (
                  key === "buy/sell"
                    ? path === "/buy/sell"
                    : section === key &&
                      !(key === "buy" && path === "/buy/sell")
                )
                  ? "page"
                  : undefined
              }
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="site-main">
        {error && (
          <Notice error>
            {data
              ? "Live reads paused; the figures below may be out of date. "
              : ""}
            {error}{" "}
            <button className="text-button" onClick={() => void refresh()}>
              Retry live data
            </button>
          </Notice>
        )}
        {page}
      </main>
      <footer className="site-footer">
        <div>
          <a className="footer-wordmark" href="#/">
            PLEA
          </a>
          <p>
            Inspired by TokenWorks’ CabalCoin.
            <br />A court of public opinion, on Sepolia.
          </p>
        </div>
        <div className="footer-meta">
          <p>
            {data
              ? `Read from Sepolia · block ${data.block}`
              : loading
                ? "Connecting to Sepolia…"
                : "Live connection unavailable"}
          </p>
          <button className="text-button" onClick={() => void refresh()}>
            <ArrowClockwise size={16} aria-hidden="true" /> Refresh live data
          </button>
          <External href="https://sepolia.etherscan.io">
            Sepolia explorer
          </External>
        </div>
      </footer>
    </>
  );
}

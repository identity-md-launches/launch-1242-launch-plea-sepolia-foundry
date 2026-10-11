// Run in the production page's browser console after loading axe-core for QA.
// The worker uses this same body through the supplied browser tool.
async function checkPage() {
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width && r.height && getComputedStyle(e).visibility !== "hidden";
  };
  const controls = [
    ...document.querySelectorAll("button,input,textarea,a,summary"),
  ]
    .filter(visible)
    .map((e) => ({
      label: e.getAttribute("aria-label") || e.textContent.trim(),
      width: e.getBoundingClientRect().width,
      height: e.getBoundingClientRect().height,
    }));
  if (!window.axe)
    throw new Error("Load axe-core before running the browser check.");
  const axe = await window.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
  });
  return {
    route: location.hash || "#/",
    theme: document.documentElement.dataset.theme,
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth,
    nav: [...document.querySelectorAll(".top-nav a")].map((e) => ({
      label: e.textContent,
      visible: visible(e),
      left: e.getBoundingClientRect().left,
      right: e.getBoundingClientRect().right,
    })),
    connect: document.querySelectorAll(".connect").length,
    h1: document.querySelector("h1")?.textContent,
    smallControls: controls.filter((c) => c.height < 43.5 || c.width < 43.5),
    fonts: [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => f.family),
    brokenImages: [...document.images]
      .filter((i) => i.complete && !i.naturalWidth)
      .map((i) => i.src.slice(0, 80)),
    violations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  };
}

/* ============================================================
   司南 Sinan — App (routing + theme/inv state). Shell pieces live in shell.jsx
   ============================================================ */
function App() {
  const [page, setPage] = React.useState("dashboard");
  const [themePref, setThemePref] = React.useState("dark"); // dark | light | auto
  const [inv, setInv] = React.useState(false);
  const [onboarding, setOnboarding] = React.useState(false);

  const resolved = themePref === "auto"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : themePref;

  React.useEffect(() => { document.documentElement.setAttribute("data-theme", resolved); }, [resolved]);
  React.useEffect(() => { document.documentElement.setAttribute("data-pnl", inv ? "gr" : "rg"); }, [inv]);

  const Page = PAGES[page];
  const ctx = { theme: resolved, themePref, setThemePref, inv, setInv };

  if (onboarding) {
    return <AppCtx.Provider value={ctx}><Onboarding onDone={() => setOnboarding(false)} /></AppCtx.Provider>;
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className="main-aurora" style={{ display: "flex", flexDirection: "column", height: "100vh", minWidth: 1180, overflow: "hidden" }}>
        <TitleBar />
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <Sidebar page={page} setPage={setPage}
            theme={resolved} toggleTheme={() => setThemePref(resolved === "dark" ? "light" : "dark")}
            openOnboarding={() => setOnboarding(true)} />
          <main style={{ flex: 1, minWidth: 0, background: "transparent", overflow: "auto", position: "relative" }}>
            <Page />
          </main>
        </div>
        <StatusBar />
      </div>
    </AppCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

import { NavLink, Route, Routes } from "react-router-dom";
import { Scoreboard } from "./pages/Scoreboard";
import { LeakView } from "./pages/LeakView";
import { TestMyBrowser } from "./pages/TestMyBrowser";
import { Methodology } from "./pages/Methodology";
import { RunPage } from "./pages/RunPage";

export function App() {
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand">
          <span className="dot" /> AnonScope
        </NavLink>
        <nav>
          <NavLink to="/" end>Scoreboard</NavLink>
          <NavLink to="/leak">Leak view</NavLink>
          <NavLink to="/test">Test from my browser</NavLink>
          <NavLink to="/methodology">Methodology</NavLink>
        </nav>
        <span className="spacer" />
        <a href="/api/scores.json" className="mono small">scores.json</a>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Scoreboard />} />
          <Route path="/leak" element={<LeakView />} />
          <Route path="/test" element={<TestMyBrowser />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/run" element={<RunPage />} />
          <Route path="*" element={<p>Not found. <NavLink to="/">Back to the scoreboard</NavLink></p>} />
        </Routes>
      </main>
      <footer className="foot">
        Open source (MIT). Synthetic wallets only. No analytics, trackers, fonts or CDNs. Every RPC read goes through{" "}
        <code>@anon-rpc/browser-harness</code>.
      </footer>
    </>
  );
}

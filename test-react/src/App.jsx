import { Routes, Route, useNavigate } from "react-router-dom";
import Simulation from "./Simulation";
import "./App.css";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/simulation" element={<Simulation />} />
    </Routes>
  );
}

function Landing() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="hero">
        <h1>Orchestris</h1>
        <p className="tagline">
          A simulated distributed systems manager powered by an autonomous
          resource allocation agent.
        </p>
        <button className="cta" onClick={() => navigate("/simulation")}>
          Launch Simulation
        </button>
      </header>

      <section className="section">
        <h2>What It Does</h2>
        <p>
          Orchestris models a multi-node distributed system where services
          compete for limited resources such as CPU, memory, and bandwidth.
        </p>
        <p>
          An intelligent agent continuously observes system state and makes
          allocation decisions to maximize throughput, stability, and fairness.
        </p>
      </section>

      <section className="section">
        <h2>Agent Capabilities</h2>
        <ul>
          <li>Dynamic CPU and memory allocation</li>
          <li>Replica scaling under load</li>
          <li>Failure and congestion response</li>
          <li>Strategy comparison and replay</li>
        </ul>
      </section>

      <section className="section">
        <h2>Why Simulate?</h2>
        <p>
          Real distributed systems are expensive and risky to experiment with.
          Orchestris lets you explore system behavior, allocation strategies,
          and emergent dynamics in a controlled environment.
        </p>
      </section>

      <footer className="footer">
        <p>Simulate first. Deploy later.</p>
      </footer>
    </div>
  );
}

export default function Simulation() {
  return (
    <div className="simulation">
      <svg
        className="network"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* connections */}
        <line x1="400" y1="120" x2="200" y2="260" />
        <line x1="400" y1="120" x2="600" y2="260" />
        <line x1="200" y1="260" x2="400" y2="380" />
        <line x1="600" y1="260" x2="400" y2="380" />
        <line x1="200" y1="260" x2="600" y2="260" />

        {/* nodes */}
        <Node x={400} y={120} label="Agent" main />
        <Node x={200} y={260} label="Worker A" />
        <Node x={600} y={260} label="Worker B" />
        <Node x={400} y={380} label="Storage" />
        <Node x={400} y={260} label="Scheduler" />
      </svg>
    </div>
  );
}

function Node({ x, y, label, main }) {
  return (
    <g className={`node ${main ? "main" : ""}`}>
      <circle cx={x} cy={y} r="26" />
      <text x={x} y={y + 45} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

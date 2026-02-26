// Basic front-end for your Manager API (main.py).
// Uses endpoints: /health, /nodes, /jobs/submit, /agents/learner_stats, /agents/pending.

const el = (id) => document.getElementById(id);

const apiBaseEl = el("apiBase");
const goalKindEl = el("goalKind");
const learnerKindEl = el("learnerKind");
const seedEl = el("seed");
const userIdEl = el("userId");
const serviceTimeEl = el("serviceTime");
const serviceTimeValEl = el("serviceTimeVal");
const rateEl = el("rate");
const rateValEl = el("rateVal");

const btnStart = el("btnStart");
const btnPause = el("btnPause");
const btnSubmitOnce = el("btnSubmitOnce");

const healthEl = el("health");
const pendingEl = el("pending");
const topPolicyEl = el("topPolicy");
const logEl = el("log");
const nodesEl = el("nodes");
const nodeCountEl = el("nodeCount");

const learnerKwargsEl = el("learnerKwargs");
const goalKwargsEl = el("goalKwargs");

const leaderboardEl = el("leaderboard");

const canvas = el("chart");
const ctx = canvas.getContext("2d");

let running = false;
let submitTimer = null;
let pollTimer = null;

// Timeseries: policy -> [{t, score}]
const series = new Map();
const colorPool = [
  "#7c6cff", "#22c55e", "#38bdf8", "#f97316", "#e879f9", "#facc15", "#fb7185", "#a3e635"
];
const policyColor = new Map();

function log(msg){
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n` + logEl.textContent;
}

function apiBase(){
  return apiBaseEl.value.trim().replace(/\/+$/, "");
}

function parseJsonOrEmpty(text){
  const s = (text || "").trim();
  if (!s) return {};
  try { return JSON.parse(s); }
  catch (e) { throw new Error("Invalid JSON in kwargs textarea."); }
}

function agentConfig(){
  const seed = seedEl.value.trim();
  return {
    learner_kind: learnerKindEl.value,
    goal_kind: goalKindEl.value,
    seed: seed === "" ? null : Number(seed),
    learner_kwargs: parseJsonOrEmpty(learnerKwargsEl.value),
    goal_kwargs: parseJsonOrEmpty(goalKwargsEl.value),
  };
}

// JobRequest matches your dataclass: job_id, user_id, service_time_ms, metadata【turn2:12†state_types.py†L16-L23】
function buildJob(){
  const id = `job_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  return {
    job_id: id,
    user_id: userIdEl.value.trim() || "u1",
    service_time_ms: Number(serviceTimeEl.value),
    metadata: {}
  };
}

async function apiGet(path){
  const r = await fetch(`${apiBase()}${path}`);
  if (!r.ok) throw new Error(`${path} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function apiPost(path, body){
  const r = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const text = await r.text().catch(()=> "");
    throw new Error(`${path} failed: ${r.status} ${text}`);
  }
  return r.json();
}

// ---- Score extraction from learner_stats (supports multiple learner types) ----
// UCB1 / SampleAverage / EMA returns {policy: {n, Q}}【turn1file1†learning_method.py†L70-L83】【turn1file1†learning_method.py†L124-L131】
// ThompsonGaussian returns {policy: {n, mean, std}}【turn1file1†learning_method.py†L173-L179】
// ContextualLinear returns {policy: {n, mean_reward, ...}}【turn1file1†learning_method.py†L282-L295】
// SlidingWindow returns {policy: {n_window, mean_window, window}}【turn1file1†learning_method.py†L314-L315】
function policyScore(statsObj){
  if (!statsObj || typeof statsObj !== "object") return 0;

  if (typeof statsObj.Q === "number") return statsObj.Q;
  if (typeof statsObj.mean_reward === "number") return statsObj.mean_reward;
  if (typeof statsObj.mean_window === "number") return statsObj.mean_window;
  if (typeof statsObj.mean === "number") return statsObj.mean;

  return 0;
}

function policyCount(statsObj){
  if (!statsObj || typeof statsObj !== "object") return 0;
  if (typeof statsObj.n === "number") return statsObj.n;
  if (typeof statsObj.n_window === "number") return statsObj.n_window;
  return 0;
}

// ---- Rendering ----
function pctBar(pct){
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="bar"><div style="width:${p}%"></div></div>`;
}

function renderNodes(nodes){
  nodesEl.innerHTML = "";
  nodeCountEl.textContent = `${nodes.length} nodes`;

  for (const n of nodes){
    const cpu = (n.cpu_pct ?? 0);
    const mem = (n.mem_pct ?? 0);
    const q = (n.queue_len ?? 0);
    const f = (n.in_flight ?? 0);

    const ewma = (n.ewma_latency_ms ?? null);
    const p95 = (n.p95_latency_ms ?? null);
    const speed = (n.node_speed ?? null);

    const card = document.createElement("div");
    card.className = "node";
    card.innerHTML = `
      <div class="node-top">
        <div class="node-name">${n.name}</div>
        <div class="node-meta">${n.host}:${n.port}</div>
      </div>
      <div class="kv"><div>CPU</div><div><span>${cpu.toFixed ? cpu.toFixed(1) : cpu}%</span></div></div>
      ${pctBar(cpu)}
      <div class="kv"><div>Memory</div><div><span>${mem.toFixed ? mem.toFixed(1) : mem}%</span></div></div>
      ${pctBar(mem)}
      <div class="kv"><div>Queue</div><div><span>${q}</span></div></div>
      <div class="kv"><div>In flight</div><div><span>${f}</span></div></div>
      <div class="kv"><div>EWMA lat</div><div><span>${ewma == null ? "—" : `${Math.round(ewma)} ms`}</span></div></div>
      <div class="kv"><div>P95 lat</div><div><span>${p95 == null ? "—" : `${Math.round(p95)} ms`}</span></div></div>
      <div class="kv"><div>Speed</div><div><span>${speed == null ? "—" : speed.toFixed(2)}</span></div></div>
    `;
    nodesEl.appendChild(card);
  }
}

function renderLeaderboard(stats){
  const rows = Object.entries(stats || {})
    .map(([policy, st]) => ({
      policy,
      score: policyScore(st),
      n: policyCount(st),
      raw: st
    }))
    .sort((a,b) => b.score - a.score);

  leaderboardEl.innerHTML = "";
  if (!rows.length){
    leaderboardEl.innerHTML = `<div class="hint">No data yet — submit jobs to start learning.</div>`;
    topPolicyEl.textContent = "—";
    return;
  }

  topPolicyEl.textContent = rows[0].policy;

  for (const r of rows){
    const item = document.createElement("div");
    item.className = "lb-item";
    item.innerHTML = `
      <div class="lb-left">
        <div class="lb-name">${r.policy}</div>
        <div class="lb-sub">n=${r.n}</div>
      </div>
      <div class="lb-score">${Number.isFinite(r.score) ? r.score.toFixed(3) : "0.000"}</div>
    `;
    leaderboardEl.appendChild(item);
  }
}

function ensureColor(policy){
  if (!policyColor.has(policy)){
    const c = colorPool[policyColor.size % colorPool.length];
    policyColor.set(policy, c);
  }
  return policyColor.get(policy);
}

// Simple multi-line chart (no libs)
function drawChart(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // background grid
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  for (let x=0; x<=canvas.width; x+=90){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for (let y=0; y<=canvas.height; y+=52){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // gather all points
  const all = [];
  for (const [policy, pts] of series.entries()){
    for (const p of pts) all.push(p.score);
  }
  if (all.length < 2) return;

  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max){ min -= 1; max += 1; }

  // time window
  const now = Date.now();
  const windowMs = 60_000; // last 60 seconds
  const t0 = now - windowMs;

  // axes labels
  ctx.fillStyle = "rgba(229,231,235,0.9)";
  ctx.font = "12px ui-sans-serif";
  ctx.fillText(`score (auto range)`, 10, 16);

  function xy(p){
    const x = (p.t - t0) / windowMs * (canvas.width - 20) + 10;
    const y = canvas.height - 10 - ((p.score - min) / (max - min)) * (canvas.height - 30);
    return {x, y};
  }

  for (const [policy, pts0] of series.entries()){
    const pts = pts0.filter(p => p.t >= t0);
    if (pts.length < 2) continue;

    ctx.strokeStyle = ensureColor(policy);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const first = xy(pts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i=1; i<pts.length; i++){
      const p = xy(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
}

// ---- Polling / simulation ----
async function pollOnce(){
  // health
  try {
    const h = await apiGet("/health");
    healthEl.textContent = h.ok ? "OK" : "BAD";
  } catch {
    healthEl.textContent = "DOWN";
  }

  // nodes
  try{
    const data = await apiGet("/nodes");
    renderNodes(data.nodes || []);
  } catch(e){
    log(`nodes error: ${e.message}`);
  }

  // pending
  try{
    const pending = await apiPost("/agents/pending", agentConfig());
    const n = (pending.pending_job_ids || []).length;
    pendingEl.textContent = String(n);
  } catch(e){
    // if config is invalid (e.g. contextual needs feature_keys), you'll see it here
    pendingEl.textContent = "—";
  }

  // learner stats -> leaderboard + chart
  try{
    const stats = await apiPost("/agents/learner_stats", agentConfig());
    renderLeaderboard(stats);

    const t = Date.now();
    for (const [policy, st] of Object.entries(stats || {})){
      const score = policyScore(st);
      if (!series.has(policy)) series.set(policy, []);
      series.get(policy).push({ t, score });

      // keep it light
      const pts = series.get(policy);
      if (pts.length > 400) pts.splice(0, pts.length - 400);
    }
    drawChart();
  } catch(e){
    log(`learner_stats error: ${e.message}`);
  }
}

async function submitOne(){
  const body = {
    config: agentConfig(),
    job: buildJob()
  };

  // This matches your POST /jobs/submit schema (SubmitJobRequest)【turn2:0†main.py†L34-L47】【turn2:1†main.py†L93-L96】
  try{
    const resp = await apiPost("/jobs/submit", body);
    const d = resp.decision;
    log(`submitted ${body.job.job_id} -> policy=${d.policy_name} node=${d.node_name} (${d.host}:${d.port})`);
  } catch(e){
    log(`submit error: ${e.message}`);
  }
}

function startSimulation(){
  if (running) return;
  running = true;
  btnStart.disabled = true;
  btnPause.disabled = false;
  log("simulation started");

  // submit loop
  const tick = async () => {
    if (!running) return;
    const rate = Number(rateEl.value);
    if (rate <= 0) return;

    // submit "rate" jobs spread over 1 second
    // simplest: 1 job per interval
    const intervalMs = Math.max(50, Math.floor(1000 / rate));
    submitTimer = setInterval(() => {
      if (running) submitOne();
    }, intervalMs);
  };

  tick();

  // poll loop
  pollTimer = setInterval(pollOnce, 1500);
  pollOnce();
}

function pauseSimulation(){
  running = false;
  btnStart.disabled = false;
  btnPause.disabled = true;
  if (submitTimer) clearInterval(submitTimer);
  if (pollTimer) clearInterval(pollTimer);
  submitTimer = null;
  pollTimer = null;
  log("simulation paused");
}

// ---- UI wiring ----
serviceTimeEl.addEventListener("input", () => {
  serviceTimeValEl.textContent = serviceTimeEl.value;
});
rateEl.addEventListener("input", () => {
  rateValEl.textContent = rateEl.value;
  if (running){
    // restart submit timer with new rate
    if (submitTimer) clearInterval(submitTimer);
    const rate = Number(rateEl.value);
    if (rate > 0){
      const intervalMs = Math.max(50, Math.floor(1000 / rate));
      submitTimer = setInterval(() => {
        if (running) submitOne();
      }, intervalMs);
    }
  }
});

btnStart.addEventListener("click", startSimulation);
btnPause.addEventListener("click", pauseSimulation);
btnSubmitOnce.addEventListener("click", submitOne);

// initial labels
serviceTimeValEl.textContent = serviceTimeEl.value;
rateValEl.textContent = rateEl.value;
btnPause.disabled = true;

// do one initial poll so you see nodes immediately
pollOnce();
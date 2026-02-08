const express = require("express");
const { Pool } = require("pg");
const prom = require("prom-client");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "256kb" }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const register = new prom.Registry();
prom.collectDefaultMetrics({ register });

const httpRequests = new prom.Counter({
  name: "fg_api_http_requests_total",
  help: "total http requests",
  labelNames: ["route", "method", "status"]
});
register.registerMetric(httpRequests);

function metricWrap(route, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
      httpRequests.inc({ route, method: req.method, status: String(res.statusCode || 200) });
    } catch (e) {
      httpRequests.inc({ route, method: req.method, status: "500" });
      res.status(500).json({ error: "internal_error", detail: String(e.message || e) });
    }
  };
}

app.get("/health", metricWrap("/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
}));

// API recebe COMANDO e registra. NÃO decide.
app.post("/commands/operations", metricWrap("/commands/operations", async (req, res) => {
  const { origin, destination, cargoValue, slaHours, penaltyValue } = req.body || {};
  if (!origin || !destination) return res.status(400).json({ error: "missing_origin_or_destination" });

  const payload = {
    opId: crypto.randomUUID(),
    origin,
    destination,
    cargoValue: Number(cargoValue),
    slaHours: Number(slaHours),
    penaltyValue: Number(penaltyValue)
  };

  const coords = [payload.origin.lat, payload.origin.lon, payload.destination.lat, payload.destination.lon];
  if (!coords.every(n => Number.isFinite(n))) return res.status(400).json({ error: "invalid_coordinates" });
  if (!Number.isFinite(payload.cargoValue) || payload.cargoValue <= 0) return res.status(400).json({ error: "invalid_cargoValue" });
  if (!Number.isInteger(payload.slaHours) || payload.slaHours <= 0) return res.status(400).json({ error: "invalid_slaHours" });
  if (!Number.isFinite(payload.penaltyValue) || payload.penaltyValue < 0) return res.status(400).json({ error: "invalid_penaltyValue" });

  await pool.query("insert into commands(kind, payload) values($1, $2::jsonb)", [
    "CREATE_OPERATION",
    JSON.stringify(payload)
  ]);

  res.status(202).json({ accepted: true, opId: payload.opId });
}));

// READ: projeções (inclui weather)
app.get("/projections/operations", metricWrap("/projections/operations", async (req, res) => {
  const r = await pool.query(`
    SELECT
      op.*,
      COALESCE(le.payload->'origin_weather', le.payload->'weather'->'origin') AS origin_weather,
      COALESCE(le.payload->'dest_weather',   le.payload->'weather'->'destination') AS dest_weather,
      le.payload->'riskIdx' AS risk_idx
    FROM operations_projection op
    JOIN ledger_events le ON le.hash = op.event_hash
    ORDER BY op.created_at DESC
    LIMIT 200
  `);
  res.json({ items: r.rows });
}));

app.get("/projections/budget/today", metricWrap("/projections/budget/today", async (req, res) => {
  const r = await pool.query("select day, budget_total, budget_left, updated_at from risk_budget_daily where day = current_date");
  if (r.rows.length === 0) return res.json({ day: null, budget_total: null, budget_left: null });
  res.json(r.rows[0]);
}));

// AUDIT: recomputa hash-chain e orçamento derivado (não confia na UI)
app.get("/audit/recompute", metricWrap("/audit/recompute", async (req, res) => {
  const events = await pool.query("select id, created_at, type, payload, prev_hash, hash from ledger_events order by id asc");

  let ok = true;
  let prev = "GENESIS";
  const issues = [];

  let derivedTotal = null;
  let derivedLeft = null;

  for (const e of events.rows) {
    if (e.prev_hash !== prev) {
      ok = false;
      issues.push({ id: e.id, issue: "prev_hash_mismatch", expected: prev, got: e.prev_hash });
    }
    const computed = sha256(`${e.prev_hash}|${e.type}|${canonicalJson(e.payload)}|${new Date(e.created_at).toISOString()}`);
    if (computed !== e.hash) {
      ok = false;
      issues.push({ id: e.id, issue: "hash_mismatch", expected: computed, got: e.hash });
    }
    if (e.type === "BUDGET_RESET_DAILY") {
      derivedTotal = Number(e.payload.total);
      derivedLeft = Number(e.payload.total);
    }
    if (e.type === "OPERATION_DECIDED") {
      const cost = Number(e.payload.cost);
      if (Number.isFinite(cost) && cost > 0 && derivedLeft !== null) derivedLeft = round2(derivedLeft - cost);
    }
    prev = e.hash;
  }

  res.json({ ok, issues, events: events.rows.length, derived_budget: { total: derivedTotal, left: derivedLeft } });
}));

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});

function round2(n){ return Math.round(n * 100) / 100; }
function sha256(s) { return require("crypto").createHash("sha256").update(s).digest("hex"); }
function canonicalJson(obj) { return JSON.stringify(sortKeys(obj)); }
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.keys(x).sort().reduce((a,k)=>(a[k]=sortKeys(x[k]),a),{});
  return x;
}

app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`[api] listening on ${process.env.PORT || 3000}`);
});

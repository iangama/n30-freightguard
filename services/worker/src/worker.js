const { Pool } = require("pg");
const fs = require("fs");
const prom = require("prom-client");
const http = require("http");
const crypto = require("crypto");

if (typeof fetch !== "function") throw new Error("fetch_not_available");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const register = new prom.Registry();
prom.collectDefaultMetrics({ register });

const jobs = new prom.Counter({
  name: "fg_worker_jobs_total",
  help: "jobs processed total",
  labelNames: ["result"]
});
register.registerMetric(jobs);

const port = Number(process.env.PORT || 3001);
const DAILY_BUDGET_TOTAL = Number(process.env.DAILY_BUDGET_TOTAL || "1000");

// SECRET montado pelo Docker
const OWM_KEY_PATH = "/run/secrets/owm_api_key";

http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    res.writeHead(200, { "Content-Type": register.contentType });
    res.end(await register.metrics());
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404); res.end();
}).listen(port, () => console.log(`[worker] metrics/health on ${port}`));

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function round2(n){ return Math.round(n * 100) / 100; }
function canonicalJson(obj){ return JSON.stringify(sortKeys(obj)); }
function sortKeys(x){
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === "object") return Object.keys(x).sort().reduce((a,k)=>(a[k]=sortKeys(x[k]),a),{});
  return x;
}

function summarizeOwm(w) {
  const now = new Date().toISOString();
  const temp = Number(w?.main?.temp ?? null);
  const humidity = Number(w?.main?.humidity ?? null);
  const wind = Number(w?.wind?.speed ?? null);
  const gust = Number(w?.wind?.gust ?? null);
  const rain1h = Number(w?.rain?.["1h"] ?? 0);
  const clouds = Number(w?.clouds?.all ?? null);

  const weather0 = Array.isArray(w?.weather) ? w.weather[0] : null;

  return {
    at: now,
    place: w?.name ?? null,
    country: w?.sys?.country ?? null,
    temp_c: Number.isFinite(temp) ? temp : null,
    humidity_pct: Number.isFinite(humidity) ? humidity : null,
    wind_ms: Number.isFinite(wind) ? wind : null,
    gust_ms: Number.isFinite(gust) ? gust : null,
    rain_1h_mm: Number.isFinite(rain1h) ? rain1h : 0,
    clouds_pct: Number.isFinite(clouds) ? clouds : null,
    conditions: weather0 ? { main: weather0.main ?? null, description: weather0.description ?? null } : null
  };
}

async function getPrevHash() {
  const r = await pool.query("select hash from ledger_events order by id desc limit 1");
  return r.rows.length ? r.rows[0].hash : "GENESIS";
}

async function ensureDailyBudget() {
  const day = (await pool.query("select current_date as d")).rows[0].d;
  const existing = await pool.query("select day from risk_budget_daily where day=$1", [day]);
  if (existing.rows.length) return;

  const prev = await getPrevHash();
  const createdAt = new Date().toISOString();

  // Budget reset event: NÃO mistura com weather.
  const payload = { day: String(day), total: DAILY_BUDGET_TOTAL };
  const hash = sha256(`${prev}|BUDGET_RESET_DAILY|${canonicalJson(payload)}|${createdAt}`);

  await pool.query(
    "insert into ledger_events(created_at,type,payload,prev_hash,hash) values($1,$2,$3::jsonb,$4,$5)",
    [createdAt, "BUDGET_RESET_DAILY", JSON.stringify(payload), prev, hash]
  );
  await pool.query(
    "insert into risk_budget_daily(day,budget_total,budget_left,updated_at) values($1,$2,$2,now())",
    [day, DAILY_BUDGET_TOTAL]
  );

  console.log(`[worker] budget reset day=${day} total=${DAILY_BUDGET_TOTAL} hash=${hash}`);
}

async function readBudgetForUpdate() {
  const r = await pool.query("select budget_left, budget_total from risk_budget_daily where day=current_date for update");
  if (!r.rows.length) throw new Error("budget_missing");
  return { left: Number(r.rows[0].budget_left), total: Number(r.rows[0].budget_total) };
}

async function takeBudget(cost) {
  if (!(cost > 0)) {
    const r = await pool.query("select budget_left from risk_budget_daily where day=current_date");
    return { ok: true, left: r.rows.length ? Number(r.rows[0].budget_left) : null };
  }
  const cur = await readBudgetForUpdate();
  if (cost > cur.left) return { ok: false, left: cur.left };
  const newLeft = round2(cur.left - cost);
  await pool.query("update risk_budget_daily set budget_left=$1, updated_at=now() where day=current_date", [newLeft]);
  return { ok: true, left: newLeft };
}

// OpenWeatherMap (real)
async function fetchWeather(lat, lon, key) {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&appid=${encodeURIComponent(key)}&units=metric`;
  const r = await fetch(url);
  console.log(`[worker] owm_fetch status=${r.status} lat=${lat} lon=${lon}`);
  if (!r.ok) throw new Error(`owm_http_${r.status}`);
  return await r.json();
}

function riskFromWeather(w) {
  const temp = Number(w?.main?.temp ?? 0);
  const wind = Number(w?.wind?.speed ?? 0);
  const gust = Number(w?.wind?.gust ?? 0);
  const rain1h = Number(w?.rain?.["1h"] ?? 0);

  let score = 0;
  score += Math.min(1, wind / 20);
  score += Math.min(1, gust / 25);
  score += Math.min(1, rain1h / 10);
  if (temp <= 0) score += 0.3;
  if (temp >= 35) score += 0.3;

  const idx = Math.max(0, Math.min(1, score / 3.0));
  return { idx, features: { temp, wind, gust, rain1h } };
}

function decide(riskIdx) {
  if (riskIdx < 0.20) return "APPROVED";
  if (riskIdx < 0.70) return "APPROVED_WITH_COST";
  return "BLOCKED";
}

function costFor(decision, cargoValue, penaltyValue, riskIdx) {
  if (decision !== "APPROVED_WITH_COST") return 0;
  const base = cargoValue * riskIdx * 0.01;
  const pen = penaltyValue * riskIdx * 0.02;
  return Math.max(0, round2(base + pen));
}

async function writeDecisionEventAndProjection(payload, decision, cost, riskIdx, budgetLeft, reason, wxSummary, wxRisk) {
  const prev = await getPrevHash();
  const createdAt = new Date().toISOString();

  // ✅ Compat + UI-friendly:
  // - origin_weather / dest_weather (resumo pro front)
  // - weather.origin/destination (mantém o antigo também)
  const eventPayload = {
    opId: payload.opId,
    origin: payload.origin,
    destination: payload.destination,
    cargoValue: Number(payload.cargoValue),
    slaHours: Number(payload.slaHours),
    penaltyValue: Number(payload.penaltyValue),
    decision,
    cost: Number(cost),
    riskIdx: Number(riskIdx),
    budgetLeft: Number(budgetLeft),
    reason: reason || null,

    origin_weather: wxSummary.origin,
    dest_weather: wxSummary.destination,

    weather: {
      origin: wxRisk.r1,
      destination: wxRisk.r2
    }
  };

  const hash = sha256(`${prev}|OPERATION_DECIDED|${canonicalJson(eventPayload)}|${createdAt}`);

  await pool.query(
    "insert into ledger_events(created_at,type,payload,prev_hash,hash) values($1,$2,$3::jsonb,$4,$5)",
    [createdAt, "OPERATION_DECIDED", JSON.stringify(eventPayload), prev, hash]
  );

  await pool.query(
    `insert into operations_projection
      (op_id, origin_lat, origin_lon, dest_lat, dest_lon, cargo_value, sla_hours, penalty_value,
       decision, cost, budget_left, event_hash)
     values
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (op_id) do nothing`,
    [
      payload.opId,
      payload.origin.lat, payload.origin.lon,
      payload.destination.lat, payload.destination.lon,
      Number(payload.cargoValue),
      Number(payload.slaHours),
      Number(payload.penaltyValue),
      decision,
      Number(cost),
      Number(budgetLeft),
      hash
    ]
  );

  console.log(`[worker] ledger_event type=OPERATION_DECIDED opId=${payload.opId} hash=${hash}`);
}

async function processOne() {
  const claimed = await pool.query(`
    with c as (
      select id from commands
      where status='PENDING'
      order by created_at asc
      for update skip locked
      limit 1
    )
    update commands
    set status='PROCESSING'
    where id in (select id from c)
    returning id, kind, payload
  `);

  if (!claimed.rows.length) return false;

  const cmd = claimed.rows[0];
  console.log(`[worker] claimed command id=${cmd.id} kind=${cmd.kind}`);

  try {
    await ensureDailyBudget();
    if (cmd.kind !== "CREATE_OPERATION") throw new Error("unknown_command_kind");

    const key = fs.readFileSync(OWM_KEY_PATH, "utf8").trim();
    if (!key) throw new Error("missing_owm_key");

    const p = cmd.payload;

    const w1 = await fetchWeather(p.origin.lat, p.origin.lon, key);
    const w2 = await fetchWeather(p.destination.lat, p.destination.lon, key);

    const r1 = riskFromWeather(w1);
    const r2 = riskFromWeather(w2);

    const riskIdx = Math.max(r1.idx, r2.idx);
    let decision = decide(riskIdx);
    let cost = costFor(decision, Number(p.cargoValue), Number(p.penaltyValue), riskIdx);

    const wxSummary = {
      origin: summarizeOwm(w1),
      destination: summarizeOwm(w2)
    };

    if (cost > 0) {
      const took = await takeBudget(cost);
      if (!took.ok) {
        decision = "BLOCKED";
        cost = 0;
        await writeDecisionEventAndProjection(p, decision, cost, riskIdx, took.left, "budget_insufficient", wxSummary, { r1, r2 });
        await pool.query("update commands set status='DONE' where id=$1", [cmd.id]);
        jobs.inc({ result: "blocked_budget" });
        console.log(`[worker] done id=${cmd.id} decision=BLOCKED reason=budget_insufficient left=${took.left}`);
        return true;
      }

      await writeDecisionEventAndProjection(p, decision, cost, riskIdx, took.left, null, wxSummary, { r1, r2 });
      await pool.query("update commands set status='DONE' where id=$1", [cmd.id]);
      jobs.inc({ result: "ok" });
      console.log(`[worker] done id=${cmd.id} decision=${decision} cost=${cost} left=${took.left}`);
      return true;
    }

    const b = await pool.query("select budget_left from risk_budget_daily where day=current_date");
    const left = b.rows.length ? Number(b.rows[0].budget_left) : 0;

    await writeDecisionEventAndProjection(p, decision, cost, riskIdx, left, null, wxSummary, { r1, r2 });
    await pool.query("update commands set status='DONE' where id=$1", [cmd.id]);
    jobs.inc({ result: "ok" });
    console.log(`[worker] done id=${cmd.id} decision=${decision} cost=${cost} left=${left}`);
    return true;

  } catch (e) {
    await pool.query("update commands set status='FAILED', error=$2 where id=$1", [cmd.id, String(e.message || e)]);
    jobs.inc({ result: "failed" });
    console.log(`[worker] failed id=${cmd.id} err=${String(e.message || e)}`);
    return true;
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("[worker] loop start");
  while (true) {
    try {
      const did = await processOne();
      if (!did) await sleep(700);
    } catch (e) {
      console.log(`[worker] loop_err ${String(e.message || e)}`);
      await sleep(1200);
    }
  }
}

main().catch(e => {
  console.error("[worker] fatal", e);
  process.exit(1);
});

export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ECA Verify — Dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #070b18;
    --bg-2: #0b1124;
    --surface: rgba(20, 27, 51, 0.72);
    --surface-solid: #131a33;
    --border: rgba(120, 140, 200, 0.18);
    --border-strong: rgba(120, 140, 200, 0.32);
    --text: #eef1fb;
    --muted: #9aa3c4;
    --accent: #6d8bff;
    --accent-2: #b06dff;
    --grad: linear-gradient(120deg, #6d8bff 0%, #b06dff 60%, #ff8fc7 100%);
    --ok: #38d39f;
    --bad: #ff6b81;
    --warn: #ffb454;
    --shadow: 0 18px 50px -22px rgba(7, 11, 24, 0.9);
    --radius: 16px;
    --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: var(--font);
    margin: 0;
    color: var(--text);
    background:
      radial-gradient(1100px 540px at 88% -10%, rgba(176, 109, 255, 0.16), transparent 60%),
      radial-gradient(900px 480px at 0% 0%, rgba(109, 139, 255, 0.18), transparent 55%),
      linear-gradient(180deg, var(--bg) 0%, var(--bg-2) 100%);
    background-attachment: fixed;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    letter-spacing: 0.1px;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 16px 24px;
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    background: rgba(9, 13, 28, 0.72);
    backdrop-filter: blur(14px) saturate(140%);
    -webkit-backdrop-filter: blur(14px) saturate(140%);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: center; gap: 12px; margin-right: auto; min-width: 0; }
  .brand .logo {
    width: 38px; height: 38px; flex: 0 0 auto;
    border-radius: 11px;
    background: var(--grad);
    display: grid; place-items: center;
    box-shadow: 0 8px 22px -8px rgba(109, 139, 255, 0.8);
  }
  .brand .logo svg { width: 21px; height: 21px; display: block; }
  .brand h1 { font-size: 16px; line-height: 1.15; margin: 0; font-weight: 650; letter-spacing: 0.2px; }
  .brand .sub {
    font-size: 11px; color: var(--muted); font-weight: 500;
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  label.field { display: flex; flex-direction: column; gap: 4px; }
  label.field span { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.07em; padding-left: 2px; }
  input {
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border-strong);
    background: rgba(7, 11, 24, 0.6);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }
  input::placeholder { color: #6b7398; }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(109, 139, 255, 0.22);
    background: rgba(7, 11, 24, 0.85);
  }
  input[type="date"] { color-scheme: dark; }
  button {
    padding: 10px 18px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: var(--grad);
    color: #fff;
    font: inherit;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    align-self: flex-end;
    box-shadow: 0 10px 26px -12px rgba(109, 139, 255, 0.9);
    transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
  }
  button:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 14px 30px -12px rgba(176, 109, 255, 0.9); }
  button:active { transform: translateY(0); }
  button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(176, 109, 255, 0.35); }
  main { padding: 28px 24px 56px; max-width: 1040px; margin: 0 auto; }
  .hero {
    margin: 4px 0 22px;
    padding: 18px 20px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: linear-gradient(135deg, rgba(109, 139, 255, 0.1), rgba(176, 109, 255, 0.06));
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .hero .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 4px rgba(56, 211, 159, 0.18); flex: 0 0 auto; }
  .hero p { margin: 0; font-size: 13px; color: var(--muted); }
  .hero strong { color: var(--text); font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 28px; }
  .card {
    position: relative;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 18px 16px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: transform .18s ease, border-color .18s ease;
    animation: rise .5s cubic-bezier(.2,.7,.3,1) both;
  }
  .card:hover { transform: translateY(-3px); border-color: var(--border-strong); }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
    background: var(--accent-line, var(--grad)); opacity: .9;
  }
  .card[data-k="aprovado"] { --accent-line: linear-gradient(90deg, #2bb88a, #38d39f); }
  .card[data-k="reprovado"] { --accent-line: linear-gradient(90deg, #ff5470, #ff8fa3); }
  .card[data-k="documento"] { --accent-line: linear-gradient(90deg, #ff9f1c, #ffc977); }
  .card .n { font-size: 30px; font-weight: 750; line-height: 1; letter-spacing: -0.5px; }
  .card .l { margin-top: 8px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 20px 20px 22px;
    margin-bottom: 22px;
  }
  .panel h3 {
    margin: 0 0 16px;
    font-size: 13px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    display: flex; align-items: center; gap: 8px;
  }
  .panel h3::before { content: ""; width: 14px; height: 14px; border-radius: 4px; background: var(--grad); flex: 0 0 auto; }
  #chart { display: block; }
  .panel.table { padding: 20px 8px 8px; }
  .panel.table h3 { padding: 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 11px 14px; font-size: 13px; }
  th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; border-bottom: 1px solid var(--border-strong); }
  tbody tr { transition: background .12s ease; }
  tbody tr:hover { background: rgba(120, 140, 200, 0.06); }
  td { border-bottom: 1px solid var(--border); }
  tbody tr:last-child td { border-bottom: none; }
  td.tx { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; color: #c7cdf0; }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    border: 1px solid transparent;
  }
  .pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.aprovado { color: var(--ok); background: rgba(56, 211, 159, 0.12); border-color: rgba(56, 211, 159, 0.3); }
  .pill.reprovado { color: var(--bad); background: rgba(255, 107, 129, 0.12); border-color: rgba(255, 107, 129, 0.3); }
  .pill.documento_requerido { color: var(--warn); background: rgba(255, 180, 84, 0.12); border-color: rgba(255, 180, 84, 0.3); }
  .err {
    color: #ffd1d8;
    background: rgba(255, 107, 129, 0.1);
    border: 1px solid rgba(255, 107, 129, 0.32);
    border-radius: 12px;
    margin: 0 0 18px;
    padding: 0 14px;
    font-size: 13px;
    max-height: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-height .25s ease, opacity .25s ease, padding .25s ease, margin .25s ease;
  }
  .err:not(:empty) { max-height: 120px; opacity: 1; padding: 12px 14px; }
  .muted { color: var(--muted); }
  td.muted { text-align: center; padding: 26px 14px; }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 560px) {
    header { padding: 14px 16px; }
    main { padding: 20px 16px 48px; }
    .controls { width: 100%; }
    label.field, input[type="date"] { flex: 1 1 40%; }
    #key { flex: 1 1 100%; }
    button { width: 100%; align-self: stretch; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
    body { background-attachment: scroll; }
  }
</style>
</head>
<body>
<header>
  <div class="brand">
    <span class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5l-8-3Z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </span>
    <div>
      <h1>ECA Verify</h1>
      <div class="sub">Console de Verificação</div>
    </div>
  </div>
  <div class="controls">
    <label class="field"><span>Email</span><input id="email" type="email" placeholder="email" autocomplete="username"/></label>
    <label class="field"><span>Senha</span><input id="pass" type="password" placeholder="senha" autocomplete="current-password"/></label>
    <button id="login">Entrar</button>
    <label class="field"><span>API Key</span><input id="key" type="password" placeholder="sk_..." size="24"/></label>
    <label class="field"><span>De</span><input id="from" type="date"/></label>
    <label class="field"><span>Até</span><input id="to" type="date"/></label>
    <button id="load">Carregar</button>
  </div>
</header>
<main>
  <div class="hero">
    <span class="dot" aria-hidden="true"></span>
    <p>Verificação de idade em conformidade com a <strong>Lei 15.211</strong> e a <strong>LGPD</strong> — imagens processadas efemeramente, nunca armazenadas.</p>
  </div>
  <p id="err" class="err"></p>
  <div class="cards" id="cards"></div>
  <div class="panel">
    <h3>Distribuição por status</h3>
    <svg id="chart" width="100%" height="140" role="img" aria-label="Distribuição por status"></svg>
  </div>
  <div class="panel table">
    <h3>Auditoria — últimos eventos</h3>
    <table><thead><tr><th>Transação</th><th>Status</th><th>IP (mascarado)</th><th>Data</th></tr></thead>
    <tbody id="rows"><tr><td colspan="4" class="muted">Informe a API Key e clique em Carregar.</td></tr></tbody></table>
  </div>
</main>
<script>
const COLORS = { aprovado: '#38d39f', reprovado: '#ff6b81', documento_requerido: '#ffb454' };
const LABELS = { aprovado: 'aprovado', reprovado: 'reprovado', documento_requerido: 'documento' };
let authToken = '';
function headers() {
  const bearer = authToken || document.getElementById('key').value.trim();
  return { Authorization: 'Bearer ' + bearer };
}
async function login() {
  const err = document.getElementById('err'); err.textContent = '';
  try {
    const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('pass').value }) });
    if (!res.ok) throw new Error('login ' + res.status);
    authToken = (await res.json()).token;
    await load();
  } catch (e) { err.textContent = 'Falha no login: ' + e.message; }
}
function qs(o) { return Object.entries(o).filter(([,v]) => v).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
async function load() {
  const err = document.getElementById('err'); err.textContent = '';
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  try {
    const sres = await fetch('/dashboard/stats?' + qs({ from, to }), { headers: headers() });
    if (!sres.ok) throw new Error('stats ' + sres.status);
    const stats = await sres.json();
    renderCards(stats); renderChart(stats.byStatus);
    const ares = await fetch('/dashboard/audit?' + qs({ limit: 50 }), { headers: headers() });
    if (!ares.ok) throw new Error('audit ' + ares.status);
    renderRows((await ares.json()).items);
  } catch (e) { err.textContent = 'Falha ao carregar: ' + e.message + ' (verifique a API Key).'; }
}
function renderCards(s) {
  const c = document.getElementById('cards');
  const card = (k, l, n) => '<div class="card" data-k="' + k + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
  c.innerHTML = card('total', 'Total', s.total) + card('aprovado', 'Aprovado', s.byStatus.aprovado||0)
    + card('reprovado', 'Reprovado', s.byStatus.reprovado||0) + card('documento', 'Documento', s.byStatus.documento_requerido||0);
}
function renderChart(by) {
  const entries = Object.entries(by); const max = Math.max(1, ...entries.map(([,v]) => v));
  const svg = document.getElementById('chart'); const slot = 100 / entries.length; const bw = Math.min(slot - 6, 22);
  const top = 8, base = 104;
  svg.innerHTML = entries.map(([k,v], i) => {
    const h = Math.round((v / max) * (base - top)); const cx = i * slot + slot / 2;
    const color = COLORS[k] || '#7c89b8';
    return '<rect x="' + (cx - bw/2) + '%" y="' + (base - h) + '" width="' + bw + '%" height="' + h
      + '" rx="6" fill="' + color + '" fill-opacity="0.92"></rect>'
      + '<text x="' + cx + '%" y="' + (base - h - 6) + '" fill="' + color + '" font-size="12" font-weight="700" text-anchor="middle">' + v + '</text>'
      + '<text x="' + cx + '%" y="124" fill="#9aa3c4" font-size="11" text-anchor="middle">' + (LABELS[k]||k) + '</text>';
  }).join('');
}
function renderRows(items) {
  const tb = document.getElementById('rows');
  if (!items || !items.length) { tb.innerHTML = '<tr><td colspan="4" class="muted">Sem eventos no período.</td></tr>'; return; }
  tb.innerHTML = items.map(r => '<tr><td class="tx">' + esc(r.id) + '</td><td><span class="pill ' + esc(r.status) + '">' + esc(r.status) + '</span></td><td>' + esc(r.masked_ip)
    + '</td><td class="muted">' + esc(new Date(r.created_at).toLocaleString('pt-BR')) + '</td></tr>').join('');
}
document.getElementById('load').addEventListener('click', load);
document.getElementById('login').addEventListener('click', login);
</script>
</body>
</html>`;

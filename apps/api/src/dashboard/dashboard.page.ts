export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ECA Verify — Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e6e9f0; }
  header { padding: 16px 24px; background: #131a33; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; margin-right: auto; }
  input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3357; background: #0f1530; color: inherit; }
  button { cursor: pointer; background: #3b5bdb; border-color: #3b5bdb; }
  main { padding: 24px; max-width: 1000px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #131a33; border: 1px solid #2a3357; border-radius: 12px; padding: 16px; }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { opacity: .7; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a3357; font-size: 14px; }
  .bar { height: 14px; border-radius: 6px; }
  .err { color: #ff8787; margin: 8px 0; }
  .muted { opacity: .6; }
</style>
</head>
<body>
<header>
  <h1>ECA Verify · Dashboard</h1>
  <input id="key" type="password" placeholder="API Key (sk_...)" size="28"/>
  <input id="from" type="date"/>
  <input id="to" type="date"/>
  <button id="load">Carregar</button>
</header>
<main>
  <p id="err" class="err"></p>
  <div class="cards" id="cards"></div>
  <h3>Distribuição</h3>
  <svg id="chart" width="100%" height="120" role="img" aria-label="Distribuição por status"></svg>
  <h3>Auditoria (últimos eventos)</h3>
  <table><thead><tr><th>Transação</th><th>Status</th><th>IP (mascarado)</th><th>Data</th></tr></thead>
  <tbody id="rows"><tr><td colspan="4" class="muted">Informe a API Key e clique em Carregar.</td></tr></tbody></table>
</main>
<script>
const COLORS = { aprovado: '#2f9e44', reprovado: '#e03131', documento_requerido: '#f08c00' };
function headers() { return { Authorization: 'Bearer ' + document.getElementById('key').value.trim() }; }
function qs(o) { return Object.entries(o).filter(([,v]) => v).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&'); }
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
  const card = (l, n) => '<div class="card"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
  c.innerHTML = card('Total', s.total) + card('Aprovado', s.byStatus.aprovado||0)
    + card('Reprovado', s.byStatus.reprovado||0) + card('Documento', s.byStatus.documento_requerido||0);
}
function renderChart(by) {
  const entries = Object.entries(by); const max = Math.max(1, ...entries.map(([,v]) => v));
  const svg = document.getElementById('chart'); const bw = 100 / entries.length;
  svg.innerHTML = entries.map(([k,v], i) => {
    const h = Math.round((v / max) * 90); const x = i * bw;
    return '<rect class="bar" x="' + (x+1) + '%" y="' + (100-h) + '" width="' + (bw-2) + '%" height="' + h
      + '" fill="' + (COLORS[k]||'#868e96') + '"></rect>'
      + '<text x="' + (x+bw/2) + '%" y="115" fill="#e6e9f0" font-size="11" text-anchor="middle">' + k + ' (' + v + ')</text>';
  }).join('');
}
function renderRows(items) {
  const tb = document.getElementById('rows');
  if (!items || !items.length) { tb.innerHTML = '<tr><td colspan="4" class="muted">Sem eventos no período.</td></tr>'; return; }
  tb.innerHTML = items.map(r => '<tr><td>' + r.id + '</td><td>' + r.status + '</td><td>' + r.masked_ip
    + '</td><td>' + new Date(r.created_at).toLocaleString('pt-BR') + '</td></tr>').join('');
}
document.getElementById('load').addEventListener('click', load);
</script>
</body>
</html>`;

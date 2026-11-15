import { sortBySeverity } from '../summary.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const LABELS = { ok: 'OK', redirect: 'Redirect', broken: 'Broken', error: 'Error' };

function detailsFor(r) {
  if (r.error) {
    return `<span class="err">${escapeHtml(r.error.label)}</span><div class="muted">${escapeHtml(r.error.message)}</div>`;
  }
  if (r.redirectCount > 0 || r.finalUrl !== r.url) {
    const hops = r.redirects
      .map((hop) => `<span class="hop">${hop.status}</span> ${escapeHtml(hop.url)}`)
      .join('<br>&darr; ');
    const note = r.permanentRedirect ? '<div class="muted">Permanent redirect: update this link to the final address.</div>' : '';
    return `<div class="chain">${hops}<br>&darr; <strong>${r.status}</strong> ${escapeHtml(r.finalUrl)}</div>${note}`;
  }
  return `<span class="muted">${escapeHtml(r.statusText ?? '')}</span>`;
}

/** A self-contained HTML page: no external files, works offline, prints well. */
export function renderHtml(report) {
  const s = report.summary;
  const maxTime = Math.max(1, ...report.results.map((r) => r.responseTime));
  const rows = sortBySeverity(report.results)
    .map((r) => {
      const width = Math.max(2, Math.round((r.responseTime / maxTime) * 100));
      const code = r.error ? 'ERR' : r.status;
      return `<tr data-cat="${r.category}" data-slow="${r.slow}" data-text="${escapeHtml(`${r.url} ${r.finalUrl}`.toLowerCase())}">
  <td><span class="badge ${r.category}">${escapeHtml(code)}</span><div class="cat">${LABELS[r.category]}</div></td>
  <td class="url"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a></td>
  <td>${detailsFor(r)}</td>
  <td class="time"><span class="${r.slow ? 'slowtext' : ''}">${r.responseTime} ms</span>${r.slow ? ' <span class="slowpill">SLOW</span>' : ''}<div class="bar"><div class="${r.slow ? 'fill slowfill' : 'fill'}" style="width:${width}%"></div></div></td>
</tr>`;
    })
    .join('\n');

  const card = (value, label, cls = '') =>
    `<div class="card ${cls}"><div class="num">${value}</div><div class="lbl">${label}</div></div>`;
  const when = new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
  const scoreClass = s.healthScore >= 95 ? 'good' : s.healthScore >= 80 ? 'warn' : 'bad';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dead Link Detective Report</title>
<style>
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;color:#1c2733;font-size:14px}
.wrap{max-width:1180px;margin:0 auto;padding:24px 20px 40px}
h1{margin:0 0 4px;font-size:26px}
.sub{color:#5b6b7a;margin:0 0 20px}
.cards{margin:0 0 18px;overflow:hidden}
.card{float:left;width:12.9%;min-width:110px;box-sizing:border-box;margin:0 1.25% 12px 0;padding:14px 12px;background:#fff;border:1px solid #dfe5ea;border-top:4px solid #8795a1;border-radius:6px}
.card .num{font-size:28px;font-weight:bold}
.card .lbl{color:#5b6b7a;font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.card.good{border-top-color:#1f9d55}.card.good .num{color:#1f9d55}
.card.warn{border-top-color:#d69e2e}.card.warn .num{color:#b7791f}
.card.bad{border-top-color:#d64545}.card.bad .num{color:#c53030}
.card.ok{border-top-color:#1f9d55}.card.redirect{border-top-color:#3182ce}.card.slow{border-top-color:#dd6b20}
.tools{margin:6px 0 12px}
.tools button{border:1px solid #c5ced6;background:#fff;color:#1c2733;padding:7px 14px;margin:0 6px 6px 0;border-radius:18px;cursor:pointer;font-size:13px}
.tools button.active{background:#1c2733;color:#fff;border-color:#1c2733}
.tools input{padding:7px 12px;border:1px solid #c5ced6;border-radius:18px;width:240px;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #dfe5ea}
th{background:#1c2733;color:#fff;text-align:left;padding:10px;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td{padding:10px;border-top:1px solid #e8edf1;vertical-align:top}
td.url{word-break:break-all;width:34%}
td.url a{color:#1a56a8;text-decoration:none}
td.time{width:150px;white-space:nowrap}
.badge{display:inline-block;min-width:42px;text-align:center;padding:3px 8px;border-radius:4px;color:#fff;font-weight:bold;font-size:13px}
.badge.ok{background:#1f9d55}.badge.redirect{background:#3182ce}.badge.broken{background:#d64545}.badge.error{background:#6b2fa0}
.cat{font-size:11px;color:#5b6b7a;margin-top:3px;text-align:center}
.muted{color:#5b6b7a;font-size:12px;margin-top:3px}
.err{color:#6b2fa0;font-weight:bold}
.chain{font-size:12px;word-break:break-all;line-height:1.6}
.hop{display:inline-block;background:#e2effa;color:#2b6cb0;border-radius:3px;padding:0 5px;font-weight:bold}
.bar{height:5px;background:#e8edf1;border-radius:3px;margin-top:6px;overflow:hidden}
.fill{height:5px;background:#3182ce}.slowfill{background:#dd6b20}
.slowtext{color:#c05621;font-weight:bold}
.slowpill{background:#feebc8;color:#9c4221;font-size:10px;font-weight:bold;padding:1px 6px;border-radius:8px}
.empty{display:none;padding:22px;text-align:center;color:#5b6b7a;background:#fff;border:1px solid #dfe5ea;border-top:0}
.foot{margin-top:18px;color:#5b6b7a;font-size:12px}
@media print{.tools{display:none}body{background:#fff}}
</style>
</head>
<body>
<div class="wrap">
<h1>Dead Link Detective</h1>
<p class="sub">Report generated ${escapeHtml(when)} &middot; ${s.total} links checked in ${(report.durationMs / 1000).toFixed(1)} s${report.interrupted ? ' &middot; <strong>interrupted (partial report)</strong>' : ''}</p>
<div class="cards">
${card(`${s.healthScore}%`, 'Link health', scoreClass)}
${card(s.total, 'Checked')}
${card(s.ok, 'OK', 'ok')}
${card(s.redirects, 'Redirects', 'redirect')}
${card(s.broken, 'Broken', s.broken ? 'bad' : 'good')}
${card(s.errors, 'Errors', s.errors ? 'bad' : 'good')}
${card(s.slow, `Slow &gt; ${report.options.slowThreshold} ms`, 'slow')}
</div>
<div class="tools">
<button type="button" class="active" data-filter="all">All (${s.total})</button>
<button type="button" data-filter="error">Errors (${s.errors})</button>
<button type="button" data-filter="broken">Broken (${s.broken})</button>
<button type="button" data-filter="redirect">Redirects (${s.redirects})</button>
<button type="button" data-filter="slow">Slow (${s.slow})</button>
<button type="button" data-filter="ok">OK (${s.ok})</button>
<input type="text" id="q" placeholder="Search URLs...">
</div>
<table id="results">
<thead><tr><th>Status</th><th>URL</th><th>Details</th><th>Response time</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
<div class="empty" id="empty">No links match this filter.</div>
<p class="foot">Average response ${s.avgResponseTime} ms &middot; 95th percentile ${s.p95ResponseTime} ms &middot; ${s.permanentRedirects} permanent redirect(s) &middot; ${escapeHtml(report.tool.name)} v${escapeHtml(report.tool.version)}</p>
</div>
<script>
(function () {
  var filter = 'all';
  var rows = document.querySelectorAll('#results tbody tr');
  var buttons = document.querySelectorAll('.tools button');
  var box = document.getElementById('q');
  function apply() {
    var text = box.value.toLowerCase();
    var shown = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var matchFilter = filter === 'all' || (filter === 'slow' ? row.getAttribute('data-slow') === 'true' : row.getAttribute('data-cat') === filter);
      var matchText = row.getAttribute('data-text').indexOf(text) !== -1;
      var visible = matchFilter && matchText;
      row.style.display = visible ? '' : 'none';
      if (visible) shown++;
    }
    document.getElementById('empty').style.display = shown ? 'none' : 'block';
  }
  for (var b = 0; b < buttons.length; b++) {
    buttons[b].onclick = function () {
      for (var k = 0; k < buttons.length; k++) buttons[k].className = '';
      this.className = 'active';
      filter = this.getAttribute('data-filter');
      apply();
    };
  }
  box.onkeyup = apply;
})();
</script>
</body>
</html>
`;
}

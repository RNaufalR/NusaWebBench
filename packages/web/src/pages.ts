/**
 * Aset dashboard statis. Skrip TIDAK memakai innerHTML: semua data dari API dimasukkan sebagai
 * textContent (taskbook T-140 instruksi 8). CSP melarang skrip inline (script-src 'self').
 */
export const INDEX_HTML = `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NusaWebBench — dashboard lokal</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="/app.css" />
    <script src="/app.js" defer></script>
  </head>
  <body>
    <a class="skip" href="#utama">Lewati ke konten utama</a>
    <header>
      <h1>NusaWebBench</h1>
      <p class="notice">Hanya untuk target yang Anda miliki atau memiliki izin tertulis untuk diuji. Mode fixture hanya loopback. Core berjalan tanpa API key.</p>
    </header>
    <p id="status" class="status" role="status" aria-live="polite"></p>
    <main id="utama">
      <section aria-labelledby="h-target">
        <h2 id="h-target">Target</h2>
        <form id="form-target" class="grid">
          <label>Nama <input name="label" required maxlength="100" autocomplete="off" /></label>
          <label>Origin <input name="origin" required maxlength="2048" placeholder="http://127.0.0.1:4200" autocomplete="off" /></label>
          <label>Mode
            <select name="mode">
              <option value="fixture">fixture (loopback)</option>
              <option value="url">url (remote, terbatas)</option>
            </select>
          </label>
          <button type="submit">Tambah target</button>
        </form>
        <table aria-label="Daftar target">
          <thead><tr><th scope="col">Nama</th><th scope="col">Origin</th><th scope="col">Mode</th></tr></thead>
          <tbody id="targets"></tbody>
        </table>
      </section>

      <section aria-labelledby="h-run">
        <h2 id="h-run">Jalankan audit</h2>
        <form id="form-run" class="grid">
          <label>Target
            <select id="run-target" name="targetId" required></select>
          </label>
          <fieldset>
            <legend>Modul</legend>
            <div id="run-modules"></div>
          </fieldset>
          <label class="check">
            <input type="checkbox" name="acknowledged" required />
            Saya memiliki izin untuk menguji target ini dan memahami cakupan run.
          </label>
          <div class="actions">
            <button type="button" id="btn-plan">Pratinjau rencana</button>
            <button type="submit">Jalankan</button>
          </div>
        </form>
        <div id="plan" class="plan" aria-live="polite"></div>
      </section>

      <section aria-labelledby="h-runs">
        <h2 id="h-runs">Run</h2>
        <table aria-label="Daftar run">
          <thead><tr><th scope="col">ID</th><th scope="col">Status</th><th scope="col">Origin</th><th scope="col">Dibuat</th><th scope="col">Aksi</th></tr></thead>
          <tbody id="runs"></tbody>
        </table>
        <div id="run-detail" aria-live="polite"></div>
      </section>

      <section aria-labelledby="h-ai">
        <h2 id="h-ai">AI (opsional, nonaktif secara default)</h2>
        <div id="ai-status"></div>
        <form id="form-ai" class="grid">
          <label class="check"><input type="checkbox" name="externalDataConsent" /> Saya setuju data tertentu dikirim ke provider AI eksternal.</label>
          <label>Tingkat redaksi
            <select name="redactionLevel">
              <option value="standard">standar</option>
              <option value="strict">ketat</option>
            </select>
          </label>
          <div class="actions">
            <button type="submit">Simpan pengaturan AI</button>
            <button type="button" id="btn-reset-counters">Reset penghitung lokal</button>
          </div>
        </form>
        <form id="form-ai-test" class="grid">
          <label class="check"><input type="checkbox" name="confirm" required /> Saya paham ini memakai kuota provider (satu request kecil).</label>
          <button type="submit">Uji koneksi</button>
        </form>
        <p id="ai-test-result" aria-live="polite"></p>
      </section>
    </main>
  </body>
</html>
`;

export const APP_CSS = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0 auto; max-width: 1080px; padding: 1rem; line-height: 1.5; }
header h1 { margin-bottom: 0.25rem; }
.notice { font-size: 0.95rem; border-left: 4px solid #b45309; padding-left: 0.75rem; }
.status { min-height: 1.5rem; font-weight: 600; }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 1rem; top: 1rem; background: #fff; padding: 0.25rem 0.5rem; }
section { border-top: 1px solid #8884; padding: 0.75rem 0; }
form.grid { display: grid; gap: 0.5rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); align-items: end; }
label { display: grid; gap: 0.25rem; font-size: 0.95rem; }
label.check { display: flex; gap: 0.5rem; align-items: center; }
input, select, button { font: inherit; padding: 0.4rem 0.5rem; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.35rem; border-bottom: 1px solid #8883; vertical-align: top; word-break: break-word; }
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.plan ul { margin: 0.25rem 0 0.5rem 1.25rem; }
.warn { color: #92400e; }
`;

export const APP_JS = `"use strict";
(function () {
  var STATUS_TEXT = {
    QUEUED: "Menunggu", RUNNING: "Berjalan", CANCELLING: "Membatalkan", CANCELLED: "Dibatalkan",
    COMPLETED: "Selesai", PARTIAL: "Selesai sebagian", FAILED: "Gagal",
    PASS: "Lulus", FAIL: "Gagal (ada temuan objektif)", WARN: "Peringatan (saran)",
    SKIPPED: "Dilewati", UNAVAILABLE: "Tidak tersedia", ERROR: "Error", NOT_RUN: "Tidak dijalankan"
  };
  var TERMINAL = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
  var activeRunId = null;
  var pollTimer = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, text, attrs) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function label(s) { return STATUS_TEXT[s] || s || "-"; }
  function say(msg) { $("status").textContent = msg; }

  function api(method, path, body, headers) {
    var opts = { method: method, headers: Object.assign({}, headers || {}), credentials: "same-origin" };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.message || ("Permintaan gagal (" + res.status + ")."));
          err.code = data.error || "HTTP_" + res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function fail(err) { say("Gagal: " + (err && err.message ? err.message : "kesalahan tidak diketahui")); }

  function loadTargets() {
    return api("GET", "/api/targets").then(function (data) {
      var body = $("targets"); body.textContent = "";
      var select = $("run-target"); select.textContent = "";
      data.items.forEach(function (t) {
        var tr = el("tr");
        tr.appendChild(el("td", t.label));
        tr.appendChild(el("td", t.origin));
        tr.appendChild(el("td", t.mode));
        body.appendChild(tr);
        select.appendChild(el("option", t.label + " (" + t.origin + ")", { value: t.id }));
      });
      if (data.items.length === 0) {
        var empty = el("tr"); var td = el("td", "Belum ada target.", { colspan: "3" });
        empty.appendChild(td); body.appendChild(empty);
      }
    });
  }

  function loadModules() {
    return api("GET", "/api/modules").then(function (data) {
      var box = $("run-modules"); box.textContent = "";
      data.modules.forEach(function (m) {
        var lab = el("label", null, { "class": "check" });
        var input = el("input", null, { type: "checkbox", name: "modules", value: m.name });
        if (m.name === "UX_RULES" || m.name === "FUNCTIONAL_QA") input.checked = true;
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(" " + m.label));
        box.appendChild(lab);
      });
    });
  }

  function selectedModules() {
    return Array.prototype.slice.call(document.querySelectorAll("input[name=modules]:checked")).map(function (i) { return i.value; });
  }

  function loadRuns() {
    return api("GET", "/api/runs?limit=30").then(function (data) {
      var body = $("runs"); body.textContent = "";
      data.items.forEach(function (r) {
        var tr = el("tr");
        tr.appendChild(el("td", r.id.slice(0, 12) + "…"));
        tr.appendChild(el("td", label(r.status)));
        tr.appendChild(el("td", r.targetOrigin));
        tr.appendChild(el("td", new Date(r.createdAt).toLocaleString("id-ID")));
        var td = el("td");
        var btn = el("button", "Lihat", { type: "button" });
        btn.addEventListener("click", function () { openRun(r.id); });
        td.appendChild(btn); tr.appendChild(td);
        body.appendChild(tr);
      });
      if (data.items.length === 0) {
        var tr2 = el("tr"); tr2.appendChild(el("td", "Belum ada run.", { colspan: "5" })); body.appendChild(tr2);
      }
    });
  }

  function openRun(id) {
    activeRunId = id;
    if (pollTimer) clearTimeout(pollTimer);
    renderRun();
  }

  function renderRun() {
    if (!activeRunId) return;
    Promise.all([
      api("GET", "/api/runs/" + encodeURIComponent(activeRunId)),
      api("GET", "/api/runs/" + encodeURIComponent(activeRunId) + "/findings?limit=100"),
      api("GET", "/api/runs/" + encodeURIComponent(activeRunId) + "/artifacts")
    ]).then(function (parts) {
      var run = parts[0], findings = parts[1], artifacts = parts[2];
      var box = $("run-detail"); box.textContent = "";
      box.appendChild(el("h3", "Run " + run.id));
      box.appendChild(el("p", "Status: " + label(run.status) + ". " + (run.errorSummary ? "Ringkasan error: " + run.errorSummary : "")));
      box.appendChild(el("p", "Cakupan: " + (run.authorizationSummary || "-")));

      var mt = el("table", null, { "aria-label": "Status modul" });
      mt.appendChild(headRow(["Modul", "Status", "Alasan", "Alat"]));
      var mb = el("tbody");
      run.modules.forEach(function (m) {
        var tr = el("tr");
        tr.appendChild(el("td", m.module));
        tr.appendChild(el("td", label(m.status)));
        tr.appendChild(el("td", m.errorMessageSafe || m.skippedReason || "-"));
        tr.appendChild(el("td", m.toolName ? m.toolName + " " + (m.toolVersion || "") : "-"));
        mb.appendChild(tr);
      });
      mt.appendChild(mb); box.appendChild(mt);

      box.appendChild(el("h4", "Temuan (" + findings.total + ")"));
      var ft = el("table", null, { "aria-label": "Temuan" });
      ft.appendChild(headRow(["Judul", "Keparahan", "Verifikasi", "Aturan", "Selector", "Deskripsi"]));
      var fb = el("tbody");
      findings.items.forEach(function (f) {
        var tr = el("tr");
        tr.appendChild(el("td", f.title));
        tr.appendChild(el("td", f.severity));
        tr.appendChild(el("td", f.verification + (f.status === "SUPPRESSED" ? " (ditekan)" : "")));
        tr.appendChild(el("td", (f.ruleId || "-") + (f.ruleVersion ? " v" + f.ruleVersion : "")));
        tr.appendChild(el("td", f.selector || "-"));
        tr.appendChild(el("td", f.description));
        fb.appendChild(tr);
      });
      if (findings.items.length === 0) fb.appendChild(el("tr", null)).appendChild(el("td", "Tidak ada temuan.", { colspan: "6" }));
      ft.appendChild(fb); box.appendChild(ft);

      box.appendChild(el("h4", "Artefak (" + artifacts.items.length + ")"));
      var ul = el("ul");
      artifacts.items.forEach(function (a) {
        var li = el("li");
        var link = el("a", a.kind + " — " + a.mimeType + " (" + a.sizeBytes + " byte)", { href: "/api/artifacts/" + encodeURIComponent(a.id) });
        li.appendChild(link); ul.appendChild(li);
      });
      box.appendChild(ul);

      var actions = el("div", null, { "class": "actions" });
      if (TERMINAL.indexOf(run.status) === -1) {
        var cancel = el("button", "Batalkan run", { type: "button" });
        cancel.addEventListener("click", function () {
          api("POST", "/api/runs/" + encodeURIComponent(run.id) + "/cancel", {}).then(function () { say("Permintaan pembatalan dikirim."); renderRun(); }).catch(fail);
        });
        actions.appendChild(cancel);
      } else {
        var rep = el("button", "Buat laporan", { type: "button" });
        rep.addEventListener("click", function () {
          api("POST", "/api/runs/" + encodeURIComponent(run.id) + "/report", {}).then(function (r) { say("Laporan dibuat. Unduh dari daftar artefak."); return renderRun(); }).catch(fail);
        });
        actions.appendChild(rep);
      }
      box.appendChild(actions);

      if (TERMINAL.indexOf(run.status) === -1) {
        pollTimer = setTimeout(function () { renderRun(); loadRuns(); }, 2000);
      }
    }).catch(fail);
  }

  function headRow(labels) {
    var tr = el("tr");
    labels.forEach(function (t) { var th = el("th", t); th.setAttribute("scope", "col"); tr.appendChild(th); });
    var thead = el("thead"); thead.appendChild(tr); return thead;
  }

  function loadAi() {
    return api("GET", "/api/settings").then(function (s) {
      var box = $("ai-status"); box.textContent = "";
      box.appendChild(el("p", "Provider operator: " + s.operator.provider + " · FREE_TIER_LOCK: " + (s.operator.freeTierLock ? "aktif" : "nonaktif") + " · Fallback: " + (s.operator.fallbackEnabled ? "aktif" : "nonaktif")));
      box.appendChild(el("p", "Persetujuan data eksternal: " + (s.consent.externalDataConsent ? "diberikan" : "belum") + (s.consent.consentAt ? " (" + s.consent.consentAt + ")" : "")));
      var ul = el("ul");
      s.providers.forEach(function (p) {
        ul.appendChild(el("li", p.provider + ": kunci " + (p.keyConfigured ? "terpasang" : "tidak terpasang") + ", model " + (p.model || "(kosong)") + ", allowlist " + (p.allowlisted ? "ya" : "tidak") + ", hari ini " + p.localRequestsToday + "/" + p.localDailyCap + (p.stale ? " — verifikasi model usang" : ""))); 
      });
      box.appendChild(ul);
      s.notices.forEach(function (n) { box.appendChild(el("p", n, { "class": "warn" })); });
      var form = $("form-ai");
      form.elements["externalDataConsent"].checked = s.consent.externalDataConsent;
      form.elements["redactionLevel"].value = s.consent.redactionLevel;
    });
  }

  $("form-target").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    api("POST", "/api/targets", { label: f.elements["label"].value, origin: f.elements["origin"].value, mode: f.elements["mode"].value })
      .then(function () { f.reset(); say("Target ditambahkan."); return loadTargets(); }).catch(fail);
  });

  $("btn-plan").addEventListener("click", function () {
    api("POST", "/api/plan", { targetId: $("run-target").value, modules: selectedModules() }).then(function (p) {
      var box = $("plan"); box.textContent = "";
      box.appendChild(el("p", p.allowed ? "Rencana dapat dijalankan." : (p.blockedReason || "Rencana diblokir.")));
      var ul = el("ul"); p.effects.forEach(function (e) { ul.appendChild(el("li", e)); });
      box.appendChild(ul);
      if (p.note) box.appendChild(el("p", p.note, { "class": "warn" }));
    }).catch(fail);
  });

  $("form-run").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, "") : String(Date.now()) + String(Math.random()).slice(2);
    api("POST", "/api/runs", { targetId: $("run-target").value, modules: selectedModules(), acknowledged: f.elements["acknowledged"].checked === true }, { "Idempotency-Key": key })
      .then(function (run) { say("Run dibuat: " + run.id + " (" + label(run.status) + ")."); f.elements["acknowledged"].checked = false; openRun(run.id); return loadRuns(); })
      .catch(fail);
  });

  $("form-ai").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    api("PUT", "/api/settings", { externalDataConsent: f.elements["externalDataConsent"].checked, redactionLevel: f.elements["redactionLevel"].value })
      .then(function () { say("Pengaturan AI disimpan."); return loadAi(); }).catch(fail);
  });

  $("btn-reset-counters").addEventListener("click", function () {
    api("POST", "/api/settings/reset-counters", {}).then(function () { say("Penghitung lokal direset. Kuota provider tidak ikut direset."); return loadAi(); }).catch(fail);
  });

  $("form-ai-test").addEventListener("submit", function (ev) {
    ev.preventDefault();
    api("POST", "/api/providers/test", { confirm: true }).then(function (o) {
      $("ai-test-result").textContent = o.status === "OK" ? "Koneksi berhasil." : "Tidak tersedia: " + (o.reason || "-") + (o.errorKind ? " (" + o.errorKind + ")" : "");
    }).catch(fail);
  });

  Promise.all([loadTargets(), loadModules(), loadRuns(), loadAi()]).then(function () { say("Siap."); }).catch(fail);
})();
`;

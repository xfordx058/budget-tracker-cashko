import * as db from './db.js';

const CATS = {
  exp:[["FD","Food"],["TR","Transport"],["BK","Books"],["FN","Fun"],["SH","Shopping"],["PH","Phone"],["RT","Rent"],["HL","Health"],["OT","Other"]],
  inc:[["AL","Allowance"],["PT","Part-time"],["GF","Gift"],["SC","Scholarship"],["OT","Other"]]
};
const PALETTE = ["#FFD02F","#FF90E8","#B9FF66","#7DD8FF","#FF6B35","#C9B8FF","#8CE8C3","#FFC7A8","#F4F1EA"];
const LS = "coinflow_v1";

let state = {tx:[], budget:3000, name:"Student", appName:"COINFLOW"};
let type = "exp", filter = "all";

const $ = id => document.getElementById(id);
const fmt = n => (n < 0 ? "−" : "") + "₱" + Math.abs(n).toFixed(2);
const esc = s => { const d = document.createElement("div"); d.textContent = String(s||""); return d.innerHTML; };
const monthKey = d => d.slice(0,7);
const pdfFmt = n => (n < 0 ? "- " : "") + "PHP " + Math.abs(n).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2});

/* ---------- toast ---------- */
let toastTimer;
function toast(msg){
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

/* ---------- generic modal ---------- */
function openModal({title, msg, okText="Confirm", danger=false, fields=[]}){
  return new Promise(resolve => {
    $("mTitle").textContent = title;
    $("mMsg").textContent = msg || "";
    $("mOk").textContent = okText;
    $("mOk").className = danger ? "m-danger" : "m-ok";
    $("mFields").innerHTML = fields.map(f =>
      `<label>${esc(f.label||"")}</label><input id="mf_${esc(f.id||"")}" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder ?? "")}">`).join("");
    $("overlay").classList.add("show");
    const first = $("mFields").querySelector("input");
    if (first) { first.focus(); first.select(); }
    const done = val => { $("overlay").classList.remove("show"); resolve(val); };
    $("mOk").onclick = () => {
      const vals = {};
      fields.forEach(f => vals[f.id] = $("mf_" + f.id).value.trim());
      done(fields.length ? vals : true);
    };
    $("mCancel").onclick = () => done(null);
    $("overlay").onclick = e => { if (e.target === $("overlay")) done(null); };
  });
}

async function save(){
  await db.setSetting('budget', state.budget);
  await db.setSetting('name', state.name);
  await db.setSetting('appName', state.appName);
  await render();
}

async function migrateIfNeeded(){
  try {
    const txCount = (await db.getAllTransactions()).length;
    const settings = await db.getSettings();
    if ((txCount > 0) || settings.budget !== undefined || settings.name) return;
    const old = localStorage.getItem(LS);
    if (old) {
      const parsed = JSON.parse(old);
      await db.bulkImport(parsed.data || parsed);
      toast('Data migrated to local storage');
    }
  } catch(e) {
    // ignore
  }
}

async function render(){
  // identity
  $("logo").textContent = state.appName || "CashKo";
  document.title = (state.appName || "CashKo") + " — Student Budget Tracker";
  $("greet").innerHTML = 'Hello, <b>' + esc(state.name || "Student") + '</b>';

  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const mtx = state.tx.filter(t => monthKey(t.date) === mk);
  const inc = mtx.filter(t => t.type === "inc").reduce((s,t) => s + Number(t.amt||0), 0);
  const exp = mtx.filter(t => t.type === "exp").reduce((s,t) => s + Number(t.amt||0), 0);
  const remaining = Number(state.budget||0) - exp;

  const bal = $("balance");
  bal.textContent = fmt(remaining);
  if (remaining < 0) bal.classList.add('negative'); else bal.classList.remove('negative');
  
  $("income").textContent  = "+" + fmt(inc).replace("−","");
  $("expense").textContent = "−" + fmt(exp).replace("−","");
  $("btxt").textContent = fmt(exp) + " / " + fmt(state.budget);
  const pct = Math.min((Number(state.budget)||0) === 0 ? 0 : exp / Number(state.budget) * 100, 100);
  $("bfill").style.width = pct + "%";
  $("bfill").className = exp > Number(state.budget||0) ? "warn" : "";

  const days = [...Array(7)].map((_,i) => { const d = new Date(now); d.setDate(d.getDate()-6+i); return d; });
  const vals = days.map(d => {
    const key = d.toISOString().slice(0,10);
    return state.tx.filter(t => t.date === key).reduce((s,t) => s + (t.type === "inc" ? Number(t.amt||0) : -Number(t.amt||0)), 0);
  });
  drawChart(vals);

  const list = state.tx
    .filter(t => filter === "all" || t.type === filter)
    .sort((a,b) => b.date.localeCompare(a.date) || (b.id||0)-(a.id||0));
  $("list").innerHTML = list.length ? list.map(t => {
    const catCodes = CATS[t.type] || [];
    const idx = catCodes.findIndex(c => c[0] === t.ico);
    const bg = idx >= 0 ? PALETTE[idx] : PALETTE[7];
    return `
      <li data-t="${t.type}">
        <div class="ico" style="background:${bg}">${esc(t.ico)}</div>
        <div class="meta"><b>${esc(t.desc)}</b><small>${esc(t.cat)} · ${esc(t.date)}</small></div>
        <div class="amt ${t.type === "inc" ? "pos" : "neg"}">${t.type === "inc" ? "+" : "−"}₱${Number(t.amt||0).toFixed(2)}</div>
        <button class="del" data-id="${t.id}" aria-label="Delete">✕</button>
      </li>`;
  }).join("")
    : '<div class="empty">No transactions yet — add your first one above</div>';
}

function drawChart(vals){
  const c = $("chart"), x = c.getContext("2d");
  const W = c.width = c.offsetWidth * 2, H = c.height = 220;
  x.clearRect(0,0,W,H);
  const max = Math.max(...vals.map(Math.abs), 1);
  const gap = W / 7, bw = gap * 0.52, base = H - 44;
  const names = ["S","M","T","W","T","F","S"];
  vals.forEach((v,i) => {
    const h = Math.abs(v) / max * (H - 80), cx = gap * i + gap / 2;
    x.fillStyle = v >= 0 ? "#B9FF66" : "#FF90E8";
    x.strokeStyle = "#0F0F0F"; x.lineWidth = 4;
    const y = v >= 0 ? base - h : base;
    x.fillRect(cx - bw/2, y, bw, h || 3);
    x.strokeRect(cx - bw/2, y, bw, h || 3);
    x.fillStyle = "rgba(15,15,15,.55)";
    x.font = "20px 'Space Mono', monospace"; x.textAlign = "center";
    x.fillText(names[i], cx, H - 14);
  });
  x.strokeStyle = "#0F0F0F"; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, base); x.lineTo(W, base); x.stroke();
}

function setType(t){
  type = t;
  $("tabExp").className = t === "exp" ? "on exp" : "";
  $("tabInc").className = t === "inc" ? "on inc" : "";
  $("cat").innerHTML = (CATS[t]||[]).map(([code,name]) =>
    `<option value="${esc(code)} ${esc(name)}">${esc(code)} — ${esc(name)}</option>`).join("");
}

async function init(){
  // PWA
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch(e) {
      // ignore
    }
  }
  
  await migrateIfNeeded();
  const all = await db.getAllData();
  state = { tx: all.tx || [], budget: Number(all.budget)||3000, name: all.name||'Student', appName: (all.appName||'CashKo').toUpperCase() };
  
  $("tabExp").onclick = () => setType("exp");
  $("tabInc").onclick = () => setType("inc");
  setType("exp");
  $("date").value = new Date().toISOString().slice(0,10);
  
  $("form").onsubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat($("amt").value);
    if (!amt || amt <= 0) return;
    const [ico, catName] = $("cat").value.split(" ");
    const tx = {
      id: Date.now(),
      desc: $("desc").value.trim(),
      amt: +amt.toFixed(2),
      type,
      cat: catName,
      ico,
      date: $("date").value
    };
    await db.addTransaction(tx);
    state.tx.push(tx);
    $("desc").value = ""; $("amt").value = "";
    await render();
    toast("Transaction added");
    const b = $("balance");
    b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse");
  };
  
  $("list").onclick = async (e) => {
    const btn = e.target.closest(".del");
    if (!btn) return;
    const t = state.tx.find(x => x.id == btn.dataset.id);
    if (!t) return;
    const ok = await openModal({
      title: "Delete transaction?",
      msg: `"${t.desc}" — ${fmt(t.amt)} will be permanently removed.`,
      okText: "Delete", danger: true
    });
    if (!ok) return;
    await db.deleteTransaction(t.id);
    state.tx = state.tx.filter(x => x.id != t.id);
    await render();
    toast("Transaction deleted");
  };
  
  document.querySelectorAll(".filters button").forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll(".filters button").forEach(x => x.classList.toggle("on", x === b));
    render();
  });
  
  $("budgetCard").onclick = async () => {
    const vals = await openModal({
      title: "Monthly budget",
      msg: "Set your spending limit for this month.",
      okText: "Save",
      fields: [{id:"budget", label:"Budget (₱)", value: state.budget}]
    });
    if (!vals) return;
    const nb = +vals.budget;
    if (nb > 0) { 
      state.budget = nb; 
      await save(); 
      toast("Budget updated"); 
    } else toast("Invalid amount");
  };
  
  $("btnSettings").onclick = async () => {
    const vals = await openModal({
      title: "Settings",
      msg: "Personalize your tracker.",
      okText: "Save",
      fields: [
        {id:"name", label:"Your name", value: state.name, placeholder:"e.g. Juan"},
        {id:"appName", label:"App name", value: state.appName, placeholder:"e.g. CashKo"}
      ]
    });
    if (!vals) return;
    state.name = vals.name || "Student";
    state.appName = (vals.appName || "CashKo").toUpperCase();
    await save();
    toast("Settings saved");
  };
  
  $("btnPdf").onclick = async () => {
    if (!state.tx.length) { toast("Nothing to export"); return; }
    const stamp = new Date().toISOString().slice(0,10);
    const vals = await openModal({
      title: "Export PDF backup",
      msg: "Download a printable summary of all your transactions.",
      okText: "Download",
      fields: [{id:"fname", label:"File name", value: `${(state.appName||"cashko").toLowerCase()}-backup-${stamp}.pdf`}]
    });
    if (!vals) return;
    let fname = vals.fname || `backup-${stamp}.pdf`;
    if (!fname.toLowerCase().endsWith(".pdf")) fname += ".pdf";
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const inc = state.tx.filter(t=>t.type==="inc").reduce((s,t)=>s+Number(t.amt||0),0);
    const exp = state.tx.filter(t=>t.type==="exp").reduce((s,t)=>s+Number(t.amt||0),0);
    doc.setFont("helvetica","bold"); doc.setFontSize(20);
    doc.text(state.appName || "CashKo", 14, 18);
    doc.setFont("courier","normal"); doc.setFontSize(10);
    doc.text(`Budget Backup  |  Generated: ${new Date().toLocaleString()}  |  Owner: ${state.name || "Student"}`, 14, 25);
    doc.setDrawColor(15); doc.setLineWidth(0.8); doc.line(14, 29, 196, 29);
    doc.autoTable({
      startY: 34,
      head: [["Summary","Amount"]],
      body: [
        ["Total Income", pdfFmt(inc)],
        ["Total Expenses", pdfFmt(exp)],
        ["Remaining Budget", pdfFmt(Number(state.budget||0)-exp)],
        ["Monthly Budget", pdfFmt(state.budget)]
      ],
      theme: "grid",
      headStyles: { fillColor: [15,15,15], textColor: [244,241,234], fontStyle: "bold" },
      styles: { font: "courier", fontSize: 9, cellPadding: 2.5 }
    });
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8,
      head: [["Date","Description","Category","Type","Amount"]],
      body: [...state.tx]
        .sort((a,b) => a.date.localeCompare(b.date))
        .map(t => [t.date, t.desc, t.cat, t.type === "inc" ? "INCOME" : "EXPENSE",
          (t.type === "inc" ? "+" : "-") + " " + pdfFmt(t.amt)]),
      theme: "grid",
      headStyles: { fillColor: [15,15,15], textColor: [244,241,234], fontStyle: "bold" },
      styles: { font: "courier", fontSize: 8.5, cellPadding: 2 },
      alternateRowStyles: { fillColor: [244,241,234] }
    });
    doc.save(fname);
    toast("PDF downloaded");
  };
  
  $("btnJson").onclick = async () => {
    if (!state.tx.length) { toast("Nothing to backup"); return; }
    const stamp = new Date().toISOString().slice(0,10);
    const vals = await openModal({
      title: "Backup file",
      msg: "Download a restore file. Keep it safe - this is your database.",
      okText: "Download",
      fields: [{id:"fname", label:"File name", value: `${(state.appName||"cashko").toLowerCase()}-data-${stamp}.json`}]
    });
    if (!vals) return;
    let fname = vals.fname || `backup-${stamp}.json`;
    if (!fname.toLowerCase().endsWith(".json")) fname += ".json";
    const data = await db.getAllData();
    const blob = new Blob([JSON.stringify({app: state.appName || "CashKo", version: 1, exported: new Date().toISOString(), data}, null, 2)],
      {type: "application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Backup downloaded");
  };
  
  $("btnImport").onclick = () => $("fileInput").click();
  $("fileInput").onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.tx)) throw new Error("bad file");
        const ok = await openModal({
          title: "Restore backup?",
          msg: `This file contains ${data.tx.length} transaction(s)` +
               (data.name ? ` owned by "${data.name}"` : "") +
               `. Restoring will REPLACE all current data. This cannot be undone.`,
          okText: "Restore", danger: true
        });
        if (!ok) return;
        await db.bulkImport(data);
        const all = await db.getAllData();
        state = { tx: all.tx || [], budget: Number(all.budget)||3000, name: all.name||'Student', appName: (all.appName||'CashKo').toUpperCase() };
        await render();
        toast(`Restored ${state.tx.length} transactions`);
      } catch {
        await openModal({ title: "Restore failed", msg: "That file doesn't look like a valid backup (.json).", okText: "OK" });
      } finally {
        $("fileInput").value = "";
      }
    };
    reader.readAsText(file);
  };
  
  $("btnClear").onclick = async () => {
    const ok = await openModal({
      title: "Clear all data?",
      msg: `All ${state.tx.length} transaction(s) will be permanently deleted. Export a backup first if you need one.`,
      okText: "Clear All", danger: true
    });
    if (!ok) return;
    await db.clearAllTransactions();
    state.tx = [];
    await render();
    toast("All data cleared");
  };
  
  $("month").textContent = new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"});
  await render();
  
  // subtle bg animation
  let angle = 0;
  setInterval(() => {
    angle = (angle + 0.15) % 360;
    document.body.style.backgroundPosition = angle + 'px ' + (angle*0.5) + 'px';
  }, 60);
}

window.addEventListener('DOMContentLoaded', init);

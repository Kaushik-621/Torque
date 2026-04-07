/* ═══════════════════════════════════════════
   CAN Data Visualiser — Application
   ═══════════════════════════════════════════ */
(function(){
'use strict';

/* ─── STATE ─── */
const S = {
  source: 'dbc',          // active source tab
  dbcData: null,           // parsed DBC
  canRows: [],             // parsed CAN log rows
  decoded: {},             // { signalName: { data:[{t,v}], unit:'' } }
  selected: [],            // [{key, name, unit, color}]
  charts: [],
  markers: [],
  viewMode: 'combined',
  chartH: 340,
  tMin: 0, tMax: 0,
  colorIdx: 0
};

const COLORS = [
  '#00D4FF','#7B61FF','#FF6B9D','#00E89D','#FFB84D',
  '#FF5252','#36D7B7','#A78BFA','#F472B6','#34D399',
  '#FBBF24','#60A5FA','#F87171','#818CF8','#6EE7B7',
  '#FCD34D','#93C5FD','#FCA5A5','#C4B5FD','#A7F3D0'
];
function nextColor(){ return COLORS[S.colorIdx++ % COLORS.length]; }

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ─── THEME ─── */
$('#themeToggle').addEventListener('click', () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  // Update existing charts
  S.charts.forEach(c => {
    c.options.scales.x.grid.color = getComputedStyle(document.body).getPropertyValue('--chart-grid').trim();
    c.options.scales.y.grid.color = getComputedStyle(document.body).getPropertyValue('--chart-grid').trim();
    c.update();
  });
});

/* ─── TOAST ─── */
let toastT;
function notify(msg, type='info') {
  const icons = {success:'✓',error:'✕',info:'ℹ'};
  $('#toastIcon').textContent = icons[type]||'ℹ';
  $('#toastMsg').textContent = msg;
  const t = $('#toast');
  t.className = `toast toast--${type} show`;
  clearTimeout(toastT);
  toastT = setTimeout(()=>t.classList.remove('show'), 3500);
}

/* ─── SOURCE TAB SWITCHING ─── */
$$('.source-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.source-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    S.source = tab.dataset.source;
    $$('.source-panel').forEach(p=>p.classList.remove('active'));
    $(`#panel-${S.source}`).classList.add('active');
    // Reset signal display
    clearSignals();
  });
});

function clearSignals() {
  S.decoded = {};
  S.selected = [];
  S.colorIdx = 0;
  $('#signalListWrap').innerHTML = '';
  $('#selectedTags').innerHTML = '';
  $('#signalSection').classList.remove('visible');
  $('#plotSection').classList.remove('visible');
  $('#fileStatus').classList.remove('active');
  $('#fileStatus').querySelector('.status-pill__text').textContent = 'No Data';
  destroyCharts();
  $('#chartsArea').innerHTML = '';
  $('#toolbar').classList.remove('visible');
  $('#markersPanel').classList.remove('visible');
  $('#welcomeState').classList.remove('hidden');
  S.markers = [];
  $('#markersList').innerHTML = '';
}

/* ─── CLEAR / REMOVE FILE BUTTONS ─── */
$$('.upload-zone__clear').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation(); // don't trigger file input
    e.preventDefault();
    const target = btn.dataset.clear;

    if (target === 'dbc') {
      S.dbcData = null;
      $('#dbcFileInput').value = '';
      $('#dbcFileName').textContent = '';
      $('#dbcUploadZone').classList.remove('loaded');
      $('#dbcStats').classList.remove('visible');
      $('#dbcProgress').classList.remove('active');
      clearSignals();
      notify('DBC file removed', 'info');
    }
    else if (target === 'can') {
      S.canRows = [];
      $('#canFileInput').value = '';
      $('#canFileName').textContent = '';
      $('#canUploadZone').classList.remove('loaded');
      $('#dbcStats').classList.remove('visible');
      $('#dbcProgress').classList.remove('active');
      clearSignals();
      notify('Log file removed', 'info');
    }
    else if (target === 'turntide') {
      $('#ttFileInput').value = '';
      $('#ttFileName').textContent = '';
      $('#ttUploadZone').classList.remove('loaded');
      clearSignals();
      notify('Turntide file removed', 'info');
    }
    else if (target === 'curtis') {
      $('#curtisFileInput').value = '';
      $('#curtisFileName').textContent = '';
      $('#curtisUploadZone').classList.remove('loaded');
      clearSignals();
      notify('Curtis file removed', 'info');
    }
    else if (target === 'ar') {
      $('#arFileInput').value = '';
      $('#arFileName').textContent = '';
      $('#arUploadZone').classList.remove('loaded');
      clearSignals();
      notify('File removed', 'info');
    }
  });
});

/* ─── FILE HANDLERS ─── */

// DBC
$('#dbcFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  $('#dbcFileName').textContent = f.name;
  $('#dbcUploadZone').classList.add('loaded');
  const r = new FileReader();
  r.onload = ev => {
    try {
      S.dbcData = Parsers.parseDBC(ev.target.result);
      const mc = Object.keys(S.dbcData).length;
      let sc = 0; Object.values(S.dbcData).forEach(m=>sc+=m.signals.length);
      notify(`DBC loaded: ${mc} messages, ${sc} signals`,'success');
      if (S.canRows.length) processDBC();
    } catch(err){ notify('DBC parse error: '+err.message,'error'); }
  };
  r.readAsText(f);
});

// CAN Log (CSV or TRC)
$('#canFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  $('#canFileName').textContent = f.name;
  $('#canUploadZone').classList.add('loaded');
  const r = new FileReader();
  r.onload = ev => {
    try {
      S.canRows = Parsers.parseCANLog(ev.target.result, f.name);
      notify(`Log loaded: ${S.canRows.length.toLocaleString()} rows`,'success');
      if (S.dbcData) processDBC();
    } catch(err){ notify('Log parse error: '+err.message,'error'); }
  };
  r.readAsText(f);
});

function processDBC() {
  const prog = $('#dbcProgress'); prog.classList.add('active');
  $('#dbcProgressFill').style.width = '40%'; $('#dbcProgressText').textContent = 'Decoding...';
  setTimeout(()=>{
    const res = Parsers.decodeAllCAN(S.dbcData, S.canRows);
    S.decoded = res.decoded; S.tMin = res.tMin; S.tMax = res.tMax;
    $('#dbcProgressFill').style.width = '100%'; $('#dbcProgressText').textContent = 'Done!';
    const dc = Object.keys(S.decoded).length;
    const dur = S.tMax - S.tMin;
    $('#statRows').textContent = S.canRows.length.toLocaleString();
    $('#statSigs').textContent = dc;
    $('#statDur').textContent = dur.toFixed(2)+'s';
    $('#dbcStats').classList.add('visible');
    setTimeout(()=>prog.classList.remove('active'),1000);
    activateStatus(`${dc} signals, ${dur.toFixed(1)}s`);
    buildDBCTree();
    showSignalUI();
  },100);
}

// Turntide
$('#ttFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  $('#ttFileName').textContent = f.name;
  $('#ttUploadZone').classList.add('loaded');
  const r = new FileReader();
  r.onload = ev => {
    try {
      const res = Parsers.parseTurntide(ev.target.result);
      S.decoded = res.decoded; S.tMin = res.tMin; S.tMax = res.tMax;
      const dc = Object.keys(S.decoded).length;
      activateStatus(`${dc} signals, ${(S.tMax-S.tMin).toFixed(1)}s`);
      buildFlatSignalList();
      showSignalUI();
      notify(`Turntide: ${dc} signals loaded`,'success');
    } catch(err){ notify('Turntide parse error: '+err.message,'error'); }
  };
  r.readAsText(f);
});

// Curtis
$('#curtisFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  $('#curtisFileName').textContent = f.name;
  $('#curtisUploadZone').classList.add('loaded');
  const r = new FileReader();
  r.onload = ev => {
    try {
      const ext = f.name.toLowerCase().split('.').pop();
      if (ext === 'csv') {
        const res = Parsers.parseGeneral(ev.target.result, false);
        S.decoded = res.decoded; S.tMin = res.tMin; S.tMax = res.tMax;
      } else {
        const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
        const res = Parsers.parseCurtis(wb);
        S.decoded = res.decoded; S.tMin = res.tMin; S.tMax = res.tMax;
      }
      const dc = Object.keys(S.decoded).length;
      activateStatus(`${dc} signals, ${(S.tMax-S.tMin).toFixed(1)}s`);
      buildFlatSignalList();
      showSignalUI();
      notify(`Curtis: ${dc} signals loaded`,'success');
    } catch(err){ notify('Curtis parse error: '+err.message,'error'); }
  };
  if (f.name.toLowerCase().endsWith('.csv')) r.readAsText(f);
  else r.readAsArrayBuffer(f);
});

// AR / General
$('#arFileInput').addEventListener('change', e => {
  const f = e.target.files[0]; if(!f) return;
  $('#arFileName').textContent = f.name;
  $('#arUploadZone').classList.add('loaded');
  const r = new FileReader();
  r.onload = ev => {
    try {
      const ext = f.name.toLowerCase().split('.').pop();
      let res;
      if (ext === 'xlsx' || ext === 'xls') {
        const wb = XLSX.read(new Uint8Array(ev.target.result), {type:'array'});
        res = Parsers.parseGeneral(wb, true);
      } else {
        res = Parsers.parseGeneral(ev.target.result, false);
      }
      S.decoded = res.decoded; S.tMin = res.tMin; S.tMax = res.tMax;
      const dc = Object.keys(S.decoded).length;
      activateStatus(`${dc} signals, ${(S.tMax-S.tMin).toFixed(1)}s`);
      buildFlatSignalList();
      showSignalUI();
      notify(`Loaded: ${dc} signals`,'success');
    } catch(err){ notify('Parse error: '+err.message,'error'); }
  };
  if(f.name.match(/\.(xlsx|xls)$/i)) r.readAsArrayBuffer(f);
  else r.readAsText(f);
});

function activateStatus(txt) {
  const s = $('#fileStatus');
  s.classList.add('active');
  s.querySelector('.status-pill__text').textContent = txt;
}

function showSignalUI() {
  $('#signalSection').classList.add('visible');
  $('#plotSection').classList.add('visible');
}

/* ─── SIGNAL LIST BUILDERS ─── */
function buildDBCTree() {
  const wrap = $('#signalListWrap');
  wrap.innerHTML = '';
  if (!S.dbcData) return;
  const msgIdsInLog = new Set(S.canRows.map(r=>r.msgId));
  const sorted = Object.entries(S.dbcData).filter(([id])=>msgIdsInLog.has(parseInt(id,10))).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));
  for (const [idStr,msg] of sorted) {
    const id = parseInt(idStr,10);
    const sigsWithData = msg.signals.filter(s=>S.decoded[`${msg.name}::${s.name}`]);
    if (!sigsWithData.length) continue;
    const item = document.createElement('div'); item.className='message-item';
    const header = document.createElement('div'); header.className='message-header';
    header.innerHTML=`<span class="message-expand">▶</span><span class="message-id">0x${id.toString(16).toUpperCase()}</span><span class="message-name">${msg.name}</span>`;
    const list = document.createElement('div'); list.className='signal-list';
    for (const sig of sigsWithData) {
      const key = `${msg.name}::${sig.name}`;
      const el = document.createElement('div'); el.className='signal-item';
      el.dataset.key = key; el.dataset.unit = sig.unit||'';
      el.innerHTML=`<div class="signal-checkbox">✓</div><div class="signal-color-dot"></div><span class="signal-name">${sig.name}</span><span class="signal-unit">${sig.unit||''}</span>`;
      el.addEventListener('click',()=>toggleSig(el));
      list.appendChild(el);
    }
    header.addEventListener('click',()=>{header.querySelector('.message-expand').classList.toggle('expanded');list.classList.toggle('visible');});
    item.appendChild(header); item.appendChild(list); wrap.appendChild(item);
  }
}

function buildFlatSignalList() {
  const wrap = $('#signalListWrap');
  wrap.innerHTML = '';
  const keys = Object.keys(S.decoded).sort();
  for (const key of keys) {
    const sig = S.decoded[key];
    const el = document.createElement('div'); el.className='signal-item';
    el.dataset.key = key; el.dataset.unit = sig.unit||'';
    el.innerHTML=`<div class="signal-checkbox">✓</div><div class="signal-color-dot"></div><span class="signal-name">${key}</span><span class="signal-unit">${sig.unit||''}</span>`;
    el.addEventListener('click',()=>toggleSig(el));
    wrap.appendChild(el);
  }
}

/* ─── SIGNAL TOGGLE ─── */
function toggleSig(el) {
  const key = el.dataset.key;
  const idx = S.selected.findIndex(s=>s.key===key);
  if (idx >= 0) {
    S.selected.splice(idx,1);
    el.classList.remove('selected');
    el.querySelector('.signal-color-dot').style.background='transparent';
  } else {
    const c = nextColor();
    S.selected.push({key,name:key.includes('::')?key.split('::')[1]:key,unit:el.dataset.unit,color:c});
    el.classList.add('selected');
    el.querySelector('.signal-color-dot').style.background=c;
  }
  refreshTags();
}

function refreshTags() {
  const c = $('#selectedTags'); c.innerHTML='';
  for(const s of S.selected){
    const t=document.createElement('div');t.className='signal-tag';
    t.innerHTML=`<span class="signal-tag__dot" style="background:${s.color}"></span>${s.name}`;
    t.addEventListener('click',()=>removeSig(s.key));
    c.appendChild(t);
  }
  $('#plotBtn').disabled = S.selected.length===0;
}

function removeSig(key) {
  S.selected = S.selected.filter(s=>s.key!==key);
  const el = $(`.signal-item[data-key="${key}"]`);
  if(el){el.classList.remove('selected');el.querySelector('.signal-color-dot').style.background='transparent';}
  refreshTags();
}

$('#selectAllBtn').addEventListener('click',()=>{
  $$('.signal-item:not(.selected)').forEach(el=>{if(el.offsetParent!==null)toggleSig(el);});
});
$('#deselectAllBtn').addEventListener('click',()=>{
  $$('.signal-item.selected').forEach(el=>toggleSig(el));
});

// Search
$('#signalSearch').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  // DBC tree mode
  $$('.message-item').forEach(item=>{
    const mn=item.querySelector('.message-name');
    const mid=item.querySelector('.message-id');
    const sigs=item.querySelectorAll('.signal-item');
    let any=false;
    sigs.forEach(s=>{const m=s.querySelector('.signal-name').textContent.toLowerCase().includes(q);s.style.display=m||!q?'':'none';if(m)any=true;});
    item.style.display=(any||!q||(mn&&mn.textContent.toLowerCase().includes(q))||(mid&&mid.textContent.toLowerCase().includes(q)))?'':'none';
    if(any&&q){item.querySelector('.message-expand')?.classList.add('expanded');item.querySelector('.signal-list')?.classList.add('visible');}
  });
  // Flat mode
  $$('#signalListWrap > .signal-item').forEach(el=>{
    const m=el.querySelector('.signal-name').textContent.toLowerCase().includes(q);
    el.style.display=m||!q?'':'none';
  });
});

/* ─── CHART.JS ─── */
const crosshairPlugin = {
  id:'crosshair',
  afterDraw(chart){
    if(chart.tooltip?._active?.length){
      const ctx=chart.ctx;const x=chart.tooltip._active[0].element.x;
      ctx.save();ctx.beginPath();ctx.moveTo(x,chart.scales.y.top);ctx.lineTo(x,chart.scales.y.bottom);
      ctx.lineWidth=1;ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--text-faint').trim();
      ctx.setLineDash([5,4]);ctx.stroke();ctx.restore();
    }
  }
};

function chartOpts() {
  const cs = getComputedStyle(document.body);
  const gridC = cs.getPropertyValue('--chart-grid').trim();
  const textC = cs.getPropertyValue('--text-muted').trim();
  const faintC = cs.getPropertyValue('--text-faint').trim();
  return {
    responsive:true, maintainAspectRatio:false,
    animation:{duration:0},
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{position:'top',labels:{usePointStyle:true,pointStyle:'circle',font:{family:"'Outfit',sans-serif",size:11,weight:'500'},color:textC,padding:14,boxWidth:8,boxHeight:8}},
      tooltip:{
        enabled:true,backgroundColor:'rgba(15,18,25,0.95)',
        titleFont:{family:"'JetBrains Mono',monospace",size:11,weight:'600'},
        bodyFont:{family:"'JetBrains Mono',monospace",size:11},
        padding:12,cornerRadius:8,displayColors:true,boxWidth:8,boxHeight:8,usePointStyle:true,
        borderColor:'rgba(0,212,255,0.15)',borderWidth:1,
        callbacks:{
          title:items=>items.length?`Time: ${items[0].parsed.x.toFixed(4)} s`:'',
          label:item=>` ${item.dataset.label}: ${item.parsed.y.toFixed(4)}`
        }
      },
      zoom:{pan:{enabled:true,mode:'x'},zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'}}
    },
    scales:{
      x:{type:'linear',title:{display:true,text:'Time (s)',font:{family:"'Outfit',sans-serif",size:11,weight:'600'},color:faintC},
        ticks:{font:{family:"'JetBrains Mono',monospace",size:10},color:faintC,maxTicksLimit:15,callback:v=>v.toFixed(2)+'s'},
        grid:{color:gridC,drawTicks:false},border:{display:false}},
      y:{title:{display:true,text:'Value',font:{family:"'Outfit',sans-serif",size:11,weight:'600'},color:faintC},
        ticks:{font:{family:"'JetBrains Mono',monospace",size:10},color:faintC,maxTicksLimit:8},
        grid:{color:gridC,drawTicks:false},border:{display:false}}
    },
    onClick:(e,els,chart)=>{
      const cp=Chart.helpers.getRelativePosition(e,chart);
      addMarker(chart.scales.x.getValueForPixel(cp.x));
    }
  };
}

function makeDS(sig, fill=false) {
  const d = S.decoded[sig.key];
  if (!d) return null;
  // Downsample for performance: max ~3000 points (more than pixel width)
  let pts = d.data;
  const MAX_PTS = 3000;
  if (pts.length > MAX_PTS) {
    const step = pts.length / MAX_PTS;
    const sampled = [];
    for (let i = 0; i < MAX_PTS; i++) {
      const idx = Math.min(Math.floor(i * step), pts.length - 1);
      sampled.push(pts[idx]);
    }
    // Always include last point
    sampled.push(pts[pts.length - 1]);
    pts = sampled;
  }
  return {
    label:`${sig.name}${sig.unit?' ('+sig.unit+')':''}`,
    data:pts.map(p=>({x:p.t,y:p.v})),
    borderColor:sig.color, backgroundColor:sig.color+(fill?'18':'08'),
    pointRadius:0, pointHoverRadius:4, borderWidth:1.5, fill,
    tension:0, pointHoverBackgroundColor:sig.color,
    pointHoverBorderColor:'#fff', pointHoverBorderWidth:2
  };
}

function createCard(title, cid) {
  const card=document.createElement('div');card.className='chart-card';card.id=`chart-card-${cid}`;
  card.innerHTML=`<div class="chart-header"><div class="chart-title"><span class="chart-title__icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg></span>${title}</div><div class="chart-actions"><button class="btn btn--outline btn--sm" data-act="img" data-cid="${cid}" title="Save image">📷</button><button class="btn btn--outline btn--sm" data-act="zoom" data-cid="${cid}" title="Reset zoom">🔄</button></div></div><div class="chart-body"><div class="chart-canvas-wrap" style="height:${S.chartH}px"><canvas id="cv-${cid}"></canvas></div></div>`;
  return card;
}

/* ─── PLOTTING ─── */
$('#plotBtn').addEventListener('click', plot);

function plot() {
  if(!S.selected.length){notify('Select signals first','error');return;}
  $('#welcomeState').classList.add('hidden');
  $('#toolbar').classList.add('visible');
  $('#markersPanel').classList.add('visible');
  destroyCharts();
  if(S.viewMode==='combined')plotCombined();else plotSeparate();
}

function plotCombined(){
  const area=$('#chartsArea');area.innerHTML='';
  const card=createCard('All Selected Signals','c0');area.appendChild(card);
  const ds=S.selected.map(s=>makeDS(s,false)).filter(Boolean);
  const ch=new Chart(card.querySelector('canvas').getContext('2d'),{type:'line',data:{datasets:ds},options:chartOpts(),plugins:[crosshairPlugin]});
  S.charts.push(ch);
}

function plotSeparate(){
  const area=$('#chartsArea');area.innerHTML='';
  S.selected.forEach((sig,i)=>{
    const t=`${sig.name}${sig.unit?' ('+sig.unit+')':''}`;
    const card=createCard(t,`s${i}`);area.appendChild(card);
    const ds=makeDS(sig,true);if(!ds)return;
    const ch=new Chart(card.querySelector('canvas').getContext('2d'),{type:'line',data:{datasets:[ds]},options:chartOpts(),plugins:[crosshairPlugin]});
    S.charts.push(ch);
  });
}

function destroyCharts(){S.charts.forEach(c=>c.destroy());S.charts=[];}

// View toggle
$$('.toggle-btn[data-view]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    $$('.toggle-btn[data-view]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');S.viewMode=btn.dataset.view;
    if(S.selected.length&&$('#toolbar').classList.contains('visible'))plot();
  });
});

// Time range
$('#applyTimeBtn').addEventListener('click',()=>{
  const s=parseFloat($('#timeStart').value),e=parseFloat($('#timeEnd').value);
  S.charts.forEach(c=>{if(!isNaN(s))c.options.scales.x.min=s;if(!isNaN(e))c.options.scales.x.max=e;c.update();});
});
$('#resetTimeBtn').addEventListener('click',()=>{
  $('#timeStart').value='';$('#timeEnd').value='';
  S.charts.forEach(c=>{c.options.scales.x.min=undefined;c.options.scales.x.max=undefined;c.resetZoom();c.update();});
});

// Chart height
$('#chartHeight').addEventListener('input',e=>{
  S.chartH=parseInt(e.target.value,10);
  $$('.chart-canvas-wrap').forEach(w=>w.style.height=S.chartH+'px');
  S.charts.forEach(c=>c.resize());
});

// Chart actions (delegated)
$('#chartsArea').addEventListener('click',e=>{
  const btn=e.target.closest('[data-act]');if(!btn)return;
  if(btn.dataset.act==='img')downloadChartImg(btn.dataset.cid);
  else if(btn.dataset.act==='zoom'){const cv=document.getElementById(`cv-${btn.dataset.cid}`);const ch=S.charts.find(c=>c.canvas===cv);if(ch)ch.resetZoom();}
});

/* ─── CHART IMAGE EXPORT (high quality) ─── */
function downloadChartImg(cid) {
  const cv = document.getElementById(`cv-${cid}`);
  if (!cv) return;
  const chart = S.charts.find(c => c.canvas === cv);
  if (!chart) return;

  // Use Chart.js native toBase64Image for crisp output
  // Temporarily set white/dark background for export
  const isDark = document.documentElement.dataset.theme === 'dark';
  const origBg = chart.config.options.plugins.customCanvasBackgroundColor;

  // Create a temporary canvas with background
  const w = cv.width, h = cv.height;
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w; tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');

  // Draw background
  tmpCtx.fillStyle = isDark ? '#0F1219' : '#FFFFFF';
  tmpCtx.fillRect(0, 0, w, h);

  // Draw chart on top
  tmpCtx.drawImage(cv, 0, 0);

  const link = document.createElement('a');
  link.download = `CAN_chart_${cid}_${Date.now()}.png`;
  link.href = tmpCanvas.toDataURL('image/png', 1.0);
  link.click();
  notify('Chart image saved','success');
}

$('#exportChartsBtn').addEventListener('click',()=>{
  $$('.chart-card').forEach(card=>{
    const cid=card.id.replace('chart-card-','');
    downloadChartImg(cid);
  });
});

/* ─── MARKERS ─── */
function addMarker(time) {
  const vals={};
  for(const sig of S.selected){
    const d=S.decoded[sig.key];if(!d)continue;
    let closest=null,minD=Infinity;
    for(const p of d.data){const diff=Math.abs(p.t-time);if(diff<minD){minD=diff;closest=p;}}
    if(closest)vals[sig.key]={value:closest.v,color:sig.color,name:sig.name,unit:sig.unit};
  }
  S.markers.push({t:time,values:vals});
  refreshMarkers();
  notify(`Marker at ${time.toFixed(4)}s`,'success');
}

function refreshMarkers(){
  const list=$('#markersList');list.innerHTML='';
  S.markers.forEach((m,i)=>{
    const row=document.createElement('div');row.className='marker-row';
    let vh='';
    for(const v of Object.values(m.values)){
      vh+=`<span class="marker-val"><span class="marker-val__dot" style="background:${v.color}"></span>${v.name}: <strong>${v.value.toFixed(3)}</strong>${v.unit?' '+v.unit:''}</span>`;
    }
    row.innerHTML=`<span class="marker-time">${m.t.toFixed(4)}s</span><div class="marker-values">${vh}</div><button class="marker-delete" data-i="${i}">✕</button>`;
    list.appendChild(row);
  });
}

$('#markersList').addEventListener('click',e=>{const b=e.target.closest('.marker-delete');if(b){S.markers.splice(parseInt(b.dataset.i,10),1);refreshMarkers();}});
$('#clearMarkersBtn').addEventListener('click',()=>{S.markers=[];refreshMarkers();notify('Markers cleared','info');});

/* ─── CSV EXPORT ─── */
$('#exportCsvBtn').addEventListener('click',()=>$('#downloadModal').classList.add('show'));
$('#modalCloseBtn').addEventListener('click',()=>$('#downloadModal').classList.remove('show'));
$('#downloadModal').addEventListener('click',e=>{if(e.target===$('#downloadModal'))$('#downloadModal').classList.remove('show');});

$$('.modal-option').forEach(opt=>{
  opt.addEventListener('click',()=>{
    $('#downloadModal').classList.remove('show');
    const mode=opt.dataset.mode;
    if(mode==='selected')exportCSV(S.selected.map(s=>s.key));
    else exportCSV(Object.keys(S.decoded));
  });
});

function exportCSV(keys) {
  if(!keys.length)return;
  const allT=new Set();
  keys.forEach(k=>{if(S.decoded[k])S.decoded[k].data.forEach(d=>allT.add(d.t));});
  const sorted=[...allT].sort((a,b)=>a-b);
  const maps=keys.map(k=>{const m=new Map();if(S.decoded[k])S.decoded[k].data.forEach(d=>m.set(d.t,d.v));return m;});
  const names=keys.map(k=>k.includes('::')?k.split('::')[1]:k);
  let csv='Timestamp,'+names.join(',')+'\n';
  for(const t of sorted){const row=[t.toFixed(6)];maps.forEach(m=>row.push(m.has(t)?m.get(t).toFixed(6):''));csv+=row.join(',')+'\n';}
  const blob=new Blob([csv],{type:'text/csv'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`decoded_${Date.now()}.csv`;link.click();
  URL.revokeObjectURL(link.href);
  notify('CSV exported','success');
}

})();

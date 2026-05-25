// ========== API KEY ==========
let apiKey = localStorage.getItem('sescam_groq_key') || '';

function initKey() {
  const banner = document.getElementById('key-banner');
  const ks = document.getElementById('key-set');
  const dot = document.getElementById('sdot');
  if (apiKey) {
    banner.classList.add('hidden');
    ks.classList.add('show');
    dot.className = 'sdot dok';
  } else {
    banner.classList.remove('hidden');
    ks.classList.remove('show');
    dot.className = 'sdot dwarn';
  }
}
function saveKey() {
  const v = document.getElementById('key-inp').value.trim();
  if (!v) { alert('Pega tu API Key de Groq (console.groq.com/keys).'); return; }
  apiKey = v;
  localStorage.setItem('sescam_groq_key', apiKey);
  initKey();
}
function changeKey() {
  apiKey = '';
  localStorage.removeItem('sescam_groq_key');
  document.getElementById('key-inp').value = '';
  initKey();
}

// ========== SYSTEM PROMPT ==========
const SYS = `Eres un asistente clínico experto para enfermeros/as de urgencias del SESCAM (Servicio de Salud de Castilla-La Mancha). Estilo basado en los "Esquemas Prácticos en Medicina de Urgencias y Emergencias" de la Base Tembleque (GUETS). Colega enfermero de guardia: directo, cercano y resolutivo.

RESPONDE SIEMPRE con un JSON válido con exactamente estas 4 claves, sin texto fuera del JSON:
{"concepto":"...","fisiopatologia":"...","enfermeria":"...","alertas":"..."}

ENFERMERÍA (esquema GUETS): 1.ABCDE+constantes 2.Vía/monitorización/analítica 3.Intervenciones con dosis exactas 4.Registros Mambrino/DIRAYA 5.Confort e información.
ALERTAS: avisar médico YA, códigos SESCAM/CLM, errores frecuentes, precauciones farmacológicas, criterios UCI.
REGLAS: informal de guardia, siglas explicadas la primera vez entre paréntesis, sin markdown, basado en ERC 2021, ESC 2023, SEMICYUC, NICE.`;

// ========== HISTORIAL Y VOZ ==========
let hist = [];
let attachedImgBase64 = null;
let recognition = null, voiceActive = false, voiceTimeout = null;
const inpField = document.getElementById('inp');

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SC = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SC();
  recognition.lang = 'es-ES'; recognition.continuous = true; recognition.interimResults = true;
  recognition.onresult = (e) => {
    clearTimeout(voiceTimeout); let trans = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) trans += e.results[i][0].transcript;
    }
    if (trans) inpField.value = trans;
    voiceTimeout = setTimeout(() => { if (voiceActive && inpField.value.trim()) { stopVoice(); doSend(); } }, 1800);
  };
  recognition.onerror = () => stopVoice();
  recognition.onend = () => { if (voiceActive) stopVoice(); };
}
function toggleVoice() { voiceActive ? stopVoice() : startVoice(); }
function startVoice() {
  voiceActive = true; inpField.value = '';
  document.getElementById('mic-btn').classList.add('listening');
  if (recognition) recognition.start();
}
function stopVoice() {
  voiceActive = false; clearTimeout(voiceTimeout);
  document.getElementById('mic-btn').classList.remove('listening');
  if (recognition) recognition.stop();
}

// ========== IMAGEN ECG ==========
function previewEcgImg(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxW = 900; let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      attachedImgBase64 = canvas.toDataURL('image/jpeg', 0.65);
      document.getElementById('img-preview').src = attachedImgBase64;
      document.getElementById('img-preview-box').style.display = 'block';
      document.getElementById('ecg-res-box').innerHTML = "<span style='color:#34d399;font-weight:700'>📸 Foto ECG lista. Pulsa «Enviar al Asistente IA».</span>";
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function clearAttachedImg() {
  attachedImgBase64 = null;
  document.getElementById('ecg-img-file').value = '';
  document.getElementById('img-preview-box').style.display = 'none';
}

// ========== PANELS ==========
function togglePanel(id) {
  const panel = document.getElementById(id + '-panel');
  const isOpen = panel.classList.contains('show');
  document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('show'));
  if (!isOpen) panel.classList.add('show');
}

// ========== CHAT ==========
async function sendMsg(txt) {
  if (!txt.trim() && !attachedImgBase64) return;
  if (!apiKey) { alert('Configura tu API Key de Groq primero (gratis en console.groq.com/keys).'); return; }
  rmWelcome(); addUser(txt, attachedImgBase64);
  
  // CORRECCIÓN: Estructurar correctamente los mensajes según si llevan imagen o no
  let messagesToSend = [];
  if (attachedImgBase64) {
    messagesToSend = [
      { role: 'system', content: SYS },
      { role: 'user', content: [
          { type: 'text', text: txt || 'Analiza esta tira ECG.' },
          { type: 'image_url', image_url: { url: attachedImgBase64 } }
        ] 
      }
    ];
    hist = []; // Reseteamos historial en texto si se manda una imagen para evitar conflictos de modelos en Groq
  } else {
    hist.push({ role: 'user', content: txt });
    messagesToSend = [{ role: 'system', content: SYS }, ...hist];
  }

  clearAttachedImg();
  const tid = addTyping(); document.getElementById('sdot').className = 'sdot dwarn';
  
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: messagesToSend[messagesToSend.length - 1].content instanceof Array ? 'llama-3.2-11b-vision-preview' : 'llama-3.3-70b-versatile',
        messages: messagesToSend,
        max_tokens: 1500, temperature: 0.2
      })
    });
    const d = await r.json(); rmEl(tid);
    if (d.error) throw new Error(d.error.message);
    let raw = d.choices?.[0]?.message?.content || '';
    
    // CORRECCIÓN: Extracción robusta del JSON por si la IA mete texto extra antes o después
    let p; 
    try { 
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        p = JSON.parse(jsonMatch[0]); 
      } else {
        throw new Error("No JSON found");
      }
    } catch { 
      p = { concepto: raw, fisiopatologia: '', enfermeria: '', alertas: '' }; 
    }
    
    addBot(p); 
    if (!messagesToSend[messagesToSend.length - 1].content instanceof Array) {
      hist.push({ role: 'assistant', content: raw });
    }
    document.getElementById('sdot').className = 'sdot dok';
  } catch (e) {
    rmEl(tid); addErr('Error: ' + (e.message || 'Revisa tu API Key de Groq.'));
    document.getElementById('sdot').className = 'sdot derr';
  }
  scrollB();
}

function rmWelcome() { const w = document.getElementById('welcome'); if (w) w.remove(); }

function addUser(txt, img) {
  const el = document.createElement('div'); el.className = 'buser';
  if (txt) el.textContent = txt;
  if (img) { const i = document.createElement('img'); i.src = img; el.appendChild(i); }
  document.getElementById('msgs').appendChild(el); scrollB();
}

function addBot(d) {
  const secs = [
    { k: 'concepto',       lbl: 'Concepto',      sub: 'definición · clasificación · códigos CLM', cls: 's1' },
    { k: 'fisiopatologia', lbl: 'Fisiopatología', sub: 'mecanismo · presentación clínica',         cls: 's2' },
    { k: 'enfermeria',     lbl: 'Enfermería',     sub: 'ABCDE · intervenciones · dosis · registros', cls: 's3' },
    { k: 'alertas',        lbl: 'Alertas',        sub: 'escalada · errores frecuentes · códigos',  cls: 's4' }
  ];
  const wrap = document.createElement('div'); wrap.className = 'bbot';
  secs.forEach(s => {
    const v = (d[s.k] || '').trim(); if (!v) return;
    const sec = document.createElement('div'); sec.className = 'sec ' + s.cls;
    sec.innerHTML = `<div class="slbl">${s.lbl}<span class="ssub">${s.sub}</span></div><div class="stxt">${fmt(v)}</div>`;
    wrap.appendChild(sec);
  });
  document.getElementById('msgs').appendChild(wrap); scrollB();
}

function fmt(t) {
  return esc(t)
    .replace(/(\d+[,.]?\d*\s*(mg|mcg|ml|UI|mEq|mmHg|lpm|rpm|%|mL\/h|gotas\/min))/gi, '<span class="dose">$1</span>')
    .replace(/(Código\s\w+|SVB|SVA|RCP|ABCDE|ERC\s?\d+|Manchester|SESCAM|GUETS)/gi, '<span class="proto">$1</span>');
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

let tc = 0;
function addTyping() {
  const id = 't' + (++tc); const el = document.createElement('div');
  el.id = id; el.className = 'bbot';
  el.innerHTML = `<div class="sec s2"><div class="typing"><div class="td"></div><div class="td"></div><div class="td"></div></div></div>`;
  document.getElementById('msgs').appendChild(el); scrollB(); return id;
}
function addErr(msg) {
  const el = document.createElement('div'); el.className = 'bbot';
  el.innerHTML = `<div class="errbox">${esc(msg)}</div>`;
  document.getElementById('msgs').appendChild(el);
}
function rmEl(id) { const e = document.getElementById(id); if (e) e.remove(); }
function scrollB() { const m = document.getElementById('msgs'); setTimeout(() => m.scrollTop = m.scrollHeight, 40); }

function clearScreen() {
  hist = [];
  document.getElementById('msgs').innerHTML = `<div class="welcome" id="welcome"><div style="font-size:32px;margin-bottom:10px">🚑</div><strong>Estación Clinical de Guardia</strong><em>ESQUEMAS GUETS · BASE TEMBLEQUE · SESCAM</em><p>Limpio y listo para la guardia.</p><div class="chips"><div class="chip" onclick="chip('Paciente con dolor torácico agudo')">Dolor torácico</div><div class="chip" onclick="chip('Código Sepsis SESCAM')">Código Sepsis</div><div class="chip" onclick="chip('PCR adulto SVB SVA ERC 2021')">PCR / RCP</div><div class="chip" onclick="chip('Shock anafiláctico con dosis')">Anafilaxia</div></div></div>`;
  document.getElementById('sdot').className = 'sdot';
}

function chip(txt) { document.getElementById('inp').value = txt; doSend(); }
function doSend() {
  const txt = inpField.value.trim(); if (!txt && !attachedImgBase64) return;
  inpField.value = ''; inpField.style.height = 'auto'; sendMsg(txt);
}
inpField.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
inpField.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; });

// ========== ECG — setEcg ==========
const ecgState = {};

function setEcg(btn) {
  const param = btn.dataset.param;
  const val = btn.dataset.val;
  document.querySelectorAll(`.ecg-opt[data-param="${param}"]`).forEach(b => b.classList.remove('active'));
  if (ecgState[param] === val) {
    delete ecgState[param];
  } else {
    ecgState[param] = val;
    btn.classList.add('active');
  }
  updateEcgResult();
}

function updateEcgResult() {
  const box = document.getElementById('ecg-res-box');
  const {fc, ritmo, qrs, ondap, st, estado} = ecgState;

  if (!fc && !ritmo && !qrs && !ondap && !st && !estado) {
    box.style.color = 'var(--txt2)'; box.style.fontStyle = 'italic';
    box.textContent = 'Selecciona los parámetros del ECG para obtener interpretación...';
    return;
  }

  box.style.color = 'var(--txt)'; box.style.fontStyle = 'normal';
  let interp = '';
  let urgente = false;

  if (fc === 'bradi') interp += '⚡ FC baja (<60lpm) — Valorar atropina si sintomática.\n';
  if (fc === 'normo') interp += '✓ FC normal (60-100lpm).\n';
  if (fc === 'taqui') interp += '⚡ FC elevada (>100lpm) — ECG completo, valorar causa.\n';
  if (ritmo === 'irregular') interp += '⚡ Ritmo irregular — Sospechar FA (Fibrilación Auricular). Valorar anticoagulación.\n';
  if (qrs === 'estrecho' && ondap === 'presente' && ritmo === 'regular') interp += '✓ Ritmo sinusal (QRS estrecho, onda P presente, rítmico).\n';
  if (qrs === 'estrecho' && ondap === 'ausente' && ritmo === 'irregular') interp += '⚠️ Posible FA: QRS estrecho + ausencia de onda P + ritmo irregular.\n';
  if (qrs === 'ancho') { interp += '⚠️ QRS ancho — Sospechar bloqueo de rama o TV (Taquicardia Ventricular).\n'; }
  if (qrs === 'ancho' && fc === 'taqui') { interp += '🚨 TAQUICARDIA DE QRS ANCHO — Posible TV. Si inestable: cardioversión inmediata.\n'; urgente = true; }
  if (st === 'elev') {
    interp += '🚨 ELEVACIÓN ST — ACTIVAR CÓDIGO INFARTO (HEMOCOD) INMEDIATAMENTE. ECG 12 derivaciones urgente. Avisar médico YA.\n';
    urgente = true;
  }
  if (st === 'desc') interp += '⚠️ Descenso ST — Posible isquemia subendocárdica. ECG seriado + enzimas cardíacas.\n';
  if (st === 'iso') interp += '✓ Segmento ST isoeléctrico.\n';
  if (estado === 'inestable') {
    interp += '🚨 PACIENTE INESTABLE — Monitorización continua. Avisar médico URGENTE. Preparar carro de paradas.\n';
    urgente = true;
  }

  box.style.borderColor = urgente ? '#ef4444' : 'var(--bdr2)';
  box.style.background = urgente ? 'rgba(239,68,68,.07)' : '#0a0f24';
  box.textContent = interp.trim() || 'Continúa seleccionando parámetros...';
}

function sendEcgToAi() {
  const {fc, ritmo, qrs, ondap, st, estado} = ecgState;
  const txt = `Analiza este ECG: FC=${fc||'?'}, Ritmo=${ritmo||'?'}, QRS=${qrs||'?'}, OndaP=${ondap||'?'}, ST=${st||'?'}, EstadoClínico=${estado||'?'}${attachedImgBase64 ? ' + imagen adjunta' : ''}. Dame interpretación clínica completa y actuación enfermera SESCAM.`;
  togglePanel('ecg');
  document.getElementById('inp').value = txt;
  doSend();
}

function resetEcgPanel() {
  Object.keys(ecgState).forEach(k => delete ecgState[k]);
  document.querySelectorAll('.ecg-opt').forEach(b => b.classList.remove('active'));
  const box = document.getElementById('ecg-res-box');
  box.textContent = 'Selecciona los parámetros del ECG para obtener interpretación...';
  box.style.color = 'var(--txt2)'; box.style.fontStyle = 'italic';
  box.style.borderColor = 'var(--bdr2)'; box.style.background = '#0a0f24';
  clearAttachedImg();
}

// ========== VADEMÉCUM — calcPed ==========
function calcPed(kgStr) {
  const kg = parseFloat(kgStr);
  if (isNaN(kg) || kg <= 0) return;

  document.querySelectorAll('.calc-val').forEach(span => {
    const mult = parseFloat(span.dataset.mult);
    const max = parseFloat(span.dataset.max);
    const min = parseFloat(span.dataset.min);
    if (isNaN(mult)) return;

    let raw = kg * mult;
    let capped = false;
    if (!isNaN(max) && raw > max) { raw = max; capped = true; }
    if (!isNaN(min) && raw < min) { raw = min; }

    const decimals = raw < 1 ? 3 : raw < 10 ? 2 : 1;
    span.textContent = raw.toFixed(decimals);
    span.style.color = capped ? '#f87171' : '#34d399';

    let badge = span.nextElementSibling;
    if (badge && badge.classList.contains('cap-warn')) badge.remove();
    if (capped) {
      const b = document.createElement('span');
      b.className = 'cap-warn'; b.textContent = `TOPE ${max}${span.dataset.unit||'mg'}`;
      span.insertAdjacentElement('afterend', b);
    }
  });

  const ipraEl = document.getElementById('p-ipra-val');
  if (ipraEl) ipraEl.textContent = kg < 20 ? '250' : '500';

  const glucaEl = document.getElementById('p-gluca-val');
  if (glucaEl) glucaEl.textContent = kg < 25 ? '0.5' : '1';
}

// ========== VADEMÉCUM — filterPed ==========
function filterPed(query) {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasQuery = q.length > 0;
  const advTitle = document.getElementById('adv-title');

  document.querySelectorAll('#vade-list .p-card').forEach(card => {
    const name = (card.dataset.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const line = card.dataset.line;
    const matches = name.includes(q);

    if (hasQuery) {
      card.classList.toggle('hidden-card', !matches);
    } else {
      if (line === 'second') {
        card.classList.add('hidden-card');
      } else {
        card.classList.remove('hidden-card');
      }
    }
  });

  if (advTitle) advTitle.classList.toggle('hidden-card', !hasQuery);
}

function resetPedPanel() {
  document.getElementById('p-weight').value = '';
  document.getElementById('p-search').value = '';
  document.querySelectorAll('.calc-val').forEach(s => { s.textContent = '—'; s.style.color = '#34d399'; });
  document.querySelectorAll('.cap-warn').forEach(b => b.remove());
  filterPed('');
}

// ========== INIT ==========
initKey();
filterPed('');
const API_BASE = 'https://casa-glam-api.novamarketingstudiocr.workers.dev';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 });

let settings = { open: '09:00', close: '18:00', slot: 60, pros: ['Pamela González'], services: [] };
let adminPin = sessionStorage.getItem('cg_admin_pin') || '';
let adminAppointments = [];
let adminClients = [];
let appointmentFilter = 'all';


let paymentCache = {};
try { paymentCache = JSON.parse(localStorage.getItem('cg_payment_cache_v46_3') || '{}') || {}; } catch { paymentCache = {}; }

function persistPaymentCache() {
  try { localStorage.setItem('cg_payment_cache_v46_3', JSON.stringify(paymentCache || {})); } catch {}
}

function mergeCachedPayment(a) {
  const cached = paymentCache[String(a.id)];
  if (!cached) return a;
  const out = { ...a };
  const serverPrice = Number(a.price || 0);
  const serverDeposit = Number(a.deposit || 0);
  const cachePrice = Number(cached.price || 0);
  const cacheDeposit = Number(cached.deposit || 0);
  if (!(serverPrice > 0) && cachePrice > 0) out.price = cachePrice;
  if (!(serverDeposit > 0) && cacheDeposit > 0) out.deposit = cacheDeposit;
  if (!String(out.payment_method || '').trim() && String(cached.payment_method || '').trim()) out.payment_method = cached.payment_method;
  if (!String(out.payment_status || '').trim() && String(cached.payment_status || '').trim()) out.payment_status = cached.payment_status;
  return out;
}

function options(el, arr) {
  if (!el) return;
  el.innerHTML = arr.map((x) => `<option>${esc(x)}</option>`).join('');
}

function todayISO() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function slots() {
  const out = [];
  const [h, m] = settings.open.split(':').map(Number);
  const [eh, em] = settings.close.split(':').map(Number);
  let cur = h * 60 + m;
  const end = eh * 60 + em;
  const step = Math.max(15, Number(settings.slot) || 60);
  while (cur < end) {
    out.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
    cur += step;
  }
  return out;
}

async function api(url, opt = {}) {
  const target = url.startsWith('/api') ? API_BASE + url : url;
  const r = await fetch(target, opt);
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data;
}

async function loadConfig() {
  try {
    const d = await api('/api/config');
    settings = {
      open: d.settings?.open || '09:00',
      close: d.settings?.close || '18:00',
      slot: +(d.settings?.slot || 60),
      pros: (d.professionals || []).map((x) => x.name),
      services: (d.services || []).map((x) => x.name),
    };
    options($('service'), settings.services);
    options($('professional'), settings.pros);
    options($('time'), slots());
    const dateEl = $('date');
    if (dateEl) dateEl.min = todayISO();
  } catch {
    const msg = $('bookingMsg');
    if (msg) msg.textContent = 'No se pudo conectar con la agenda online. Intenta nuevamente.';
  }
}

async function refreshAvailability() {
  const date = $('date')?.value;
  const professional = $('professional')?.value;
  if (!date || !professional) return;
  try {
    const q = new URLSearchParams({ date, professional });
    const d = await api('/api/availability?' + q);
    const available = (d.slots || []).filter((x) => x.available).map((x) => x.time);
    const occupied = (d.slots || []).filter((x) => !x.available).map((x) => x.time);
    options($('time'), available);
    const msg = $('bookingMsg');
    if (!msg) return;
    if (!available.length) msg.textContent = `⚠️ No quedan horarios disponibles para ${date} con ${professional}. Selecciona otro día.`;
    else if (occupied.length) msg.textContent = `Horarios ocupados: ${occupied.join(', ')}. Solo puedes seleccionar horarios disponibles.`;
    else msg.textContent = 'Horarios disponibles para esa fecha.';
  } catch (e) {
    const msg = $('bookingMsg');
    if (msg) msg.textContent = e.message;
  }
}

if ($('date')) $('date').onchange = refreshAvailability;
if ($('professional')) $('professional').onchange = refreshAvailability;

document.querySelectorAll('[data-service]').forEach((b) => {
  b.onclick = () => {
    const service = $('service');
    if (service) service.value = b.dataset.service;
    location.hash = 'reservar';
  };
});

const bookingForm = $('bookingForm');
if (bookingForm) {
  bookingForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    const a = {
      name: $('clientName').value.trim(),
      phone: $('clientPhone').value.trim(),
      service: $('service').value,
      professional: $('professional').value,
      date: $('date').value,
      time: $('time').value,
      notes: $('notes').value.trim(),
    };
    try {
      await api('/api/appointments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
      $('bookingMsg').textContent = '¡Cita guardada online! Abriendo WhatsApp como confirmación adicional…';
      const msg = `Hola Casa Glam ✨ Acabo de reservar esta cita:\nNombre: ${a.name}\nServicio: ${a.service}\nProfesional: ${a.professional}\nFecha: ${a.date}\nHora: ${a.time}${a.notes ? '\nNotas: ' + a.notes : ''}`;
      window.open('https://wa.me/50671286540?text=' + encodeURIComponent(msg), '_blank');
      e.target.reset();
      await loadConfig();
    } catch (err) {
      $('bookingMsg').textContent = err.message;
      await refreshAvailability();
    } finally {
      if (btn) btn.disabled = false;
    }
  };
}

function adminHeaders() { return { 'x-admin-pin': adminPin, 'content-type': 'application/json' }; }
function paymentValues(a) { const price = Number(a.price || 0); const deposit = Number(a.deposit || 0); return { price, deposit, balance: Math.max(0, price - deposit) }; }
function paymentMethod(a) { return String(a.payment_method || 'Efectivo').trim() || 'Efectivo'; }
function paymentState(a) {
  const p = paymentValues(a);
  const method = paymentMethod(a).toLowerCase();
  if (!p.price && !p.deposit) return 'Sin cobro';
  if (p.deposit > 0 && p.price > 0 && p.deposit < p.price) return 'Parcial';
  if (p.deposit > 0 && p.price > 0 && p.deposit >= p.price) return 'Cobrado';
  if (p.deposit > 0 && p.price === 0) return 'Cobrado';
  if (method === 'sinpe' && p.price > 0 && p.deposit <= 0) return 'Pendiente SINPE';
  if (p.price > 0 && p.deposit <= 0) return 'Pendiente';
  return 'Sin cobro';
}
function fmtMoney(n) { return money.format(Number(n || 0)); }
function paymentBadge(a) { const p = paymentValues(a); const method = esc(paymentMethod(a)); const state = paymentState(a); if (state === 'Sin cobro') return '<span class="balance-pill">Sin cobro</span>'; if (state === 'Pendiente SINPE') return '<span class="balance-pill">SINPE pendiente</span>'; if (state === 'Parcial') return `<span class="balance-pill">Cobro parcial · ${method}</span>`; if (state === 'Cobrado') return `<span class="balance-pill">Cobrado · ${method}</span>`; if (!p.price && !p.deposit) return '<span class="balance-pill">Sin cobro</span>'; return '<span class="balance-pill">Saldo pendiente</span>'; }


function setAppointmentFilter(filter) {
  appointmentFilter = filter || 'all';
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b.dataset.apptFilter === appointmentFilter));
  renderAdmin();
}

async function loadAdminBase() {
  const [aRes, cfgRes, clRes, dashRes, remRes] = await Promise.allSettled([
    api('/api/admin/appointments', { headers: adminHeaders() }),
    api('/api/config'),
    api('/api/admin/clients', { headers: adminHeaders() }),
    api('/api/admin/dashboard', { headers: adminHeaders() }),
    api('/api/admin/reminders', { headers: adminHeaders() }),
  ]);

  adminAppointments = (aRes.status === 'fulfilled' ? (aRes.value.appointments || []) : []).map(mergeCachedPayment);
  const cfg = cfgRes.status === 'fulfilled' ? cfgRes.value : { settings: {}, professionals: [], services: [] };
  settings = {
    open: cfg.settings?.open || '09:00',
    close: cfg.settings?.close || '18:00',
    slot: +(cfg.settings?.slot || 60),
    pros: (cfg.professionals || []).map((x) => x.name),
    services: (cfg.services || []).map((x) => x.name),
  };
  adminClients = clRes.status === 'fulfilled' ? (clRes.value.clients || []) : [];

  if ($('openTime')) $('openTime').value = settings.open;
  if ($('closeTime')) $('closeTime').value = settings.close;
  if ($('slotMinutes')) $('slotMinutes').value = settings.slot;
  if ($('pros')) $('pros').value = settings.pros.join('\n');
  if ($('servicesCfg')) $('servicesCfg').value = settings.services.join('\n');

  renderClients();
  renderAdmin();
  renderBilling();
  renderDashboard(dashRes.status === 'fulfilled' ? dashRes.value : null);
  renderReminders(remRes.status === 'fulfilled' ? remRes.value : null);
}

const loadAdmin = loadAdminBase;

async function login() {
  adminPin = $('adminPin').value.trim();
  $('loginMsg').textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ pin: adminPin }) });
    sessionStorage.setItem('cg_admin_pin', adminPin);
    $('adminLogin').hidden = true;
    $('adminPanel').hidden = false;
    await loadAdminBase();
    setAppointmentFilter(appointmentFilter);
  } catch {
    adminPin = '';
    sessionStorage.removeItem('cg_admin_pin');
    $('loginMsg').textContent = 'No se pudo entrar. Verifica el PIN o vuelve a cargar la página.';
  }
}

if ($('loginBtn')) $('loginBtn').onclick = login;
if ($('adminPin')) $('adminPin').onkeydown = (e) => { if (e.key === 'Enter') login(); };
if ($('logoutBtn')) $('logoutBtn').onclick = () => { adminPin = ''; sessionStorage.removeItem('cg_admin_pin'); $('adminPanel').hidden = true; $('adminLogin').hidden = false; $('adminPin').value = ''; };

function renderDashboard(d) {
  const x = d?.summary || {};
  if ($('todayCount')) $('todayCount').textContent = x.today || 0;
  if ($('tomorrowCount')) $('tomorrowCount').textContent = x.tomorrow || 0;
  if ($('pendingCount')) $('pendingCount').textContent = x.pending || 0;
  if ($('confirmedCount')) $('confirmedCount').textContent = x.confirmed || 0;
  if ($('reprogrammedCount')) $('reprogrammedCount').textContent = x.reprogrammed || 0;
  if ($('clientCount')) $('clientCount').textContent = x.clients || 0;
  if ($('recurrentCount')) $('recurrentCount').textContent = x.recurrent || 0;
  if ($('attendedMonthCount')) $('attendedMonthCount').textContent = x.attendedMonth || 0;
  if ($('reminderCount')) $('reminderCount').textContent = x.reminders || 0;

  const daily = d?.daily || [];
  const max = Math.max(1, ...daily.map((x) => +x.total || 0));
  if ($('weekChart')) {
    $('weekChart').innerHTML = daily.map((x) => {
      const dt = new Date(x.date + 'T12:00:00');
      const day = dt.toLocaleDateString('es-CR', { weekday: 'short' });
      const pct = Math.max(6, Math.round(((+x.total || 0) / max) * 100));
      return `<div class="bar-item"><div class="bar-track"><div class="bar-fill" style="height:${pct}%"></div></div><strong>${+x.total || 0}</strong><span>${esc(day)}</span></div>`;
    }).join('');
  }

  if ($('topServices')) {
    const top = d?.topServices || [];
    $('topServices').innerHTML = top.length ? top.map((x, i) => `<div class="top-service"><span>${i + 1}. ${esc(x.service)}</span><strong>${x.total}</strong></div>`).join('') : '<p>Aún no hay datos este mes.</p>';
  }
}

function reminderWa(phone, msg) { const p = String(phone || '').replace(/\D/g, '').replace(/^506/, ''); return `https://wa.me/506${p}?text=${encodeURIComponent(msg)}`; }

function renderReminders(d) {
  const a = d?.appointments || [];
  const f = d?.followups || [];
  const rows = [];
  a.forEach((x) => {
    const when = x.reminder_type === '2h' ? 'en menos de 2 horas' : 'dentro de 24 horas';
    const msg = `Hola ${x.name} 👋 Te recordamos tu cita en Casa Glam ${x.date} a las ${x.time} con ${x.professional}. Servicio: ${x.service}. ¡Te esperamos!`;
    rows.push(`<div class="reminder-row"><div><strong>📅 ${esc(x.name)}</strong><p>${esc(x.service)} · ${esc(x.date)} ${esc(x.time)} · ${when}</p></div><a target="_blank" href="${reminderWa(x.phone, msg)}">Enviar WhatsApp</a></div>`);
  });
  f.forEach((x) => {
    const msg = `Hola ${x.name} 🌸 Te escribimos de Casa Glam. Ya se acerca el momento recomendado para renovar tu ${x.service}. ¿Deseas que te ayudemos a reservar tu próxima cita?`;
    rows.push(`<div class="reminder-row followup"><div><strong>✨ ${esc(x.name)}</strong><p>${esc(x.service)} · seguimiento para ${esc(x.due_date)}</p></div><a target="_blank" href="${reminderWa(x.phone, msg)}">Enviar WhatsApp</a></div>`);
  });
  if ($('remindersList')) $('remindersList').innerHTML = rows.length ? rows.join('') : '<p>No hay recordatorios pendientes en este momento.</p>';
}

if ($('refreshReminders')) $('refreshReminders').onclick = async () => {
  try {
    const [d, r] = await Promise.all([
      api('/api/admin/dashboard', { headers: adminHeaders() }),
      api('/api/admin/reminders', { headers: adminHeaders() }),
    ]);
    renderDashboard(d);
    renderReminders(r);
  } catch (e) {
    alert(e.message);
  }
};

function appointmentMoment(a) { return new Date(a.date + 'T' + a.time + ':00'); }
function reminderLabel(a) {
  if (a.status === 'Cancelada' || a.status === 'Atendida') return '';
  const now = new Date();
  const dt = appointmentMoment(a);
  const diff = dt - now;
  const hours = diff / 36e5;
  const today = todayISO();
  const tomorrow = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
  if (diff < 0) return 'Hora pasada';
  if (a.date === today && hours <= 2) return '🔔 En menos de 2 horas';
  if (a.date === today) return '🔔 Hoy';
  if (a.date === tomorrow) return '🔔 Mañana';
  if (hours <= 48) return '🔔 Próxima';
  return '';
}


function apptCard(a, cancelled = false) {
  const badge = reminderLabel(a);
  const phone = String(a.phone || '').replace(/\D/g, '').replace(/^506/, '');
  const msg = 'Hola ' + a.name + ' 👋 Te recordamos tu cita en Casa Glam el ' + a.date + ' a las ' + a.time + ' con ' + a.professional + '. Servicio: ' + a.service + '. Si necesitas realizar un cambio, escríbenos por este medio.';
  const p = paymentValues(a);
  const method = paymentMethod(a);
  const paymentHtml = p.price || p.deposit
    ? `<div class="payment-chip">${paymentBadge(a)}</div>`
    : `<div class="payment-chip empty">Sin cobro</div>`;
  return `<div class="appt ${cancelled ? 'appt-cancelled' : ''}"><div><h4>${esc(a.date)} · ${esc(a.time)} — ${esc(a.name)} ${badge ? `<span class="reminder-badge">${badge}</span>` : ''}</h4><p>${esc(a.service)} · ${esc(a.professional)}</p><p>${esc(a.phone)}${a.notes ? ' · ' + esc(a.notes) : ''}</p>${paymentHtml}</div><div class="appt-actions"><select data-status="${a.id}">${['Pendiente', 'Confirmada', 'Reprogramada', 'Atendida', 'Cancelada'].map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select>${!cancelled ? `<a target="_blank" href="https://wa.me/506${phone}?text=${encodeURIComponent(msg)}">Recordar por WhatsApp</a>` : ''}</div></div>`;
}

function billingSummaryCards() {
  const rows = adminAppointments || [];
  const total = rows.reduce((n, a) => n + Number(a.deposit || 0), 0);
  const balance = rows.reduce((n, a) => n + Math.max(0, Number(a.price || 0) - Number(a.deposit || 0)), 0);
  const sinpe = rows.reduce((n, a) => n + ((String(a.payment_method || 'Efectivo').trim().toLowerCase() === 'sinpe') ? Number(a.deposit || 0) : 0), 0);
  const cash = rows.reduce((n, a) => n + ((String(a.payment_method || 'Efectivo').trim().toLowerCase() === 'efectivo') ? Number(a.deposit || 0) : 0), 0);
  const pendingSinpe = rows.reduce((n, a) => {
    const method = String(a.payment_method || 'Efectivo').trim().toLowerCase();
    const price = Number(a.price || 0);
    const deposit = Number(a.deposit || 0);
    const derived = paymentState(a);
    if (method !== 'sinpe') return n;
    if (derived === 'Sin cobro') return n;
    return n + Math.max(0, price - deposit);
  }, 0);
  return `
    <div class="stats billing-stats">
      <div><span>Monto cobrado</span><strong id="paidCount">${fmtMoney(total)}</strong></div>
      <div><span>Saldo pendiente</span><strong id="balanceCount">${fmtMoney(balance)}</strong></div>
      <div><span>Cobrado SINPE</span><strong id="sinpeCount">${fmtMoney(sinpe)}</strong></div>
      <div><span>Cobrado efectivo</span><strong id="cashCount">${fmtMoney(cash)}</strong></div>
      <div><span>Pendientes SINPE</span><strong id="pendingSinpeCount">${fmtMoney(pendingSinpe)}</strong></div>
    </div>`;
}


function parseMoneyValue(value) {
  const raw = String(value ?? '').trim().replace(/[^\d.-]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function normalizePaymentInputs(id) {
  const priceInput = document.querySelector(`[data-price="${id}"]`);
  const depositInput = document.querySelector(`[data-deposit="${id}"]`);
  const paymentMethodInput = document.querySelector(`[data-payment-method="${id}"]`);
  const paymentStatusInput = document.querySelector(`[data-payment-status="${id}"]`);
  const currentStatus = String(document.querySelector(`[data-status="${id}"]`)?.value || '').trim();

  const priceVal = parseMoneyValue(priceInput?.value);
  const depositVal = parseMoneyValue(depositInput?.value);
  const paymentMethod = String(paymentMethodInput?.value || 'Efectivo').trim() || 'Efectivo';
  const paymentMethodLower = paymentMethod.toLowerCase();

  const hasPrice = priceVal !== null;
  const hasDeposit = depositVal !== null;
  const price = hasPrice ? priceVal : 0;
  const deposit = hasDeposit ? depositVal : 0;

  let paymentStatus = String(paymentStatusInput?.value || '').trim();
  const derivedStatus = (() => {
    if (!hasPrice && !hasDeposit) return 'Sin cobro';
    if (hasPrice && hasDeposit && deposit > 0 && deposit < price) return 'Parcial';
    if (hasPrice && hasDeposit && deposit > 0 && deposit >= price) return 'Cobrado';
    if (hasDeposit && deposit > 0 && !hasPrice) return 'Cobrado';
    if (paymentMethodLower === 'sinpe' && hasPrice && deposit <= 0) return 'Pendiente SINPE';
    if (hasPrice && deposit <= 0) return 'Pendiente';
    return 'Sin cobro';
  })();

  if (!paymentStatus || paymentStatus === 'Cobrado' || paymentStatus === 'Pendiente' || paymentStatus === 'Pendiente SINPE' || paymentStatus === 'Sin cobro') {
    paymentStatus = derivedStatus;
  }
  if (derivedStatus === 'Parcial' || derivedStatus === 'Pendiente SINPE') paymentStatus = derivedStatus;

  return {
    status: currentStatus || 'Pendiente',
    ...(hasPrice ? { price } : {}),
    ...(hasDeposit ? { deposit } : {}),
    payment_method: paymentMethod,
    payment_status: paymentStatus,
  };
}

async function savePayment(id) {
  const payload = normalizePaymentInputs(id);
  payload.pin = adminPin;

  let response = null;
  try {
    response = await api('/api/admin/payments/' + id, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    response = await api('/api/admin/appointments/' + id, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    });
  }

  const saved = response?.appointment || null;
  const key = String(id);
  paymentCache[key] = {
    price: Number(saved?.price ?? payload.price ?? 0) || 0,
    deposit: Number(saved?.deposit ?? payload.deposit ?? 0) || 0,
    payment_method: String(saved?.payment_method ?? payload.payment_method ?? 'Efectivo').trim() || 'Efectivo',
    payment_status: String(saved?.payment_status ?? payload.payment_status ?? '').trim() || (String(saved?.payment_method ?? payload.payment_method ?? 'Efectivo').toLowerCase() === 'sinpe' ? 'Pendiente SINPE' : 'Cobrado'),
  };
  persistPaymentCache();

  adminAppointments = adminAppointments.map((a) => {
    if (String(a.id) !== key) return a;
    return mergeCachedPayment({
      ...a,
      ...payload,
      ...(saved || {}),
      id: a.id,
    });
  });

  renderBilling();
  renderAdmin();
  renderDashboard(null);
  renderReminders(null);
  alert('Cobro guardado correctamente.');
}

function renderBilling() {
  const el = $('billingList');
  if (!el) return;
  const term = ($('billingSearch')?.value || '').trim().toLowerCase();
  const rows = (adminAppointments || [])
    .filter((a) => !term
      || String(a.name || '').toLowerCase().includes(term)
      || String(a.phone || '').includes(term)
      || String(a.service || '').toLowerCase().includes(term)
      || String(a.professional || '').toLowerCase().includes(term)
      || String(a.date || '').includes(term))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  if ($('billingSummary')) $('billingSummary').innerHTML = billingSummaryCards();

  el.innerHTML = rows.length ? rows.map((a) => {
    const p = paymentValues(a);
    const method = paymentMethod(a);
    const balance = p.balance;
    return `
      <div class="billing-row ${a.status === 'Cancelada' ? 'billing-row-cancelled' : ''}">
        <div class="billing-info">
          <h4>${esc(a.date)} · ${esc(a.time)} — ${esc(a.name)}</h4>
          <p>${esc(a.service)} · ${esc(a.professional)}</p>
          <p>${esc(a.phone)} · ${esc(a.status)}${a.notes ? ' · ' + esc(a.notes) : ''}</p>
          <div class="billing-badges">${paymentBadge(a)}</div>
        </div>
        <div class="billing-form">
          <label>Monto total del servicio<input type="number" min="0" step="1" data-price="${a.id}" value="${p.price || ''}" placeholder="0"></label>
          <label>Monto cobrado<input type="number" min="0" step="1" data-deposit="${a.id}" value="${p.deposit || ''}" placeholder="0"></label>
          <label>Forma de pago<select data-payment-method="${a.id}"><option value="Efectivo" ${method === 'Efectivo' ? 'selected' : ''}>Efectivo</option><option value="SINPE" ${method === 'SINPE' ? 'selected' : ''}>SINPE</option></select></label>
          <label>Estado de cobro<select data-payment-status="${a.id}"><option value="Cobrado" ${paymentState(a) === 'Cobrado' ? 'selected' : ''}>Cobrado</option><option value="Parcial" ${paymentState(a) === 'Parcial' ? 'selected' : ''}>Parcial</option><option value="Pendiente SINPE" ${paymentState(a) === 'Pendiente SINPE' ? 'selected' : ''}>Pendiente SINPE</option><option value="Pendiente" ${paymentState(a) === 'Pendiente' ? 'selected' : ''}>Pendiente</option></select></label>
          <div class="billing-saldo">Saldo: ${fmtMoney(balance)}</div>
          <button class="primary wide" type="button" data-save-payment="${a.id}">Guardar cobro</button>
        </div>
      </div>`;
  }).join('') : '<p>No hay cobros para mostrar.</p>';

  document.querySelectorAll('[data-save-payment]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.savePayment;
      btn.disabled = true;
      try {
        await savePayment(id);
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
      }
    };
  });

  if ($('billingSearch') && !$('billingSearch').dataset.bound) {
    $('billingSearch').dataset.bound = '1';
    $('billingSearch').oninput = () => renderBilling();
  }
}

function renderAdmin() {

  const filteredBase = adminAppointments.filter(apptMatchesFilter);
  const active = filteredBase.filter((a) => a.status !== 'Cancelada').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const cancelled = filteredBase.filter((a) => a.status === 'Cancelada').sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  let html = active.length ? active.map((a) => apptCard(a)).join('') : '<p>No hay citas para este filtro.</p>';
  if (cancelled.length && (appointmentFilter === 'all' || appointmentFilter === 'cancelled')) {
    html += `<details class="cancelled-history"><summary>Ver citas canceladas (${cancelled.length})</summary>${cancelled.map((a) => apptCard(a, true)).join('')}</details>`;
  }
  if ($('appointments')) $('appointments').innerHTML = html;

  document.querySelectorAll('[data-status]').forEach((x) => {
    x.onchange = async () => {
      try {
        const id = x.dataset.status;
        await api('/api/admin/appointments/' + id, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ status: x.value, pin: adminPin }) });
        await loadAdmin();
        setAppointmentFilter(appointmentFilter);
      } catch (e) {
        alert(e.message);
      }
    };
  });

}

if ($('saveSettings')) $('saveSettings').onclick = async () => {
  const btn = $('saveSettings');
  const payload = { open: $('openTime').value, close: $('closeTime').value, slot: +$('slotMinutes').value, professionals: $('pros').value.split('\n').map((x) => x.trim()).filter(Boolean), services: $('servicesCfg').value.split('\n').map((x) => x.trim()).filter(Boolean), pin: adminPin };
  if (!payload.open || !payload.close || payload.open >= payload.close) return alert('Revisa el horario de apertura y cierre.');
  if (!payload.professionals.length) return alert('Debe existir al menos un profesional.');
  if (!payload.services.length) return alert('Debe existir al menos un servicio.');
  btn.disabled = true;
  try {
    await api('/api/admin/config', { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(payload) });
    await loadAdmin();
    await loadConfig();
    alert('Configuración guardada correctamente.');
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
};

if ($('exportBtn')) $('exportBtn').onclick = () => {
  const rows = [['Nombre', 'WhatsApp', 'Servicio', 'Profesional', 'Fecha', 'Hora', 'Estado', 'Forma de pago', 'Total', 'Anticipo', 'Saldo', 'Notas'], ...adminAppointments.map((a) => { const p = paymentValues(a); return [a.name, a.phone, a.service, a.professional, a.date, a.time, a.status, paymentMethod(a), p.price, p.deposit, p.balance, a.notes]; })];
  const csv = rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = u; a.download = 'casa-glam-citas.csv'; a.click(); URL.revokeObjectURL(u);
};

function fmtDate(d) { if (!d) return '—'; try { return new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return d; } }

function renderClients(q = '') {
  const el = $('clientsList');
  if (!el) return;
  const term = q.trim().toLowerCase();
  const rows = adminClients.filter((c) => !term || String(c.name || '').toLowerCase().includes(term) || String(c.phone || '').includes(term));
  el.innerHTML = rows.length ? rows.map((c) => `<div class="client-row"><div><h4>${esc(c.name)}</h4><p>WhatsApp: ${esc(c.phone)}</p><p>${c.appointments || 0} citas · Última visita: ${fmtDate(c.last_visit)} · Próxima: ${fmtDate(c.next_appointment)}</p></div><button type="button" data-client="${c.id}">Ver ficha</button></div>`).join('') : '<p>No se encontraron clientes.</p>';
  document.querySelectorAll('[data-client]').forEach((b) => b.onclick = () => openClient(+b.dataset.client));
}

if ($('clientSearch')) $('clientSearch').oninput = (e) => renderClients(e.target.value);

async function openClient(id) {
  try {
    const d = await api('/api/admin/clients/' + id, { headers: adminHeaders() });
    const c = d.client, h = d.history || [], f = d.followups || [];
    const phone = String(c.phone || '').replace(/\D/g, '').replace(/^506/, '');
    const due = f.filter((x) => x.status === 'Pendiente');
    const detail = $('clientDetail');
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML = `<div class="client-detail"><div class="client-head"><div><p class="eyebrow">FICHA DE CLIENTE</p><h4>${esc(c.name)}</h4><p>${esc(c.phone)} · Cliente desde ${fmtDate((c.created_at || '').slice(0, 10))}</p><p><strong>${h.length}</strong> citas registradas · <strong>${due.length}</strong> seguimientos pendientes</p></div><div class="crm-actions"><a target="_blank" href="https://wa.me/506${phone}">WhatsApp</a><button type="button" id="closeClient">Cerrar</button></div></div><h4>Próximos mantenimientos</h4><div>${f.length ? f.map((x) => { const msg = `Hola ${c.name} 👋 Te escribimos de Casa Glam. Según tu historial, ya se acerca el momento recomendado para tu ${x.service}. ¿Deseas que te ayudemos a reservar tu próxima cita?`; return `<div class="followup-card"><strong>${esc(x.service)}</strong><p>Realizado: ${fmtDate(x.service_date)} · Recordar: <span class="followup-due">${fmtDate(x.due_date)}</span></p>${x.notes ? `<p>${esc(x.notes)}</p>` : ''}<div class="crm-actions"><a target="_blank" href="https://wa.me/506${phone}?text=${encodeURIComponent(msg)}">Recordar por WhatsApp</a><button data-followup-done="${x.id}">Marcar realizado</button></div></div>`; }).join('') : '<p>Aún no hay mantenimientos programados.</p>'}</div><h4>Agregar seguimiento</h4><div class="crm-form"><label>Servicio<input id="fuService" value=""></label><label>Fecha realizada<input id="fuDate" type="date" value="${todayISO()}"></label><label>Recordar en<select id="fuMonths"><option value="1">1 mes</option><option value="2">2 meses</option><option value="3" selected>3 meses</option><option value="4">4 meses</option><option value="6">6 meses</option></select></label><label>Fecha recomendada<input id="fuDue" type="date"></label><label class="wide">Notas<input id="fuNotes" placeholder="Ej: Keratina, fórmula, tono, observaciones..."></label><button class="primary wide" id="saveFollowup" type="button">Guardar seguimiento</button></div><h4>Historial de citas</h4><div class="client-history">${h.length ? h.map((a) => `<div class="history-item"><strong>${fmtDate(a.date)} · ${esc(a.service)}</strong><p>${esc(a.professional)} · ${esc(a.status)}${a.payment_method ? ' · ' + esc(a.payment_method) : ''}${a.price ? ' · ' + fmtMoney(a.price) : ''}${a.deposit ? ' · Anticipo ' + fmtMoney(a.deposit) : ''}${a.notes ? ' · ' + esc(a.notes) : ''}</p></div>`).join('') : '<p>Sin historial.</p>'}</div></div>`;
    $('closeClient').onclick = () => { detail.hidden = true; };
    const calcDue = () => { const base = $('fuDate').value; if (!base) return; const dt = new Date(base + 'T12:00:00'); dt.setMonth(dt.getMonth() + (+$('fuMonths').value || 3)); $('fuDue').value = dt.toISOString().slice(0, 10); };
    $('fuDate').onchange = calcDue; $('fuMonths').onchange = calcDue; calcDue();
    $('saveFollowup').onclick = async () => { const payload = { service: $('fuService').value.trim(), service_date: $('fuDate').value, due_date: $('fuDue').value, notes: $('fuNotes').value.trim() }; if (!payload.service || !payload.service_date || !payload.due_date) return alert('Completa servicio y fechas.'); await api('/api/admin/clients/' + id + '/followups', { method: 'POST', headers: adminHeaders(), body: JSON.stringify(payload) }); await openClient(id); };
    document.querySelectorAll('[data-followup-done]').forEach((b) => b.onclick = async () => { await api('/api/admin/followups/' + b.dataset.followupDone, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ status: 'Realizado' }) }); await openClient(id); });
  } catch (e) { alert(e.message); }
}

document.querySelectorAll('[data-appt-filter]').forEach((btn) => { btn.onclick = () => setAppointmentFilter(btn.dataset.apptFilter); });
loadConfig();
if (adminPin) login();

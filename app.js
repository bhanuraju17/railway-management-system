(() => {
'use strict';

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2, '0');
const fmt = m => { m = Math.round(m) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
const fmtDur = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h} h ${pad(m % 60)} min` : `${m} min`; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const setHTML = (el, html) => { if (el._h !== html) { el._h = html; el.innerHTML = html; } };
const NS = 'http://www.w3.org/2000/svg';

/* ---------- network model ---------- */
const ST = ['Kavali', 'Nellore', 'Gudur', 'Tirupati', 'Chennai'];
const KM = [0, 42, 83, 183, 328];               // approximate distance of each station from Kavali, in km
const SIM = 2;                                   // simulated minutes per tick
const MINGAP = 25;                               // minimum km between trains on the same track

const CLASSES = [
  { key: 'first',  name: 'First class',  short: 'First',  prefix: 'F', mult: 2.5 },
  { key: 'chair',  name: 'Chair car',    short: 'Chair',  prefix: 'C', mult: 1.6 },
  { key: 'second', name: 'Second class', short: 'Second', prefix: 'S', mult: 1 }
];
const CLS = Object.fromEntries(CLASSES.map(c => [c.key, c]));
const splitSeats = total => {
  const first = Math.max(1, Math.round(total * 0.1)), chair = Math.max(1, Math.round(total * 0.3));
  return { first, chair, second: Math.max(1, total - first - chair) };
};
const seatsTotal = t => t.cap.first + t.cap.chair + t.cap.second;

/* ---------- ticket storage ---------- */
const KEY = 'rms-bookings-v2';
const loadB = () => {
  try {
    const a = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(a) ? a.filter(b => b && Array.isArray(b.passengers) && Array.isArray(b.seatNos)) : [];
  } catch (e) { return []; }
};
const saveB = () => { try { localStorage.setItem(KEY, JSON.stringify(bookings)); } catch (e) { /* storage unavailable */ } };
const SESSION = Math.random().toString(36).slice(2, 10);   // seats only count for tickets booked in this page load
const bookings = loadB();
bookings.forEach(b => { if (b.status === 'Confirmed') b.status = 'Completed'; });   // the trains restart on every page load
saveB();

let simTime = 6 * 60;
let speedMult = 1;
let timer = null;
let nextId = 1;
let activeTab = 'live';
const trains = [];
const logs = [];

function nextStopFrom(pos, dir) {
  if (dir > 0) { for (let i = 0; i < KM.length; i++) if (KM[i] > pos) return i; }
  else { for (let i = KM.length - 1; i >= 0; i--) if (KM[i] < pos) return i; }
  return null;
}

function makeTrain({ no, name, from, to, pos, speed, seats, atStation, dwell = 1 }) {
  const dir = to > from ? 1 : -1;
  const t = { id: nextId++, no, name, from, to, dir, speed, cap: splitSeats(seats), run: 1,
              delay: 0, dwell: 0, state: 'Running', reason: '', atStation: null, nextStop: null, pos: 0 };
  if (atStation != null) {
    t.atStation = atStation; t.pos = KM[atStation]; t.dwell = dwell; t.state = 'Boarding'; t.nextStop = atStation + dir;
  } else {
    t.pos = pos; t.nextStop = nextStopFrom(pos, dir);
  }
  return t;
}

trains.push(
  makeTrain({ no: '12001', name: 'Coastal Express', from: 0, to: 4, atStation: 0, dwell: 20, speed: 90, seats: 120 }),
  makeTrain({ no: '12002', name: 'Harbour Mail',    from: 4, to: 0, pos: 260, speed: 85, seats: 120 }),
  makeTrain({ no: '22110', name: 'Valley Local',    from: 1, to: 3, pos: 60,  speed: 60, seats: 80 }),
  makeTrain({ no: '22111', name: 'Gudur Shuttle',   from: 2, to: 0, pos: 70,  speed: 60, seats: 80 })
);

const byId = id => trains.find(t => t.id === id);

function log(msg, type = '') {
  logs.unshift({ time: simTime, msg, type });
  if (logs.length > 60) logs.pop();
  renderLog();
}

/* ---------- routes and ETAs ---------- */
function pathAhead(t) {
  if (t.atStation !== null && t.atStation === t.to) return [t.atStation];
  const p = [];
  let i;
  if (t.atStation !== null) { p.push(t.atStation); i = t.atStation + t.dir; } else { i = t.nextStop; }
  for (;; i += t.dir) { p.push(i); if (i === t.to) break; }
  return p;
}

function runPath(t) {                                     // every station on the current run, in order
  const p = [];
  for (let i = t.from; ; i += t.dir) { p.push(i); if (i === t.to) break; }
  return p;
}

function etaTo(t, s) {
  const p = pathAhead(t);
  const idx = p.indexOf(s);
  if (idx < 0) return null;
  const atSt = t.atStation !== null;
  const dist = Math.abs(KM[s] - t.pos);
  const between = atSt ? Math.max(0, idx - 1) : idx;
  return dist / t.speed * 60 + between * SIM + (atSt ? t.dwell * SIM : 0);
}

function whereIs(t) {
  if (t.atStation !== null) return 'At ' + ST[t.atStation];
  return 'Between ' + ST[t.nextStop - t.dir] + ' and ' + ST[t.nextStop];
}

function statusFor(t, s) {
  if (t.state === 'Held') return { txt: 'Held', cls: 'st-bad' };
  if (t.atStation === s) return t.atStation === t.to ? { txt: 'Arrived', cls: 'st-ok' } : { txt: 'Boarding', cls: 'st-late' };
  if (t.delay > 5) return { txt: 'Delayed ' + Math.round(t.delay) + ' min', cls: 'st-late' };
  return { txt: 'On time', cls: 'st-ok' };
}

/* ---------- seats ---------- */
// A seat is taken for a journey if a confirmed ticket on the same run overlaps it.
// A seat booked for only part of the route stays free for the rest.
function bookedSeats(t, cls, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b), set = new Set();
  for (const k of bookings) {
    if (k.session !== SESSION || k.trainNo !== t.no || k.run !== t.run || k.status === 'Cancelled' || k.cls !== cls) continue;
    const l = Math.min(k.from, k.to), h = Math.max(k.from, k.to);
    if (l < hi && lo < h) k.seatNos.forEach(s => set.add(s));
  }
  return set;
}
const freeSeats = (t, cls, a, b) => t.cap[cls] - bookedSeats(t, cls, a, b).size;
const freeTotal = (t, a, b) => CLASSES.reduce((n, c) => n + freeSeats(t, c.key, a, b), 0);

function allocate(t, cls, a, b, n) {
  const taken = bookedSeats(t, cls, a, b), out = [];
  for (let i = 1; i <= t.cap[cls] && out.length < n; i++) {
    const label = CLS[cls].prefix + i;
    if (!taken.has(label)) out.push(label);
  }
  return out.length === n ? out : null;
}

function fareFor(a, b, mult, n) { return Math.abs(KM[b] - KM[a]) * 1.15 * mult * n; }

function completeAt(t, s) {                               // passengers whose journey ends at this station have arrived
  let n = 0;
  for (const k of bookings) if (k.session === SESSION && k.trainNo === t.no && k.run === t.run && k.status === 'Confirmed' && k.to === s) { k.status = 'Completed'; n++; }
  if (n) { saveB(); log(`${n} ticket${n > 1 ? 's' : ''} completed at ${ST[s]} on ${t.no}`, 'good'); refreshTicketViews(); }
}

/* ---------- signalling and movement ---------- */
function leadDist(t) {
  let best = Infinity;
  for (const o of trains) {
    if (o === t || o.dir !== t.dir) continue;
    const d = (o.pos - t.pos) * t.dir;
    if (d > 0 || (d === 0 && o.id < t.id)) best = Math.min(best, Math.max(d, 0));
  }
  return best;
}

function hold(t, reason) {
  if (t.state !== 'Held') log(`${t.no} ${t.name} held: ${reason}`, 'warn');
  t.state = 'Held'; t.reason = reason; t.delay += SIM;
}

function release(t) {
  if (t.state === 'Held') log(`${t.no} ${t.name} is moving again`, 'good');
  t.state = 'Running'; t.reason = '';
}

function tick() {
  simTime += SIM;
  for (const t of trains) {
    if (t.dwell > 0) {
      t.dwell--;
      t.state = t.atStation === t.to ? 'Terminating' : 'Boarding';
      if (t.dwell > 0) continue;
    }
    if (t.atStation !== null) {
      const s = t.atStation;
      if (s === t.to) {                                   // end of run: turn round for the next run
        [t.from, t.to] = [t.to, t.from];
        t.dir = -t.dir; t.nextStop = s + t.dir; t.delay = 0; t.run++;
      }
      if (leadDist(t) < MINGAP) { hold(t, 'waiting for the section ahead to clear'); continue; }
      if (s === t.from) log(`${t.no} ${t.name} departed ${ST[s]} for ${ST[t.to]}`);
      release(t);
      t.atStation = null;
    }
    if (leadDist(t) < MINGAP) { hold(t, 'signal red, train ahead'); continue; }
    release(t);
    const step = t.speed * SIM / 60;
    const target = KM[t.nextStop];
    if ((target - (t.pos + t.dir * step)) * t.dir <= 0) {
      t.pos = target; t.atStation = t.nextStop;
      if (t.atStation === t.to) {
        t.dwell = 4; t.state = 'Terminating';
        log(`${t.no} ${t.name} arrived at ${ST[t.to]}`, 'good');
      } else { t.dwell = 1; t.state = 'Boarding'; t.nextStop += t.dir; }
      completeAt(t, t.atStation);
    } else {
      t.pos += t.dir * step;
    }
  }
  renderAll();
}

/* ---------- map ---------- */
const X0 = 70, XW = 860, Y_UP = 104, Y_DN = 146;
const xOf = km => X0 + km / KM[KM.length - 1] * XW;

function buildMap() {
  let s = '';
  for (const y of [Y_UP, Y_DN]) {
    s += `<line x1="${X0}" x2="${X0 + XW}" y1="${y}" y2="${y}" stroke="var(--track)" stroke-width="8"/>
          <line x1="${X0}" x2="${X0 + XW}" y1="${y}" y2="${y}" stroke="var(--panel)" stroke-width="2" stroke-dasharray="5 7"/>`;
  }
  s += `<text class="maplabel" x="${X0 + 10}" y="${Y_UP - 24}">Toward ${ST[ST.length - 1]}</text>
        <text class="maplabel" x="${X0 + 10}" y="${Y_DN + 38}">Toward ${ST[0]}</text>`;
  ST.forEach((name, i) => {
    const x = xOf(KM[i]);
    s += `<rect x="${x - 7}" y="${Y_UP - 14}" width="14" height="${Y_DN - Y_UP + 28}" rx="4" fill="var(--panel)" stroke="var(--ink)" stroke-width="2"/>
          <text class="stname" x="${x}" y="${Y_DN + 66}" text-anchor="middle">${esc(name)}</text>
          <text class="stkm" x="${x}" y="${Y_DN + 84}" text-anchor="middle">km ${KM[i]}</text>`;
  });
  $('#map').innerHTML = s + '<g id="trainLayer"></g>';
}

function syncTrains() {
  const layer = $('#trainLayer');
  const ms = Math.round(1000 / speedMult);
  for (const t of trains) {
    let g = layer.querySelector(`[data-id="${t.id}"]`);
    const y = t.dir > 0 ? Y_UP : Y_DN;
    const tf = `translate(${xOf(t.pos)}px,${y}px)`;
    if (!g) {
      g = document.createElementNS(NS, 'g');
      g.dataset.id = t.id;
      g.innerHTML = `<path class="body"></path><text class="num" dy="4">${esc(t.no)}</text><title></title>`;
      g.style.transform = tf;
      layer.appendChild(g);
    }
    g.style.transition = `transform ${ms}ms linear`;
    g.style.transform = tf;
    const cls = t.state === 'Held' ? 'held' : (t.state === 'Boarding' || t.state === 'Terminating') ? 'board' : 'run';
    g.setAttribute('class', 'train ' + cls);
    $('.body', g).setAttribute('d', t.dir > 0
      ? 'M-24,-11 H24 L34,0 L24,11 H-24 Z'
      : 'M24,-11 H-24 L-34,0 L-24,11 H24 Z');
    $('title', g).textContent = `${t.no} ${t.name}: ${t.state === 'Held' ? 'held, ' + t.reason : whereIs(t)}`;
  }
}

/* ---------- renderers: board, log, timetable ---------- */
function renderStats() {
  const run = trains.filter(t => t.state === 'Running').length;
  const stn = trains.filter(t => t.state === 'Boarding' || t.state === 'Terminating').length;
  const held = trains.filter(t => t.state === 'Held').length;
  $('#stats').textContent = `${trains.length} trains on the line: ${run} running, ${stn} at stations, ${held} held.`;
  $('#clock').textContent = fmt(simTime);
}

function renderLog() {
  setHTML($('#log'), logs.slice(0, 14).map(l => `<li class="${l.type}"><time>${fmt(l.time)}</time>${esc(l.msg)}</li>`).join('') ||
    '<li>No events yet.</li>');
}

const tiles = str => [...str].map(c => `<span class="tile">${esc(c)}</span>`).join('');

function renderBoard() {
  const s = +$('#bdStation').value;
  const rows = trains.map(t => ({ t, eta: etaTo(t, s) })).filter(r => r.eta !== null).sort((a, b) => a.eta - b.eta);
  setHTML($('#boardBody'), rows.length ? rows.map(({ t, eta }) => {
    const st = statusFor(t, s);
    const due = t.atStation === s ? fmt(simTime) : fmt(simTime + eta);
    return `<tr><td>${tiles(due)}</td><td>${tiles(String(t.dir > 0 ? 1 : 2))}</td>
      <td>${esc(t.no)} ${esc(t.name)}</td><td>${esc(ST[t.to])}</td><td class="${st.cls}">${esc(st.txt)}</td></tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">No trains are due at ${esc(ST[s])} on their current run.</td></tr>`);
}

function renderTimetable() {
  setHTML($('#ttBody'), trains.map(t => {
    const p = pathAhead(t);
    const ns = t.atStation !== null ? (p.length > 1 ? p[1] : null) : p[0];
    const next = ns === null ? 'End of run' : `${ST[ns]} at ${fmt(simTime + etaTo(t, ns))}`;
    const pill = t.state === 'Held' ? `<span class="pill bad">Held</span> ${esc(t.reason)}`
      : t.delay > 5 ? `<span class="pill warn">Delayed ${Math.round(t.delay)} min</span>` : `<span class="pill ok">On time</span>`;
    return `<tr><td class="num">${esc(t.no)}</td><td>${esc(t.name)}</td><td>${esc(ST[t.from])} to ${esc(ST[t.to])}</td>
      <td>${esc(whereIs(t))}</td><td>${esc(next)}</td><td>${pill}</td><td class="num">${freeTotal(t, t.from, t.to)} of ${seatsTotal(t)}</td></tr>`;
  }).join(''));
}

/* ---------- find a train ---------- */
function journeyFor(t, f, g) {                            // f and g are station indexes or null
  const p = runPath(t);
  const a = f === null ? t.from : f, b = g === null ? t.to : g;
  const ia = p.indexOf(a), ib = p.indexOf(b);
  return ia >= 0 && ib > ia ? { a, b, ia, ib } : null;
}

function renderFind() {
  const q = $('#fdQ').value.trim().toLowerCase();
  const f = $('#fdFrom').value === '' ? null : +$('#fdFrom').value;
  const g = $('#fdTo').value === '' ? null : +$('#fdTo').value;
  const body = $('#fdBody'), count = $('#fdCount');
  if (f !== null && g !== null && f === g) {
    count.textContent = '';
    setHTML(body, '<tr><td colspan="8" class="empty">Choose two different stations.</td></tr>');
    return;
  }
  const rows = [];
  for (const t of trains) {
    if (q && !`${t.no} ${t.name}`.toLowerCase().includes(q)) continue;
    let j = journeyFor(t, f, g); if (!j) continue;
    const p = pathAhead(t);
    if (f === null && !p.includes(j.a) && p.includes(j.b)) {   // no From chosen and the train has left its origin: start at the next stop
      const rp = runPath(t), ia = rp.indexOf(p[0]);
      if (ia < j.ib) j = { a: p[0], b: j.b, ia, ib: j.ib };
    }
    const free = CLASSES.map(c => freeSeats(t, c.key, j.a, j.b));
    rows.push({
      t, j, free, total: free.reduce((x, y) => x + y, 0),
      leave: p.includes(j.a) ? etaTo(t, j.a) : null,
      arrive: p.includes(j.b) ? etaTo(t, j.b) : null,
      dur: Math.abs(KM[j.b] - KM[j.a]) / t.speed * 60 + (j.ib - j.ia - 1) * SIM
    });
  }
  const sort = $('#fdSort').value;
  rows.sort((x, y) => {
    if (sort === 'duration') return x.dur - y.dur;
    if (sort === 'seats') return y.total - x.total;
    const lx = x.leave === null ? Infinity : x.leave, ly = y.leave === null ? Infinity : y.leave;
    return lx === ly ? 0 : lx - ly;
  });
  count.textContent = rows.length ? `${rows.length} train${rows.length === 1 ? '' : 's'} found.` : '';
  setHTML(body, rows.length ? rows.map(r => {
    const { t, j } = r, gone = r.leave === null;
    const pill = gone ? '<span class="pill mute">Already left</span>'
      : t.state === 'Held' ? '<span class="pill bad">Held</span>'
      : t.delay > 5 ? `<span class="pill warn">Delayed ${Math.round(t.delay)} min</span>`
      : '<span class="pill ok">On time</span>';
    const seats = CLASSES.map((c, i) => `<span class="${r.free[i] === 0 ? 'zero' : ''}">${c.short} <b>${r.free[i]}</b></span>`).join('');
    const data = `data-id="${t.id}" data-a="${j.a}" data-b="${j.b}"`;
    return `<tr><td><strong class="num">${esc(t.no)}</strong><br><span class="hint">${esc(t.name)}</span></td>
      <td>${esc(ST[j.a])} to ${esc(ST[j.b])}</td>
      <td class="num">${gone ? 'Left' : fmt(simTime + r.leave)}</td>
      <td class="num">${r.arrive === null ? 'Arrived' : fmt(simTime + r.arrive)}</td>
      <td class="num">${fmtDur(r.dur)}</td><td>${pill}</td>
      <td><div class="free">${seats}</div></td>
      <td style="white-space:nowrap"><button class="btn small" type="button" data-act="book" ${data}${gone || r.total === 0 ? ' disabled' : ''}>Book</button>
        <button class="btn small ghost" type="button" data-act="seats" ${data}>Seats</button></td></tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">No trains match. Try other stations, or clear the search.</td></tr>');
}

$('#fdBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const id = +b.dataset.id, a = +b.dataset.a, z = +b.dataset.b;
  if (b.dataset.act === 'book') openBooking(id, a, z); else openSeats(id, a, z);
});
['fdQ', 'fdFrom', 'fdTo', 'fdSort'].forEach(id => ['input', 'change'].forEach(ev => $('#' + id).addEventListener(ev, renderFind)));
$('#fdForm').addEventListener('submit', e => e.preventDefault());
$('#fdClear').addEventListener('click', () => {
  $('#fdQ').value = ''; $('#fdFrom').value = ''; $('#fdTo').value = ''; $('#fdSort').value = 'depart';
  renderFind(); $('#fdQ').focus();
});

/* ---------- seat availability ---------- */
const opts = (list, sel) => list.map(i => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(ST[i])}</option>`).join('');

function fillSeatTrains() {
  const sel = $('#stTrain'), cur = sel.value;
  sel.innerHTML = trains.map(t => `<option value="${t.id}">${esc(t.no)} ${esc(t.name)}</option>`).join('');
  if (cur && byId(+cur)) sel.value = cur;
  fillSeatFrom();
}

function fillSeatFrom() {
  const t = byId(+$('#stTrain').value); if (!t) return;
  const list = runPath(t).slice(0, -1);
  const cur = $('#stFrom').value === '' ? null : +$('#stFrom').value;
  $('#stFrom').innerHTML = opts(list, list.includes(cur) ? cur : list[0]);
  fillSeatTo();
}

function fillSeatTo() {
  const t = byId(+$('#stTrain').value); if (!t) return;
  const p = runPath(t), from = +$('#stFrom').value;
  const list = p.slice(p.indexOf(from) + 1);
  const cur = $('#stTo').value === '' ? null : +$('#stTo').value;
  $('#stTo').innerHTML = opts(list, list.includes(cur) ? cur : list[list.length - 1]);
  renderSeats();
}

function renderSeats() {
  const t = byId(+$('#stTrain').value); if (!t) return;
  const p = runPath(t);
  const a = $('#stFrom').value === '' ? -1 : +$('#stFrom').value;
  const b = $('#stTo').value === '' ? -1 : +$('#stTo').value;
  const ia = p.indexOf(a), ib = p.indexOf(b);
  if (!(ia >= 0 && ib > ia)) {                            // the train has turned round, so reset the journey
    $('#stFrom').innerHTML = ''; $('#stTo').innerHTML = '';
    fillSeatFrom(); return;
  }
  $('#stRun').textContent = `Current run: ${ST[t.from]} to ${ST[t.to]}. Counts are for ${ST[a]} to ${ST[b]}. A seat booked for only part of the route stays free for the rest.`;
  setHTML($('#stBody'), CLASSES.map(c => {
    const cap = t.cap[c.key], booked = bookedSeats(t, c.key, a, b).size, free = cap - booked;
    const low = free > 0 && free / cap <= 0.15;
    const pill = free === 0 ? '<span class="pill bad">Full</span>' : low ? '<span class="pill warn">Few left</span>' : '<span class="pill ok">Available</span>';
    return `<tr><td>${c.name}</td><td class="num">${cap}</td><td class="num">${booked}</td><td class="num"><b>${free}</b></td>
      <td class="num">${fareFor(a, b, c.mult, 1).toFixed(2)}</td>
      <td>${pill}<div class="bar ${free === 0 ? 'none' : low ? 'low' : ''}" aria-hidden="true"><span style="width:${Math.round(free / cap * 100)}%"></span></div></td></tr>`;
  }).join(''));
  setHTML($('#seatBlocks'), CLASSES.map(c => {
    const set = bookedSeats(t, c.key, a, b), cap = t.cap[c.key];
    let seats = '';
    for (let i = 1; i <= cap; i++) {
      const label = c.prefix + i, taken = set.has(label);
      seats += `<span class="seat${taken ? ' taken' : ''}" role="img" aria-label="Seat ${label}, ${taken ? 'booked' : 'free'}" title="${label}, ${taken ? 'booked' : 'free'}">${i}</span>`;
      if (i % 4 === 2) seats += '<span class="aisle"></span>';
    }
    return `<div><h3>${c.name}</h3><p class="hint">${cap - set.size} free of ${cap}. Seat numbers start with ${c.prefix}.</p><div class="seatgrid">${seats}</div></div>`;
  }).join(''));
}

$('#stTrain').addEventListener('change', () => { $('#stFrom').innerHTML = ''; $('#stTo').innerHTML = ''; fillSeatFrom(); });
$('#stFrom').addEventListener('change', fillSeatTo);
$('#stTo').addEventListener('change', renderSeats);
$('#stForm').addEventListener('submit', e => e.preventDefault());
$('#stBook').addEventListener('click', () => openBooking(+$('#stTrain').value, +$('#stFrom').value, +$('#stTo').value));

/* ---------- booking ---------- */
const GENDERS = ['Female', 'Male', 'Other'];

function fillTrainSelect() {
  const sel = $('#bkTrain'), cur = sel.value;
  sel.innerHTML = trains.map(t => `<option value="${t.id}">${esc(t.no)} ${esc(t.name)}, ${esc(ST[t.from])} to ${esc(ST[t.to])}</option>`).join('');
  if (cur && byId(+cur)) sel.value = cur;
  fillStops();
}

function fillStops() {
  const t = byId(+$('#bkTrain').value); if (!t) return;
  const list = pathAhead(t).slice(0, -1);
  const cur = $('#bkFrom').value === '' ? null : +$('#bkFrom').value;
  $('#bkFrom').innerHTML = list.length ? opts(list, list.includes(cur) ? cur : list[0]) : '<option value="">No stops ahead</option>';
  fillDest();
}

function fillDest() {
  const t = byId(+$('#bkTrain').value); if (!t) return;
  const fv = $('#bkFrom').value;
  const p = pathAhead(t);
  const i = fv === '' ? -1 : p.indexOf(+fv);
  const list = i >= 0 ? p.slice(i + 1) : [];
  const cur = $('#bkTo').value === '' ? null : +$('#bkTo').value;
  $('#bkTo').innerHTML = list.length ? opts(list, list.includes(cur) ? cur : list[list.length - 1]) : '<option value="">None</option>';
  updateBk();
}

function updateBk() {
  const t = byId(+$('#bkTrain').value);
  const info = $('#bkInfo'), btn = $('#bkSubmit');
  if (!t) return;
  const from = $('#bkFrom').value, to = $('#bkTo').value;
  if (from === '' || to === '') { info.textContent = 'This train has no more stops open for booking on its current run.'; btn.disabled = true; return; }
  const a = +from, b = +to, cls = $('#bkClass').value;
  const n = clamp(Math.floor(+$('#bkSeats').value) || 1, 1, 6);
  $$('#bkClass option').forEach(o => {
    const txt = `${CLS[o.value].name} (${freeSeats(t, o.value, a, b)} free)`;
    if (o.textContent !== txt) o.textContent = txt;
  });
  const free = freeSeats(t, cls, a, b);
  info.textContent = `${free} ${CLS[cls].name.toLowerCase()} seat${free === 1 ? '' : 's'} free for this journey. Total fare ${fareFor(a, b, CLS[cls].mult, n).toFixed(2)}.` +
    (free < n ? ' Reduce the number of seats or choose another class.' : '');
  btn.disabled = free < n;
}

function paxRowHtml(i, p) {
  return `<div class="paxrow" role="group" aria-label="Passenger ${i + 1}">
    <div class="paxtitle">Passenger ${i + 1}</div>
    <label>Full name<input class="pn" maxlength="40" autocomplete="off" value="${esc(p.name)}"></label>
    <label>Age<input class="pa" type="number" min="1" max="120" value="${esc(p.age)}"></label>
    <label>Gender<select class="pg"><option value=""${p.gender ? '' : ' selected'}>Select</option>${GENDERS.map(g => `<option${p.gender === g ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
  </div>`;
}
const readPax = () => $$('#bkPax .paxrow').map(r => ({ name: $('.pn', r).value, age: $('.pa', r).value, gender: $('.pg', r).value }));
function renderPaxRows(reset = false) {
  const n = clamp(Math.floor(+$('#bkSeats').value) || 1, 1, 6);
  const old = reset ? [] : readPax();
  $('#bkPax').innerHTML = Array.from({ length: n }, (_, i) => paxRowHtml(i, old[i] || { name: '', age: '', gender: '' })).join('');
}

$('#bkTrain').addEventListener('change', fillStops);
$('#bkFrom').addEventListener('change', fillDest);
['bkTo', 'bkClass'].forEach(id => $('#' + id).addEventListener('change', updateBk));
$('#bkSeats').addEventListener('input', () => { renderPaxRows(); updateBk(); });

function openBooking(id, a, z) {
  show('book');
  $('#bkTrain').value = String(id); fillStops();
  const t = byId(id); if (!t) return;
  const p = pathAhead(t), starts = p.slice(0, -1);
  if (starts.length) {
    const from = starts.includes(a) ? a : starts[0];
    $('#bkFrom').value = String(from); fillDest();
    if (p.slice(p.indexOf(from) + 1).includes(z)) { $('#bkTo').value = String(z); updateBk(); }
  }
  const first = $('#bkPax .pn'); if (first) first.focus();
}

function openSeats(id, a, z) {
  show('seats');
  $('#stTrain').value = String(id);
  $('#stFrom').innerHTML = ''; $('#stTo').innerHTML = '';
  fillSeatFrom();
  const p = runPath(byId(id));
  if (p.slice(0, -1).includes(a)) {
    $('#stFrom').value = String(a); fillSeatTo();
    if (p.slice(p.indexOf(a) + 1).includes(z)) { $('#stTo').value = String(z); renderSeats(); }
  }
}

$('#bkForm').addEventListener('submit', e => {
  e.preventDefault();
  const msg = $('#bkMsg');
  const err = m => { msg.className = 'msg err'; msg.textContent = m; };
  const t = byId(+$('#bkTrain').value); if (!t) return err('Choose a train.');
  const cls = $('#bkClass').value, n = Math.floor(+$('#bkSeats').value);
  if (!(n >= 1 && n <= 6)) return err('You can book 1 to 6 seats at a time.');
  const pax = readPax();
  for (let i = 0; i < pax.length; i++) {
    const p = pax[i], who = 'Passenger ' + (i + 1);
    if (!p.name.trim()) return err(`${who}: enter a name.`);
    const age = Math.floor(+p.age);
    if (!(age >= 1 && age <= 120)) return err(`${who}: enter an age between 1 and 120.`);
    if (!p.gender) return err(`${who}: choose a gender.`);
  }
  const phone = $('#bkPhone').value.trim(), email = $('#bkEmail').value.trim();
  if (!/^\d{7,15}$/.test(phone.replace(/[\s()+-]/g, ''))) return err('Enter a phone number with 7 to 15 digits.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Enter a valid email address, or leave it empty.');
  const p = pathAhead(t), from = +$('#bkFrom').value, to = +$('#bkTo').value;
  if ($('#bkFrom').value === '' || !p.includes(from) || !p.includes(to) || p.indexOf(to) <= p.indexOf(from)) {
    fillStops(); return err('The train has moved on. Check the stations and try again.');
  }
  const seatNos = allocate(t, cls, from, to, n);
  if (!seatNos) return err(`Only ${freeSeats(t, cls, from, to)} ${CLS[cls].name.toLowerCase()} seats are free for this journey.`);
  let pnr; do { pnr = String(Math.floor(1e9 + Math.random() * 9e9)); } while (bookings.some(k => k.pnr === pnr));
  const k = {
    pnr, trainNo: t.no, trainName: t.name, run: t.run, from, to, cls, seatNos, seats: n,
    passengers: pax.map(x => ({ name: x.name.trim(), age: Math.floor(+x.age), gender: x.gender })),
    phone, email, fare: fareFor(from, to, CLS[cls].mult, n), status: 'Confirmed', time: simTime, session: SESSION
  };
  bookings.unshift(k); saveB();
  log(`Ticket ${k.pnr} confirmed for ${k.passengers[0].name}${n > 1 ? ' and ' + (n - 1) + ' more' : ''} on ${t.no}`, 'good');
  msg.className = 'msg ok'; msg.textContent = `Booked. Ticket number ${k.pnr}, seat${n > 1 ? 's' : ''} ${seatNos.join(', ')}.`;
  $('#bkSeats').value = 1; $('#bkPhone').value = ''; $('#bkEmail').value = '';
  renderPaxRows(true);
  refreshTicketViews(); renderAll();
});

/* ---------- tickets ---------- */
const statusPill = s => `<span class="pill ${s === 'Confirmed' ? 'ok' : 'mute'}">${esc(s)}</span>`;

function renderBookings() {
  const q = $('#bkSearch').value.trim().toLowerCase();
  const list = bookings.filter(k => !q || [k.pnr, k.phone, ...k.passengers.map(p => p.name)].join(' ').toLowerCase().includes(q));
  setHTML($('#bkList'), list.length ? list.map(k => `
    <div class="ticket">
      <div class="tkhead">
        <strong>${esc(k.passengers[0].name)}${k.passengers.length > 1 ? ' and ' + (k.passengers.length - 1) + ' more' : ''}</strong>
        ${statusPill(k.status)}
      </div>
      <div>${esc(k.trainNo)} ${esc(k.trainName)}: ${esc(ST[k.from])} to ${esc(ST[k.to])}</div>
      <div class="hint">Ticket ${esc(k.pnr)}. ${esc(CLS[k.cls] ? CLS[k.cls].name : k.cls)}, fare ${Number(k.fare).toFixed(2)}, booked at ${fmt(k.time)}.</div>
      <ul class="paxlist">${k.passengers.map((p, i) => `<li>${esc(p.name)}, ${p.age}, ${esc(p.gender)}, seat ${esc(k.seatNos[i] || '')}</li>`).join('')}</ul>
      <div class="hint">Contact: ${esc(k.phone)}${k.email ? ', ' + esc(k.email) : ''}</div>
      ${k.status === 'Confirmed' ? `<div style="margin-top:10px"><button class="btn small ghost" data-cancel="${esc(k.pnr)}" type="button">Cancel ticket</button></div>` : ''}
    </div>`).join('') : '<p class="empty">No tickets found. Confirm a booking to see the ticket here.</p>');
}

$('#bkList').addEventListener('click', e => {
  const b = e.target.closest('[data-cancel]'); if (!b) return;
  const k = bookings.find(x => x.pnr === b.dataset.cancel); if (!k) return;
  k.status = 'Cancelled'; saveB();
  log(`Ticket ${k.pnr} cancelled, ${k.seats} seat${k.seats > 1 ? 's' : ''} released`, 'warn');
  refreshTicketViews(); renderAll();
});
$('#bkSearch').addEventListener('input', renderBookings);

/* ---------- passenger details ---------- */
function fillManifestTrains() {
  const sel = $('#pxTrain'), cur = sel.value || 'all';
  sel.innerHTML = '<option value="all">All trains</option>' + trains.map(t => `<option value="${esc(t.no)}">${esc(t.no)} ${esc(t.name)}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
}

function renderManifest() {
  const tno = $('#pxTrain').value, st = $('#pxStatus').value, q = $('#pxQ').value.trim().toLowerCase();
  const rows = [];
  for (const k of bookings) {
    if ((tno !== 'all' && k.trainNo !== tno) || (st === 'Confirmed' && k.status !== 'Confirmed')) continue;
    k.passengers.forEach((p, i) => {
      const seat = k.seatNos[i] || '';
      if (q && ![p.name, k.pnr, k.phone, seat].join(' ').toLowerCase().includes(q)) return;
      rows.push({ k, p, seat });
    });
  }
  const tickets = new Set(rows.map(r => r.k.pnr)).size;
  $('#pxCount').textContent = rows.length ? `${rows.length} passenger${rows.length === 1 ? '' : 's'} on ${tickets} ticket${tickets === 1 ? '' : 's'}.` : '';
  setHTML($('#pxBody'), rows.length ? rows.map(({ k, p, seat }) => `<tr>
      <td>${esc(p.name)}</td><td class="num">${p.age}</td><td>${esc(p.gender)}</td>
      <td>${esc(CLS[k.cls] ? CLS[k.cls].short : k.cls)} <span class="num">${esc(seat)}</span></td>
      <td>${esc(k.trainNo)} ${esc(k.trainName)}</td><td>${esc(ST[k.from])} to ${esc(ST[k.to])}</td>
      <td class="num">${esc(k.pnr)}</td>
      <td>${esc(k.phone)}${k.email ? '<br><span class="hint">' + esc(k.email) + '</span>' : ''}</td>
      <td>${statusPill(k.status)}</td></tr>`).join('')
    : '<tr><td colspan="9" class="empty">No passengers to show. Book a ticket and the passenger details appear here.</td></tr>');
}

['pxTrain', 'pxStatus', 'pxQ'].forEach(id => ['input', 'change'].forEach(ev => $('#' + id).addEventListener(ev, renderManifest)));
$('#pxForm').addEventListener('submit', e => e.preventDefault());

function refreshTicketViews() { renderBookings(); renderManifest(); }

/* ---------- add train ---------- */
$('#addTrain').addEventListener('submit', e => {
  e.preventDefault();
  const msg = $('#atMsg');
  const no = $('#atNo').value.trim(), name = $('#atName').value.trim();
  const from = +$('#atFrom').value, to = +$('#atTo').value;
  const seats = Math.max(10, Math.min(600, +$('#atSeats').value || 100));
  const err = m => { msg.className = 'msg err'; msg.textContent = m; };
  if (!/^[A-Za-z0-9]{3,6}$/.test(no)) return err('Enter a train number of 3 to 6 letters or digits.');
  if (trains.some(t => t.no.toLowerCase() === no.toLowerCase())) return err('That train number is already in use.');
  if (!name) return err('Enter a train name.');
  if (from === to) return err('Choose different start and end stations.');
  const t = makeTrain({ no, name, from, to, speed: +$('#atSpeed').value, seats, atStation: from });
  trains.push(t);
  log(`${no} ${name} added at ${ST[from]}, bound for ${ST[to]}`, 'good');
  msg.className = 'msg ok'; msg.textContent = `${no} ${name} is ready at ${ST[from]} and departs on the next cycle.`;
  e.target.reset(); $('#atSeats').value = 100; $('#atTo').value = String(ST.length - 1);
  fillTrainSelect(); fillSeatTrains(); fillManifestTrains(); renderAll();
});

/* ---------- controls and tabs ---------- */
function renderAll() {
  syncTrains(); renderStats();
  if (activeTab === 'live') renderBoard();
  else if (activeTab === 'find') renderFind();
  else if (activeTab === 'seats') renderSeats();
  else if (activeTab === 'book') updateBk();
  else if (activeTab === 'pax') renderManifest();
  else if (activeTab === 'time') renderTimetable();
}

const tickMs = () => Math.round(1000 / speedMult);
function start() { stop(); timer = setInterval(tick, tickMs()); $('#pause').textContent = 'Pause'; }
function stop() { if (timer) clearInterval(timer); timer = null; }

$('#pause').addEventListener('click', () => {
  if (timer) { stop(); $('#pause').textContent = 'Resume'; } else { start(); }
});
$$('[data-speed]').forEach(b => b.addEventListener('click', () => {
  speedMult = +b.dataset.speed;
  $$('[data-speed]').forEach(x => x.setAttribute('aria-pressed', x === b));
  if (timer) start();
}));

const tabs = $$('[role=tab]');
function show(id) {
  activeTab = id;
  tabs.forEach(b => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  $$('.panel').forEach(p => p.hidden = p.id !== 'p-' + id);
  if (id === 'book') fillTrainSelect();
  if (id === 'seats') fillSeatTrains();
  if (id === 'find') renderFind();
  if (id === 'pax') renderManifest();
  renderAll();
}
tabs.forEach((b, i) => {
  b.addEventListener('click', () => show(b.dataset.tab));
  b.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); show(n.dataset.tab);
  });
});

/* ---------- init ---------- */
function fillStationSelects() {
  const all = ST.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
  $('#bdStation').innerHTML = all;
  $('#atFrom').innerHTML = all;
  $('#atTo').innerHTML = all; $('#atTo').value = ST.length - 1;
  const any = '<option value="">Any station</option>' + all;
  $('#fdFrom').innerHTML = any; $('#fdTo').innerHTML = any;
  $('#bkClass').innerHTML = CLASSES.map(c => `<option value="${c.key}">${c.name}</option>`).join('');
  $('#bkClass').value = 'second';
}
$('#bdStation').addEventListener('change', renderBoard);

buildMap(); fillStationSelects();
fillTrainSelect(); fillSeatTrains(); fillManifestTrains(); renderPaxRows(true);
refreshTicketViews(); renderTimetable(); renderFind();
log('Control room online.', 'good');
renderAll();
start();
})();

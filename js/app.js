/*
 * app.js — رابط کاربری: Splash، تب‌ها، جدول مادر شبیه اکسل، پلیرها، درآمد، گزارش، داده
 * تمام فرمول‌ها در calculations.js / reward-engine.js هستند؛ این فایل فقط نمایش و ورودی را مدیریت می‌کند.
 */
(function () {
  'use strict';
  const TT = window.TT;
  const { calc, referrals, players, engine, reports, storage, exporter } = TT;
  const fa = calc.fa;
  const SPLASH_MS = 5000;
  const splashStart = performance.now();

  /* ================= ابزارک‌های DOM ================= */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(c => { if (c === null || c === undefined || c === false) return; el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const num = n => h('span', { class: 'num', text: fa(n) });

  function toast(msg, isErr) {
    const t = h('div', { class: 'toast' + (isErr ? ' err' : ''), text: msg });
    document.getElementById('toast-root').append(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 3200);
  }

  function dialog({ title, body, okText, cancelText, danger, hideCancel }) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const done = v => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      const ok = h('button', { class: 'btn' + (danger ? ' btn-danger' : ''), text: okText || 'تأیید', onclick: () => done(true) });
      const cancel = hideCancel ? null : h('button', { class: 'btn btn-ghost', text: cancelText || 'انصراف', onclick: () => done(false) });
      const back = h('div', { class: 'modal-back', onclick: e => { if (e.target === back) done(false); } },
        h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', { text: title }), h('div', null, body), h('div', { class: 'row' }, cancel, ok)));
      root.append(back);
      document.addEventListener('keydown', onKey);
      (danger ? cancel || ok : ok).focus();
    });
  }

  /** ورودی عددی با جداکنندهٔ هزارگان (ارقام فارسی/لاتین قابل‌قبول) */
  function numInput(o) {
    const el = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'numin ' + (o.cls || ''), 'aria-label': o.label || 'مقدار', placeholder: o.placeholder || '' });
    const show = () => { const v = o.get(); el.value = v === null || v === undefined ? '' : fa(v); };
    el.addEventListener('input', () => {
      let n = calc.parseNumber(el.value);
      if (n === null) { if (o.allowEmpty) { o.set(null); return; } n = 0; }
      o.set(Math.max(0, n));
    });
    el.addEventListener('change', () => {
      const n = calc.parseNumber(el.value);
      if (o.commit) o.commit(n === null ? null : Math.max(0, n));
      show();
    });
    el.addEventListener('focus', () => setTimeout(() => el.select && el.select(), 0));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
    el.refresh = () => { if (document.activeElement !== el) show(); };
    show();
    return el;
  }

  /* ================= وضعیت برنامه ================= */
  const loaded = storage.load();
  let state = loaded.state;
  let result = engine.compute(state);
  const ui = { tab: 'master', showRefs: false, showHeaders: false, orient: 'excel', incomePlayer: null, incomeAll: false, sortTotal: false };
  try { const t = (location.hash || '').slice(1); if (t) ui.tab = t; } catch (e) { /* ignore */ }
  let view = null;      // { refresh() }
  let deferredInstall = null;

  const TABS = [
    { id: 'master', title: 'جدول مادر مالی' },
    { id: 'players', title: 'پلیرها و خرید اولیه' },
    { id: 'income', title: 'درآمد هر پلیر' },
    { id: 'report', title: 'گزارش توزیع پاداش' },
    { id: 'guide', title: 'فرمول‌ها و فرض‌ها' },
    { id: 'data', title: 'داده و پشتیبان' }
  ];
  if (!TABS.some(t => t.id === ui.tab)) ui.tab = 'master';

  function commit(structural) {
    result = engine.compute(state);
    storage.save(state);
    renderBanner();
    if (structural) renderView(); else if (view && view.refresh) view.refresh();
  }

  /* ================= هشدارهای سراسری ================= */
  function renderBanner() {
    const box = clear(document.getElementById('banner'));
    ['partner', 'agent'].forEach(k => {
      const b = result.baskets[k];
      if (b.status === 'short') {
        box.append(h('div', { class: 'banner err', role: 'alert' },
          h('strong', { text: `کسری ${b.label.replace('سبد بودجه ', '')}: ` }), num(b.shortfall), ' تومان',
          h('span', { class: 'small', text: ` — تعهد ${fa(b.committed)} از بودجه ${fa(b.pool)} بیشتر است. مازاد سبد دیگر آن را پوشش نمی‌دهد.` })));
      }
    });
    const errs = result.issues.filter(i => i.level === 'error');
    const warns = result.issues.filter(i => i.level === 'warn');
    if (errs.length) box.append(h('div', { class: 'banner err' }, h('strong', { text: `${fa(errs.length)} خطا در ورودی‌ها` }),
      h('ul', { class: 'issues' }, errs.slice(0, 4).map(i => h('li', { class: 'error', text: i.msg })))));
    if (warns.length) box.append(h('div', { class: 'banner warn' }, h('strong', { text: `${fa(warns.length)} هشدار` }),
      h('ul', { class: 'issues' }, warns.slice(0, 3).map(i => h('li', { class: 'warn', text: i.msg })))));
    if (!storage.isPersistent()) box.append(h('div', { class: 'banner warn' }, 'ذخیره‌سازی مرورگر در دسترس نیست؛ داده‌ها فقط تا بستن صفحه می‌مانند. از «دانلود پشتیبان JSON» استفاده کنید.'));
  }

  function setSaveStatus(info) {
    const el = document.getElementById('save-status');
    if (!el) return;
    const t = info.at;
    const hhmm = calc.toFaDigits(String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
    if (!info.persistent) { el.className = 'save-status warn'; el.textContent = 'ذخیره‌سازی در دسترس نیست'; }
    else { el.className = 'save-status'; el.textContent = 'ذخیره شد · ' + hhmm; }
  }

  /* ================= تب‌ها ================= */
  function renderTabs() {
    const nav = clear(document.getElementById('tabs'));
    TABS.forEach(t => nav.append(h('button', {
      class: 'tab', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(t.id === ui.tab), text: t.title,
      onclick: () => { ui.tab = t.id; try { history.replaceState(null, '', '#' + t.id); } catch (e) { /* ignore */ } renderTabs(); renderView(); }
    })));
  }
  function renderView() {
    const root = clear(document.getElementById('view'));
    const builders = { master: viewMaster, players: viewPlayers, income: viewIncome, report: viewReport, guide: viewGuide, data: viewData };
    view = builders[ui.tab](root);
  }

  /* ================= ۱) جدول مادر شبیه اکسل ================= */
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
  const lab = (c, t, extra) => Object.assign({ c, t, cls: 'b lbl' }, extra || {});
  const GRID = [
    { r: 1, spacer: true, cells: [] },
    { r: 2, cells: [{ c: 'A', t: 'قیمت شریک', cls: 'plain-h' }, { c: 'B', t: 'قیمت مصوب', cls: 'plain-h' }, { c: 'C', t: 'بودجه پاداش شریک', cls: 'plain-h' }] },
    { r: 3, cells: [{ c: 'A', calc: 'A3', cls: 'plain-v' }, { c: 'B', inp: 'B3', cls: 'plain-v' }, { c: 'C', inp: 'C3', cls: 'plain-v' }] },
    { r: 4, cells: [lab('A', 'بودجه پاداش شریک', { rs: 2 }), lab('B', 'حق ثبت شریک'), lab('C', 'حق تارگت شریک')] },
    { r: 5, cells: [{ c: 'B', inp: 'B5', cls: 'b' }, { c: 'C', inp: 'C5', cls: 'b' }] },
    { r: 6, spacer: true, cells: [] },
    { r: 7, cells: [{ c: 'A', t: 'قیمت نماینده', cls: 'plain-h' }, { c: 'B', t: 'قیمت مصوب', cls: 'plain-h' }, { c: 'C', t: 'بودجه پاداش نماینده', cls: 'plain-h' }] },
    { r: 8, cells: [{ c: 'A', calc: 'A8', cls: 'plain-v' }, { c: 'B', inp: 'B8', cls: 'plain-v' }, { c: 'C', inp: 'C8', cls: 'plain-v' }] },
    { r: 9, spacer: true, cells: [] },
    { r: 10, cells: [{ c: 'B', t: 'پاداش نماینده', cs: 3, cls: 'b grp' }, { c: 'E', t: 'پاداش شریک', cs: 3, cls: 'b grp' }] },
    { r: 11, cells: [lab('A', 'بودجه پاداش نماینده', { rs: 3 }), lab('B', 'حق ثبت نماینده'), lab('C', 'حق تارگت نماینده'),
      lab('D', 'حق معرفی نماینده جدید به نماینده قدیم'), lab('E', 'حق معرفی نماینده توسط شریک'),
      lab('F', 'حق ثبت نماینده قدیم به شریک'), lab('G', 'حق ثبت نماینده جدید به شریک')] },
    { r: 12, cells: ['B', 'C', 'D', 'E', 'F', 'G'].map(c => ({ c, inp: c + '12', cls: 'b' })) },
    { r: 13, cells: [{ c: 'B', calc: 'B13', cs: 3, cls: 'b calc' }, { c: 'E', calc: 'E13', cs: 3, cls: 'b calc' }] },
    { r: 14, cells: [{ c: 'D', calc: 'D14', cs: 2, cls: 'b calc total' }] }
  ];

  function formulaValueOf(ref) {
    const cfg = JSON.parse(JSON.stringify(state.config));
    calc.setPath(cfg, calc.CELL_BINDINGS[ref].path, null);
    return calc.evaluateCells(cfg).values[ref];
  }

  function viewMaster(root) {
    const bound = {};   // ref -> { el, kind }
    const fx = () => result.cells;

    const table = h('table', { class: 'xl' + (ui.showRefs ? ' show-refs' : ''), dir: ui.orient === 'excel' ? 'ltr' : 'rtl', 'aria-label': 'جدول مادر مالی طرح ۱۰۳' });
    const thead = h('thead');
    const headRow = h('tr', null, h('th', { class: 'colh' }), COLS.map(c => h('th', { class: 'colh', text: c })));
    thead.append(headRow);
    if (!ui.showHeaders) thead.hidden = true;
    table.append(thead);
    const tbody = h('tbody');
    const covered = new Set();
    GRID.forEach(row => {
      const tr = h('tr', { class: row.spacer ? 'spacer' : '' });
      tr.append(h('th', { class: 'rowh', text: String(row.r) }));
      if (!ui.showHeaders) tr.firstChild.hidden = true;
      COLS.forEach(c => {
        if (covered.has(row.r + c)) return;
        const spec = row.cells.find(x => x.c === c);
        if (!spec) { tr.append(h('td', { class: 'e' })); return; }
        const cs = spec.cs || 1, rs = spec.rs || 1;
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) if (dr || dc) covered.add((row.r + dr) + COLS[COLS.indexOf(c) + dc]);
        const td = h('td', { class: spec.cls || '', colspan: cs > 1 ? cs : null, rowspan: rs > 1 ? rs : null });
        if (spec.t) td.textContent = spec.t;
        if (spec.calc) {
          const v = h('span', { class: 'num' });
          td.append(v, h('span', { class: 'fx', text: fx().formulas[spec.calc] }), h('span', { class: 'ref', text: spec.calc }));
          bound[spec.calc] = { el: v, kind: 'calc' };
        }
        if (spec.inp) {
          const ref = spec.inp, b = calc.CELL_BINDINGS[ref];
          const input = numInput({
            label: 'سلول ' + ref, cls: 'big',
            get: () => fx().values[ref],
            set: n => {
              if (b.override) calc.setPath(state.config, b.path, n === formulaValueOf(ref) ? null : n);
              else calc.setPath(state.config, b.path, n);
              commit(false);
            }
          });
          const extra = [];
          if (b.override) {
            extra.push(h('span', { class: 'fx', text: fx().formulas[ref] }));
          }
          td.append(input, ...extra, h('span', { class: 'ref', text: ref }));
          if (b.override) {
            const rst = h('button', { class: 'btn btn-ghost btn-sm reset-ov', text: 'بازگشت به فرمول', title: 'حذف مقدار دستی و استفاده از فرمول اکسل', hidden: true,
              onclick: () => { calc.setPath(state.config, b.path, null); commit(false); } });
            td.append(rst);
            bound[ref] = { el: input, kind: 'ov', rst };
          } else bound[ref] = { el: input, kind: 'in' };
        }
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);

    const toggles = h('div', { class: 'xl-tools' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ui.showRefs ? true : null, onchange: e => { ui.showRefs = e.target.checked; table.classList.toggle('show-refs', ui.showRefs); } }), 'نمایش آدرس سلول و فرمول اکسل'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ui.showHeaders ? true : null, onchange: e => { ui.showHeaders = e.target.checked; thead.hidden = !ui.showHeaders; tbody.querySelectorAll('th.rowh').forEach(t => { t.hidden = !ui.showHeaders; }); } }), 'سرستون‌ها و شماره ردیف اکسل'),
      h('label', { class: 'field' }, h('span', { text: 'چینش ستون‌ها' }),
        h('select', { onchange: e => { ui.orient = e.target.value; table.dir = ui.orient === 'excel' ? 'ltr' : 'rtl'; }, 'aria-label': 'چینش ستون‌ها' },
          h('option', { value: 'excel', text: 'عین اکسل (ستون A سمت چپ)', selected: ui.orient === 'excel' ? true : null }),
          h('option', { value: 'rtl', text: 'راست‌چین (ستون A سمت راست)', selected: ui.orient === 'rtl' ? true : null }))));

    const s1 = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'جدول مادر مالی — طرح ۱۰۳' }),
        h('p', { text: 'ساختار، ترتیب ستون‌ها، ادغام سلول‌ها و فرمول‌ها دقیقاً مطابق فایل اکسل است. همهٔ مبالغ به «تومان» و قابل ویرایش‌اند؛ سلول‌های خاکستری محاسباتی‌اند.' }))),
      toggles, h('div', { class: 'xl-wrap' }, table),
      h('p', { class: 'small muted', text: 'زرد = ورودی قابل ویرایش · خاکستری = فرمول · نارنجی = مقدار دستیِ جایگزین فرمول (با دکمهٔ «بازگشت به فرمول» برمی‌گردد). نرخ‌ها «به‌ازای هر دستگاه» هستند.' }));

    /* قواعد و سقف‌ها */
    const cap = state.config.budgetCap;
    const capBasket = (key) => h('label', { class: 'field' },
      h('span', { text: `سقف دستی بودجه کل ${key === 'partner' ? 'شریک' : 'نماینده'} (تومان)` }),
      numInput({ label: 'سقف بودجه ' + key, allowEmpty: true, placeholder: 'خودکار', get: () => cap[key], set: n => { cap[key] = n; commit(false); } }),
      h('span', { class: 'small muted', 'data-auto': key }));
    const s2 = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'قواعد و سقف‌ها' }),
        h('p', { text: 'خالی‌گذاشتن سقف بودجه یعنی محاسبهٔ خودکار: «بودجهٔ هر دستگاه × تعداد دستگاه‌های ثبت‌شدهٔ همان گروه». دو سبد کاملاً مستقل‌اند.' }))),
      h('div', { class: 'row' },
        capBasket('partner'), capBasket('agent')));

    /* کنترل‌های مالی */
    const checksBox = h('div');
    const s3 = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'کنترل‌های مالی' }), h('p', { text: 'نتیجهٔ زندهٔ تطبیق جدول مادر با ورودی‌های ثبت‌شده.' }))), checksBox);

    root.append(s1, s2, s3);

    function refresh() {
      const c = result.cells;
      Object.keys(bound).forEach(ref => {
        const b = bound[ref];
        if (b.kind === 'calc') b.el.textContent = fa(c.values[ref]);
        else {
          b.el.refresh();
          if (b.kind === 'ov') { const o = !!c.overrides[ref]; b.el.classList.toggle('override', o); b.rst.hidden = !o; }
        }
      });
      root.querySelectorAll('[data-auto]').forEach(el => { const bk = result.baskets[el.dataset.auto]; el.textContent = 'خودکار: ' + fa(bk.derived) + ' تومان'; });
      renderChecks(checksBox);
    }
    refresh();
    return { refresh };
  }

  function renderChecks(box) {
    clear(box);
    box.append(h('ul', { class: 'checks' }, result.controls.map(c => h('li', { class: c.ok ? 'pass' : 'fail' },
      h('span', { class: 'pill', text: c.ok ? 'PASS' : 'FAIL' }), h('div', null, h('b', { text: c.title }), h('small', { text: c.detail }))))));
  }

  /* ================= ۲) پلیرها و خرید اولیه ================= */
  function viewPlayers(root) {
    const nameIn = h('input', { type: 'text', 'aria-label': 'نام پلیر جدید', placeholder: 'نام پلیر', maxlength: 60 });
    const typeSel = h('select', { 'aria-label': 'نوع پلیر' }, h('option', { value: 'agent', text: 'نماینده' }), h('option', { value: 'partner', text: 'شریک' }));
    const add = () => {
      const r = players.addPlayer(state, { name: nameIn.value, type: typeSel.value });
      if (!r.ok) { toast(r.reason, true); return; }
      nameIn.value = ''; commit(true); toast(`«${r.player.name}» اضافه شد.`);
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });

    const head = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'پلیرها، معرفی‌ها و خرید اولیه' }),
        h('p', { text: 'حق معرفی فقط یک‌بار و فقط برای معرف مستقیم ایجاد می‌شود، آن هم پس از تحقق هر سه شرط: تکمیل ثبت‌نام، تأیید مدارک و انجام خرید اولیهٔ نمایندهٔ معرفی‌شده. تعداد معرفی‌ها محدودیتی ندارد.' }))),
      h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', { text: 'نام' }), nameIn), h('label', { class: 'field' }, h('span', { text: 'نوع' }), typeSel),
        h('button', { class: 'btn', text: 'افزودن پلیر', onclick: add })));

    const body = h('div');
    const live = [];   // refreshers
    function build() {
      clear(body); live.length = 0;
      if (!state.players.length) {
        body.append(h('div', { class: 'empty-state' }, h('p', { text: 'هنوز پلیری ثبت نشده است.' }),
          h('button', { class: 'btn btn-ghost', text: 'بارگذاری داده نمونه (۴ پلیر)', onclick: () => { state = players.sampleState(); commit(true); toast('داده نمونه بارگذاری شد.'); } })));
        return;
      }
      const tb = h('tbody');
      state.players.forEach((p, i) => {
        const tr = h('tr');
        tr.append(h('td', { class: 'n', text: fa(i + 1) }));
        tr.append(h('td', null, h('input', { type: 'text', value: p.name, 'aria-label': 'نام', style: { minWidth: '130px', width: '100%' },
          onchange: e => { players.updatePlayer(state, p.id, { name: e.target.value }); commit(true); } })));
        tr.append(h('td', null, h('span', { class: 'tag ' + p.type, text: reports.typeLabel(p) })));
        if (p.type === 'agent') {
          const ps = h('select', { 'aria-label': 'شریک مربوطه', onchange: e => { const r = players.updatePlayer(state, p.id, { partnerId: e.target.value || null }); if (!r.ok) toast(r.reason, true); commit(true); } },
            h('option', { value: '', text: '— بدون شریک —' }), players.partners(state).map(x => h('option', { value: x.id, text: x.name, selected: p.partnerId === x.id ? true : null })));
          tr.append(h('td', null, ps));
          const refOpts = [h('option', { value: '', text: '— بدون معرف —' })];
          state.players.filter(x => x.id !== p.id).forEach(x => {
            refOpts.push(h('option', { value: x.id, selected: p.referrerId === x.id ? true : null, text: `${x.name} (${reports.typeLabel(x)})` }));
          });
          tr.append(h('td', null, h('select', { 'aria-label': 'معرف مستقیم', onchange: e => { const r = players.updatePlayer(state, p.id, { referrerId: e.target.value || null }); if (!r.ok) toast(r.reason, true); commit(true); } }, refOpts)));
        } else { tr.append(h('td', { class: 'muted', text: '—' }), h('td', { class: 'muted', text: '—' })); }
        const cnt = h('td', { class: 'n' }); tr.append(cnt);
        [['registrationCompleted', 'ثبت‌نام تکمیل شد'], ['docsApproved', 'مدارک تأیید شد']].forEach(([f, lbl]) => tr.append(h('td', { class: 'n' },
          p.type === 'agent' ? h('input', { type: 'checkbox', 'aria-label': lbl + ' — ' + p.name, checked: p[f] ? true : null,
            onchange: e => { players.updatePlayer(state, p.id, { [f]: e.target.checked }); commit(false); } }) : h('span', { class: 'muted', text: '—' }))));
        tr.append(h('td', null, numInput({ label: 'دستگاه ثبت‌شده', get: () => p.regDevices, set: n => { players.updatePlayer(state, p.id, { regDevices: n }); commit(false); } })));
        const tgt = numInput({ label: 'دستگاه مشمول تارگت', get: () => p.targetDevices, set: n => { players.updatePlayer(state, p.id, { targetDevices: n }); commit(false); } });
        tr.append(h('td', null, tgt));
        const fpTd = h('td', { class: 'n' });
        let fpInput = null, fpTag = null;
        if (p.type === 'agent') {
          fpInput = numInput({
            label: 'خرید اولیه', allowEmpty: true, placeholder: 'ثبت نشده',
            get: () => { const e = referrals.getFirstPurchase(state, p.id); return e ? e.devices : null; },
            set: n => {
              if (!n) return;                                        // حذف فقط با تأیید (رویداد change)
              const e = referrals.getFirstPurchase(state, p.id);
              const r = e ? referrals.updateFirstPurchase(state, e.id, n) : referrals.registerFirstPurchase(state, p.id, n);
              if (!r.ok) toast(r.reason, true);
              commit(false);
            },
            commit: async n => {
              const e = referrals.getFirstPurchase(state, p.id);
              if (!n && e) {
                const ok = await dialog({ title: 'حذف رویداد خرید اولیه', danger: true, okText: 'حذف رویداد', body: `رویداد ${e.id} برای «${p.name}» حذف و حق معرفی مربوط به آن لغو می‌شود. ادامه می‌دهید؟` });
                if (ok) { referrals.removeFirstPurchase(state, e.id); commit(true); } else fpInput.refresh();
              }
            }
          });
          fpTag = h('span', { class: 'tag fp' });
          fpTd.append(fpInput, fpTag);
        } else fpTd.append(h('span', { class: 'muted', text: '—' }));
        tr.append(fpTd);
        const tot = h('td', { class: 'n' }); tr.append(tot);
        tr.append(h('td', { class: 'n' }, h('button', { class: 'icon-btn', title: 'حذف پلیر', 'aria-label': 'حذف ' + p.name, text: '×',
          onclick: async () => {
            const ok = await dialog({ title: 'حذف پلیر', danger: true, okText: 'حذف', body: `«${p.name}» همراه با خرید اولیه و پیوندهای معرفی‌اش حذف می‌شود. ادامه می‌دهید؟` });
            if (ok) { storage.snapshotPrev(state); players.removePlayer(state, p.id); commit(true); toast('حذف شد. (بازگردانی در تب «داده و پشتیبان»)'); }
          } })));
        tb.append(tr);
        live.push(() => {
          cnt.textContent = fa(referrals.referralsOf(state, p.id).length);
          tgt.classList.toggle('invalid', p.targetDevices > p.regDevices);
          if (fpInput) { fpInput.refresh(); const e = referrals.getFirstPurchase(state, p.id); fpTag.textContent = e ? e.id : ''; fpTag.title = p.referrerId ? (referrals.referralStatus(state, p).eligible ? 'حق معرفی: مستحق' : 'حق معرفی: شرایط ناقص — ' + referrals.referralStatus(state, p).missing.join('، ')) : ''; fpInput.classList.toggle('invalid', !!e && e.devices > p.regDevices); }
          tot.textContent = fa(result.perPlayer[p.id].total);
        });
      });
      const foot = h('tfoot', null, h('tr', null, h('td', { colspan: 11, text: 'جمع کل پاداش' }), h('td', { class: 'n', 'data-grand': '1' }), h('td')));
      live.push(() => { foot.querySelector('[data-grand]').textContent = fa(result.grand.total); });
      body.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['ردیف', 'نام', 'نوع', 'شریک مربوطه', 'معرف مستقیم', 'معرفی‌ها', 'ثبت‌نام تکمیل', 'مدارک تأیید', 'دستگاه ثبت‌شده', 'مشمول تارگت', 'خرید اولیه (پارت اول)', 'جمع پاداش (تومان)', ''].map(t => h('th', { text: t })))),
        tb, foot)));
      live.forEach(f => f());
    }
    root.append(head, h('section', { class: 'sec' }, body));
    build();
    return { refresh() { live.forEach(f => f()); } };
  }

  /* ================= ۳) جدول درآمد هر پلیر ================= */
  function viewIncome(root) {
    const ctl = h('section', { class: 'sec' });
    const holder = h('div');
    const live = [];
    if (!state.players.some(p => p.id === ui.incomePlayer)) ui.incomePlayer = state.players[0] ? state.players[0].id : null;

    function incomeBlock(pid) {
      const rowOf = (id, key) => { const d = reports.playerIncome(state, result, id); return d ? d.rows.find(x => x.key === key) : null; };
      const data = reports.playerIncome(state, result, pid);
      const p = data.player;
      const keyed = {};
      const tb = h('tbody');
      data.rows.forEach(r => {
        const tr = h('tr', { class: r.kind === 'subtotal' ? 'sub' : r.kind === 'total' ? 'tot' : r.kind === 'slot' ? 'slot' : '' });
        const qtyTd = h('td', { class: 'n' }), rateTd = h('td', { class: 'n' }), amtTd = h('td', { class: 'n' }), fxTd = h('td', { class: 'fxcell' });
        tr.append(h('td', { text: r.label }), qtyTd, rateTd, amtTd, fxTd);
        if (r.kind === 'input') {
          const b = r.bind;
          const inp = numInput({
            label: r.label, allowEmpty: b.type === 'fp', placeholder: b.type === 'fp' ? 'ثبت نشده' : '',
            get: () => { const d = rowOf(pid, r.key); return d ? (b.type === 'fp' && !d.eventId ? null : d.qty) : 0; },
            set: n => {
              if (b.type === 'player') { players.updatePlayer(state, b.playerId, { [b.field]: n }); commit(false); }
              else { if (!n) return; const e = referrals.getFirstPurchase(state, b.agentId); const rr = e ? referrals.updateFirstPurchase(state, e.id, n) : referrals.registerFirstPurchase(state, b.agentId, n); if (!rr.ok) toast(rr.reason, true); commit(false); }
            },
            commit: async n => {
              if (b.type === 'fp' && !n) {
                const e = referrals.getFirstPurchase(state, b.agentId);
                if (e) { const ok = await dialog({ title: 'حذف رویداد خرید اولیه', danger: true, okText: 'حذف رویداد', body: `رویداد ${e.id} حذف و حق معرفی آن لغو می‌شود. ادامه می‌دهید؟` }); if (ok) { referrals.removeFirstPurchase(state, e.id); commit(true); } else inp.refresh(); }
              }
            }
          });
          qtyTd.append(inp); keyed[r.key] = { inp, qtyTd, rateTd, amtTd, fxTd, r };
        } else keyed[r.key] = { qtyTd, rateTd, amtTd, fxTd, r };
        tb.append(tr);
      });
      const shareEl = h('span', { class: 'tag' });
      const box = h('section', { class: 'sec' },
        h('div', { class: 'sec-head' }, h('div', null, h('h2', null, p.name, ' ', h('span', { class: 'tag ' + p.type, text: reports.typeLabel(p) })),
          h('p', null, 'سهم از کل پاداش پرداختی: ', shareEl))),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
          h('thead', null, h('tr', null, ['شاخص عملکرد', 'مقدار عملکرد', 'نرخ پاداش (تومان)', 'مبلغ پاداش (تومان)', 'جزئیات محاسبه'].map(t => h('th', { text: t })))), tb)));
      const upd = () => {
        const d = reports.playerIncome(state, result, pid); if (!d) return;
        shareEl.textContent = calc.toFaDigits((d.share * 100).toFixed(1)) + '٪';
        d.rows.forEach(r => {
          const k = keyed[r.key]; if (!k) return; k.r = r;
          if (k.inp) k.inp.refresh(); else if (r.kind === 'info') k.qtyTd.textContent = fa(r.qty); else clear(k.qtyTd);
          k.rateTd.textContent = r.rate !== undefined ? fa(r.rate) : '';
          k.rateTd.title = r.rateLabel || '';
          k.amtTd.textContent = r.amount !== undefined ? fa(r.amount) : '';
          clear(k.fxTd);
          if (r.kind === 'slot') k.fxTd.textContent = r.note || '';
          else { if (r.rateLabel) k.fxTd.append(h('div', { class: 'small', text: r.rateLabel })); if (r.formula) k.fxTd.append(h('span', { class: 'num', text: r.formula })); if (r.note) k.fxTd.append(h('div', { class: 'small', text: r.note })); }
        });
      };
      live.push(upd); upd();
      return box;
    }

    function build() {
      clear(holder); live.length = 0;
      if (!state.players.length) { holder.append(h('div', { class: 'sec empty-state' }, h('p', { text: 'برای مشاهدهٔ جدول درآمد ابتدا در تب «پلیرها» پلیر اضافه کنید.' }))); return; }
      const ids = ui.incomeAll ? state.players.map(p => p.id) : [ui.incomePlayer];
      ids.forEach(id => holder.append(incomeBlock(id)));
    }
    const sel = h('select', { 'aria-label': 'انتخاب پلیر', onchange: e => { ui.incomePlayer = e.target.value; build(); } },
      state.players.map(p => h('option', { value: p.id, text: `${p.name} (${reports.typeLabel(p)})`, selected: p.id === ui.incomePlayer ? true : null })));
    const step = d => { const i = state.players.findIndex(p => p.id === ui.incomePlayer); const n = state.players[(i + d + state.players.length) % state.players.length]; ui.incomePlayer = n.id; sel.value = n.id; build(); };
    ctl.append(h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'جدول درآمد هر پلیر' }),
      h('p', { text: 'مقدار عملکرد را مستقیماً در جدول وارد کنید؛ مبلغ‌ها لحظه‌ای به‌روز می‌شوند. ستون «جزئیات» فرمول هر پاداش را نشان می‌دهد.' }))),
      h('div', { class: 'row no-print' }, h('label', { class: 'field' }, h('span', { text: 'پلیر' }), sel),
        h('button', { class: 'btn btn-ghost', text: 'قبلی', onclick: () => step(-1) }), h('button', { class: 'btn btn-ghost', text: 'بعدی', onclick: () => step(1) }),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ui.incomeAll ? true : null, onchange: e => { ui.incomeAll = e.target.checked; build(); } }), 'نمایش جدول همهٔ پلیرها'),
        h('button', { class: 'btn', text: 'چاپ / ذخیره PDF', onclick: doPrint })));
    root.append(ctl, holder);
    build();
    return { refresh() { live.forEach(f => f()); } };
  }

  /* ================= ۴) گزارش نهایی توزیع ================= */
  function viewReport(root) {
    const dist = reports.distribution(state, result, { sort: ui.sortTotal ? 'total' : 'order' });
    const B = result.baskets, G = result.groups;
    const statusBadge = b => h('span', { class: 'status-box ' + b.status, text: b.status === 'short' ? 'کسری' : b.status === 'empty' ? 'بدون داده' : 'کافی' });
    const bRow = b => h('tr', null, h('td', { text: b.label }), h('td', { class: 'n' }, num(b.perDevice)), h('td', { class: 'n' }, num(b.devices)),
      h('td', { class: 'n' }, num(b.pool), b.manualCap !== null ? h('div', { class: 'small muted', text: 'سقف دستی' }) : null),
      h('td', { class: 'n' }, num(b.committed)), h('td', { class: 'n ' + (b.remaining < 0 ? 'bad-t' : '') }, b.remaining < 0 ? h('span', null, 'منفی: ', num(-b.remaining)) : num(b.remaining)),
      h('td', { class: 'n ' + (b.shortfall ? 'bad-t' : '') }, num(b.shortfall)), h('td', { class: 'n' }, statusBadge(b)));
    const anyShort = B.partner.status === 'short' || B.agent.status === 'short';
    const sum = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'خلاصه مدیریتی' }), h('p', { text: 'دو سبد بودجه مستقل‌اند؛ مازاد یکی کسری دیگری را پوشش نمی‌دهد.' })),
        h('div', { class: 'row no-print' },
          h('button', { class: 'btn', text: 'چاپ / ذخیره PDF', onclick: doPrint }),
          h('button', { class: 'btn btn-ghost', text: 'CSV گزارش پاداش', onclick: () => exporter.download(`reward-report-${exporter.stamp()}.csv`, reports.reportCSV(state, result), 'text/csv') }),
          h('button', { class: 'btn btn-ghost', text: 'CSV اطلاعات پلیرها', onclick: () => exporter.download(`players-${exporter.stamp()}.csv`, reports.playersCSV(state, result), 'text/csv') }))),
      h('div', { class: 'banner ' + (anyShort ? 'err' : (state.players.length ? 'ok' : 'warn')), role: 'status' },
        anyShort ? h('span', null, h('strong', { text: 'کسری بودجه: ' }), [B.partner, B.agent].filter(b => b.status === 'short').map(b => h('span', null, `${b.label.replace('سبد بودجه پاداش ', '')} `, num(b.shortfall), ' تومان  '))) :
          state.players.length ? h('strong', { text: 'بودجهٔ هر دو سبد برای تعهدات محاسبه‌شده کافی است.' }) : 'پلیری ثبت نشده است.'),
      h('div', { class: 'tbl-wrap', style: { marginTop: '10px' } }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['سبد بودجه', 'بودجه هر دستگاه', 'تعداد دستگاه', 'بودجه کل', 'مجموع تعهد', 'مانده', 'کسری', 'وضعیت'].map(t => h('th', { text: t })))),
        h('tbody', null, bRow(B.partner), bRow(B.agent)),
        h('tfoot', null, h('tr', null, h('td', { colspan: 4, text: 'مجموع کل تعهدات (هر دو سبد)' }), h('td', { class: 'n' }, num(B.partner.committed + B.agent.committed)), h('td', { colspan: 3 }))))),
      h('h3', { style: { margin: '14px 0 6px' }, text: 'سهم گروه‌های دریافت‌کننده' }),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['گروه', 'تعداد', 'حق ثبت', 'حق تارگت', 'حق معرفی', 'مجموع پاداش', 'درصد سهم'].map(t => h('th', { text: t })))),
        h('tbody', null, [['شریک‌ها', G.partner], ['نماینده‌ها', G.agent]].map(([n, g]) => h('tr', null, h('td', { text: n }), h('td', { class: 'n', text: fa(g.count) }), h('td', { class: 'n' }, num(g.reg)), h('td', { class: 'n' }, num(g.target)), h('td', { class: 'n' }, num(g.referral)), h('td', { class: 'n' }, num(g.total)), h('td', { class: 'n', text: pct(g.share) })))),
        h('tfoot', null, h('tr', null, h('td', { text: 'جمع کل' }), h('td', { class: 'n', text: fa(G.partner.count + G.agent.count) }), h('td', { class: 'n' }, num(result.grand.reg)), h('td', { class: 'n' }, num(result.grand.target)), h('td', { class: 'n' }, num(result.grand.referral)), h('td', { class: 'n' }, num(result.grand.total)), h('td', { class: 'n', text: result.grand.total ? pct(1) : pct(0) }))))));

    const dRows = dist.rows.map(r => h('tr', null, h('td', { text: r.name }), h('td', null, h('span', { class: 'tag ' + r.type, text: r.typeLabel })), h('td', { class: 'n' }, num(r.reg)), h('td', { class: 'n' }, num(r.target)), h('td', { class: 'n' }, num(r.referral)), h('td', { class: 'n' }, num(r.total)), h('td', { class: 'n', text: pct(r.share) })));
    const dsec = h('section', { class: 'sec' },
      h('div', { class: 'sec-head' }, h('div', null, h('h2', { text: 'توزیع پاداش به تفکیک دریافت‌کننده' }), h('p', { text: 'حق ثبت = ثبت شریک/نماینده + حق ثبت قدیم/جدید به شریک · حق معرفی = معرفی نماینده جدید توسط نماینده قدیم یا شریک' })),
        h('label', { class: 'chk no-print' }, h('input', { type: 'checkbox', checked: ui.sortTotal ? true : null, onchange: e => { ui.sortTotal = e.target.checked; renderView(); } }), 'مرتب‌سازی بر اساس جمع پاداش')),
      state.players.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['دریافت‌کننده', 'نوع', 'حق ثبت', 'حق تارگت', 'حق معرفی', 'جمع کل (تومان)', 'درصد سهم'].map(t => h('th', { text: t })))),
        h('tbody', null, dRows),
        h('tfoot', null, h('tr', null, h('td', { colspan: 2, text: 'جمع کل' }), h('td', { class: 'n' }, num(dist.totals.reg)), h('td', { class: 'n' }, num(dist.totals.target)), h('td', { class: 'n' }, num(dist.totals.referral)), h('td', { class: 'n' }, num(dist.totals.total)), h('td', { class: 'n', text: dist.totals.total ? pct(1) : pct(0) }))))) :
        h('div', { class: 'empty-state', text: 'پلیری ثبت نشده است.' }));

    const m = reports.matrix(state, result);
    const msec = h('details', { class: 'card', open: true },
      h('summary', { text: 'ریز ۸ نوع پاداش به تفکیک پلیر (برای ممیزی)' }),
      h('div', null, state.players.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, h('th', { text: 'دریافت‌کننده' }), m.cols.map(c => h('th', { text: c.label })), h('th', { text: 'جمع' }))),
        h('tbody', null, m.rows.map(r => h('tr', null, h('td', { text: r.name }), r.cells.map(c => h('td', { class: 'n' }, c === null ? h('span', { class: 'muted', text: '—' }) : num(c))), h('td', { class: 'n' }, num(r.total))))),
        h('tfoot', null, h('tr', null, h('td', { text: 'جمع' }), m.totals.map(t => h('td', { class: 'n' }, num(t))), h('td', { class: 'n' }, num(m.grand)))))) : h('p', { class: 'muted', text: 'داده‌ای نیست.' })));

    const csec = h('section', { class: 'sec' }, h('h2', { style: { marginBottom: '8px' }, text: 'کنترل‌های مالی' }));
    renderChecks(csec);
    root.append(sum, dsec, msec, csec);
    return { refresh() { renderView(); } };
  }
  const pct = s => calc.toFaDigits((s * 100).toFixed(1)) + '٪';

  function doPrint() {
    document.getElementById('print-date').textContent = new Date().toLocaleDateString('fa-IR-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    exporter.printPage();
  }

  /* ================= ۵) فرمول‌ها و فرض‌ها ================= */
  function viewGuide(root) {
    const c = result.cells.values;
    const code = t => h('span', { class: 'code', text: t });
    const li = (...k) => h('li', null, ...k);
    root.append(
      h('section', { class: 'sec' }, h('h2', { text: 'فرمول‌های پیاده‌سازی‌شده' }),
        h('p', { class: 'muted', text: 'مرجع یگانهٔ همه‌ی فرمول‌ها فایل js/calculations.js و js/reward-engine.js است. مقادیر زیر مقادیر جاری جدول مادر هستند.' }),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'dt' },
          h('thead', null, h('tr', null, ['نوع پاداش', 'سلول اکسل', 'نرخ جاری', 'قاعده'].map(t => h('th', { text: t })))),
          h('tbody', null, calc.REWARD_TYPES.map(t => h('tr', null, h('td', { text: t.label }), h('td', { class: 'n' }, code(t.cell)), h('td', { class: 'n' }, num(result.rates[t.code])),
            h('td', { text: ruleText(t.code) }))))))),
      h('section', { class: 'sec' }, h('h2', { text: 'فرمول‌های جدول مادر (اکسل)' }),
        h('ul', { class: 'assume' },
          li(code('A3 = B3 + C3'), ` ← ${fa(c.A3)}`), li(code('C5 = C3 − B5'), ` ← ${fa(c.C5)}`),
          li(code('B8 = B3 ، C8 = C3 ، A8 = B8 + C8'), ` ← ${fa(c.A8)}`),
          li(code('B13 = B12 + C12 + D12'), ` ← ${fa(c.B13)}`), li(code('E13 = E12 + F12 + G12'), ` ← ${fa(c.E13)}`),
          li(code('D14 = B13 + E13'), ` ← ${fa(c.D14)} (باید با C8 برابر باشد)`),
          li('هر مبلغ پاداش: ', code('مبلغ = تعداد × نرخ'), ' ؛ حق معرفی: ', code('referralReward = referralRate × firstPurchaseDeviceCount')))),
      h('section', { class: 'sec' }, h('h2', { text: 'فرض‌ها و ابهام‌های فایل اکسل (نیازمند تأیید شما)' }),
        h('p', { class: 'muted', text: 'اکسل فقط نرخ‌ها را می‌دهد و تعریف عملیاتی «چه کسی / برای چه چیزی» را نمی‌گوید. طبق دستور، حدس‌ها صریح و محدود به یک تابع هستند تا به‌سادگی اصلاح شوند.' }),
        h('ol', { class: 'assume' },
          li(h('b', { text: 'مبنای بودجه. ' }), 'اعداد اکسل «به‌ازای هر دستگاه» هستند (قیمت مصوب ۲۰ میلیون، بودجه ۱ میلیون). بودجهٔ کل هر سبد = بودجهٔ هر دستگاه × تعداد دستگاه ثبت‌شدهٔ همان گروه است، مگر سقف دستی در تب «جدول مادر» وارد شود.'),
          li(h('b', { text: 'دو سبد. ' }), 'سبد شریک (C3) فقط حق ثبت/تارگت شریک را تأمین می‌کند. سبد نماینده (C8) هر ۶ حق بخش پایین جدول را تأمین می‌کند؛ شامل ۳ حقی که به شریک پرداخت می‌شود (E12:G12). به همین دلیل گزارش هم «به تفکیک سبد» و هم «به تفکیک گروه دریافت‌کننده» ارائه می‌شود.'),
          li(h('b', { text: 'نماینده جدید / قدیم. ' }), 'در اکسل تعریف نشده است. فرض: دستگاه‌های «خرید اولیه (پارت اول)» نماینده = نماینده جدید (G12)، و مازاد بر آن از دستگاه‌های ثبت‌شده = نماینده قدیم (F12). تابع classifyAgentDevices.'),
          li(h('b', { text: 'شبکهٔ شریک. ' }), 'حق ثبت قدیم/جدید (F12/G12) به «شریک مربوطهٔ» هر نماینده تعلق می‌گیرد (نه فقط نمایندگانی که خود شریک معرفی کرده). نماینده بدون شریک → این دو حق ایجاد نمی‌شود و هشدار می‌گیرد.'),
          li(h('b', { text: 'معرف نماینده. ' }), 'معرف مستقیم نماینده یا «نماینده قدیم» است (D12 به او) یا «شریک» (E12 به شریک)؛ هر نماینده فقط یک معرف دارد، پس برای یک خرید اولیه فقط یکی از D12/E12 پرداخت می‌شود.'),
          li(h('b', { text: 'شرایط حق معرفی. ' }), 'برای ثبت‌نام تکمیل‌شده و تأیید مدارک، دو فیلد تیک‌دار به پلیر نماینده اضافه شد. دادهٔ قدیمی این فیلدها را نداشت؛ نمایندگانی که قبلاً خرید اولیه‌شان ثبت شده بود «تکمیل/تأیید» فرض شدند تا مبالغ قبلی تغییر نکند.'),
          li(h('b', { text: 'حق ثبت F12/G12. ' }), 'این دو حق در اکسل به «شریک» می‌رسد (بر اساس عضویت نماینده در شبکهٔ شریک) و هیچ حق ثبتی به نمایندهٔ معرف نمی‌رسد. اگر منظور شما از «حق ثبت به معرف» همین دو حق بوده است، لطفاً اعلام کنید.'),
          li(h('b', { text: 'جمع نرخ‌ها در برابر سقف عملی. ' }), `جمع ۶ نرخ بخش نماینده = ${fa(c.D14)} و با C8 برابر است، اما برای یک دستگاه هیچ‌گاه همهٔ ۶ حق هم‌زمان ایجاد نمی‌شود (D/E فقط یکی؛ F/G فقط یکی). بنابراین تعهد واقعی هر دستگاه کمتر یا مساوی بودجه است.`),
          li(h('b', { text: 'حق تارگت شریک. ' }), 'در اکسل فرمول C3−B5 است؛ در برنامه می‌توان آن را دستی بازنویسی و دوباره به فرمول برگرداند.'))),
      h('section', { class: 'sec' }, h('h2', { text: 'قوانین معرفی (کنترل‌شده در موتور)' }),
        h('ul', { class: 'assume' }, [
          'صرف معرفی/ثبت‌نام حق معرفی ایجاد نمی‌کند؛ فقط «خرید اولیه» نماینده معرفی‌شده.',
          'خرید اولیه یک رویداد مستقل با شناسهٔ یکتا (FP-xxxx) است؛ ثبت دوم برای همان نماینده رد می‌شود و ویرایش، همان رویداد را اصلاح می‌کند.',
          'خریدهای بعدی (افزایش دستگاه ثبت‌شده) هیچ حق معرفی جدیدی نمی‌سازد.',
          'فقط معرف مستقیم پاداش می‌گیرد؛ معرفی‌های نسل بعد هیچ سهمی برای معرف بالادست ندارد.',
          'حق معرفی فقط وقتی ایجاد می‌شود که ثبت‌نام تکمیل، مدارک تأیید و خرید اولیه انجام شده باشد.',
          'تعداد معرفی‌های مستقیم هر نماینده سقف ندارد.',
          'به معرف مستقیم هیچ «حق ثبت»ی بابت دستگاه‌های نمایندهٔ معرفی‌شده تعلق نمی‌گیرد.'].map(t => li(t)))));
    return { refresh() { /* ایستا */ } };
  }
  function ruleText(code) {
    return ({
      P_REG: 'تعداد دستگاه ثبت‌شدهٔ شریک × نرخ',
      P_TARGET: 'تعداد دستگاه مشمول تارگت شریک × (C3 − B5)',
      A_REG: 'تعداد دستگاه ثبت‌شدهٔ نماینده × نرخ',
      A_TARGET: 'تعداد دستگاه مشمول تارگت نماینده × نرخ',
      REF_AGENT: 'دستگاه‌های خرید اولیهٔ نمایندهٔ معرفی‌شده × نرخ؛ به نمایندهٔ معرف مستقیم، یک‌بار',
      REF_PARTNER: 'دستگاه‌های خرید اولیهٔ نمایندهٔ معرفی‌شده × نرخ؛ به شریک معرف مستقیم، یک‌بار',
      OLD_REG_PARTNER: 'دستگاه‌های ثبت‌شدهٔ نمایندگان قدیم شبکه (مازاد بر خرید اولیه) × نرخ',
      NEW_REG_PARTNER: 'دستگاه‌های خرید اولیهٔ نمایندگان جدید شبکه × نرخ'
    })[code];
  }

  /* ================= ۶) داده و پشتیبان ================= */
  function viewData(root) {
    const prev = storage.loadPrev();
    const testOut = h('div');
    const runTests = () => {
      const go = () => {
        const res = TT.tests.runAll(); clear(testOut);
        const fail = res.filter(r => !r.pass).length;
        testOut.append(h('div', { class: 'banner ' + (fail ? 'err' : 'ok') }, h('strong', { text: `${fa(res.length - fail)} از ${fa(res.length)} آزمون PASS` + (fail ? ` — ${fa(fail)} FAIL` : '') })),
          h('ul', { class: 'tests-out' }, res.map(r => h('li', { class: r.pass ? 'p' : 'f' }, h('span', { class: 'pill', text: r.pass ? 'PASS' : 'FAIL' }), h('span', null, r.name, r.pass ? null : h('div', { class: 'small bad-t', text: r.error }))))));
      };
      if (TT.tests) return go();
      const s = h('script', { src: 'tests/calculation-tests.js' }); s.onload = go; s.onerror = () => toast('بارگذاری فایل آزمون ناموفق بود.', true); document.head.append(s);
    };
    const act = (title, desc, ...btns) => h('div', { class: 'sec' }, h('h3', { text: title }), h('p', { class: 'muted small', text: desc }), h('div', { class: 'row' }, btns));
    root.append(
      h('section', null,
        act('پشتیبان‌گیری', 'نسخهٔ کامل اطلاعات (تنظیمات، پلیرها، معرفی‌ها و خرید اولیه‌ها) در یک فایل JSON.',
          h('button', { class: 'btn', text: 'دانلود پشتیبان JSON', onclick: () => { exporter.download(`reward-engine-103-backup-${exporter.stamp()}.json`, storage.buildBackup(state), 'application/json'); toast('پشتیبان دانلود شد.'); } })),
        act('بازیابی از فایل پشتیبان', 'داده‌های فعلی جایگزین می‌شوند؛ پیش از آن، یک نسخهٔ قابل بازگردانی نگه داشته می‌شود.',
          h('button', { class: 'btn btn-ghost', text: 'انتخاب فایل JSON…', onclick: async () => {
            try {
              const f = await exporter.pickTextFile('.json,application/json');
              const b = storage.parseBackup(f.text);
              const ok = await dialog({ title: 'بازیابی اطلاعات', okText: 'جایگزین کن', danger: true, body: `فایل «${f.name}» شامل ${fa(b.summary.players)} پلیر و ${fa(b.summary.firstPurchases)} خرید اولیه است. داده‌های فعلی جایگزین می‌شوند.` });
              if (ok) { storage.snapshotPrev(state); state = b.state; commit(true); toast('اطلاعات بازیابی شد.'); }
            } catch (e) { if (e && e.message !== 'فایلی انتخاب نشد.') toast(e.message, true); }
          } })),
        act('داده نمونه', 'چهار پلیر نمونه (یک شریک و سه نماینده با زنجیرهٔ معرفی) برای دیدن عملکرد موتور.',
          h('button', { class: 'btn btn-ghost', text: 'بارگذاری داده نمونه', onclick: async () => {
            if (state.players.length) { const ok = await dialog({ title: 'جایگزینی با داده نمونه', okText: 'ادامه', danger: true, body: 'پلیرهای فعلی با داده نمونه جایگزین می‌شوند. (قابل بازگردانی)' }); if (!ok) return; }
            storage.snapshotPrev(state); state = players.sampleState(); commit(true); toast('داده نمونه بارگذاری شد.');
          } })),
        act('پاک‌سازی', 'حذف پلیرها و بازگشت تنظیمات به مقادیر اکسل. پیش از پاک‌سازی یک نسخهٔ قابل بازگردانی ذخیره می‌شود.',
          h('button', { class: 'btn btn-danger', text: 'پاک‌سازی همهٔ اطلاعات', onclick: async () => {
            const ok = await dialog({ title: 'پاک‌سازی همهٔ اطلاعات', okText: 'بله، پاک شود', danger: true, body: `${fa(state.players.length)} پلیر، ${fa(state.firstPurchases.length)} خرید اولیه و تنظیمات شما حذف می‌شود. پیشنهاد می‌شود ابتدا پشتیبان JSON بگیرید.` });
            if (ok) { storage.snapshotPrev(state); state = players.newState(); commit(true); toast('پاک‌سازی انجام شد. بازگردانی ممکن است.'); }
          } }),
          prev ? h('button', { class: 'btn btn-ghost', text: 'بازگردانی حالت قبلی', onclick: () => { const cur = state; state = prev.state; storage.snapshotPrev(cur); commit(true); toast('حالت قبلی بازگردانی شد.'); } }) : null),
        act('وضعیت ذخیره‌سازی', storage.isPersistent() ? 'اطلاعات به‌صورت خودکار در حافظهٔ همین مرورگر ذخیره می‌شود و پس از بستن/باز کردن برنامه می‌ماند.' : 'ذخیره‌سازی مرورگر در دسترس نیست — حتماً پشتیبان JSON بگیرید.',
          h('button', { class: 'btn btn-ghost', text: 'درخواست ذخیرهٔ پایدار', onclick: async () => { const r = await storage.requestPersistence(); toast(r ? 'ذخیرهٔ پایدار فعال شد.' : 'مرورگر ذخیرهٔ پایدار را تأیید نکرد.'); } })),
        h('div', { class: 'sec' }, h('h3', { text: 'آزمون‌های خودکار محاسبات' }), h('p', { class: 'muted small', text: 'سناریوهای ۱ تا ۹ و تطبیق با اکسل؛ روی داده‌های موقت اجرا می‌شود و اطلاعات شما را تغییر نمی‌دهد.' }),
          h('button', { class: 'btn', text: 'اجرای آزمون‌ها', onclick: runTests }), testOut)));
    return { refresh() { /* ایستا */ } };
  }

  /* ================= راه‌اندازی ================= */
  function init() {
    storage.setOnSaved(setSaveStatus);
    renderTabs(); renderBanner(); renderView();
    if (loaded.source === 'saved') document.getElementById('save-status').textContent = 'اطلاعات قبلی بازیابی شد';
    if (loaded.source === 'error') toast('داده ذخیره‌شده خراب بود؛ با حالت پیش‌فرض شروع شد.', true);
    storage.requestPersistence();
    window.addEventListener('pagehide', storage.flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') storage.flush(); });
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredInstall = e;
      const b = document.getElementById('btn-install'); b.hidden = false;
      b.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; b.hidden = true; };
    });
    window.addEventListener('appinstalled', () => { document.getElementById('btn-install').hidden = true; });
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* آفلاین‌نبودن، مانع کار برنامه نیست */ });
    }
    // Splash: دقیقاً ۵ ثانیه، سپس انتقال نرم به داشبورد
    const left = Math.max(0, SPLASH_MS - (performance.now() - splashStart));
    setTimeout(() => {
      const sp = document.getElementById('splash');
      document.getElementById('app').hidden = false;
      sp.classList.add('leaving');
      setTimeout(() => sp.remove(), 700);
    }, left);
  }
  window.TT.app = { get state() { return state; }, get result() { return result; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/*
 * players.js — ساخت state، مدیریت پلیرها، نرمال‌سازی داده و اعتبارسنجی
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calculations'), require('./referrals'));
  else { root.TT = root.TT || {}; root.TT.players = factory(root.TT.calc, root.TT.referrals); }
})(typeof self !== 'undefined' ? self : this, function (calc, referrals) {
  'use strict';

  const STATE_VERSION = 1;
  const TYPE_LABEL = { partner: 'شریک', agent: 'نماینده' };
  const count = v => calc.toInt(v);

  function newState() {
    return {
      version: STATE_VERSION,
      config: calc.defaultConfig(),
      players: [],
      firstPurchases: [],
      seq: { player: 0, fp: 0 },
      meta: { createdAt: new Date().toISOString(), updatedAt: null }
    };
  }

  const getPlayer = (state, id) => state.players.find(p => p.id === id) || null;
  const partners = state => state.players.filter(p => p.type === 'partner');
  const agents = state => state.players.filter(p => p.type === 'agent');

  function addPlayer(state, data) {
    const name = String((data && data.name) || '').trim();
    const type = data && data.type;
    if (!name) return { ok: false, code: 'NO_NAME', reason: 'نام پلیر را وارد کنید.' };
    if (type !== 'partner' && type !== 'agent') return { ok: false, code: 'BAD_TYPE', reason: 'نوع پلیر باید شریک یا نماینده باشد.' };
    state.seq.player += 1;
    const p = {
      id: 'P-' + String(state.seq.player).padStart(3, '0'),
      name, type,
      partnerId: type === 'agent' ? (data.partnerId || null) : null,
      referrerId: null,
      regDevices: count(data.regDevices),
      targetDevices: count(data.targetDevices)
    };
    if (type === 'agent') { p.registrationCompleted = !!data.registrationCompleted; p.docsApproved = !!data.docsApproved; }
    state.players.push(p);
    if (type === 'agent' && data.referrerId) {
      const r = referrals.setReferrer(state, p.id, data.referrerId);
      if (!r.ok) { state.players.pop(); state.seq.player -= 1; return r; }
    }
    return { ok: true, player: p };
  }

  /** ویرایش فیلدهای مجاز؛ نوع پلیر پس از ایجاد قابل تغییر نیست */
  function updatePlayer(state, id, patch) {
    const p = getPlayer(state, id);
    if (!p) return { ok: false, code: 'NO_PLAYER', reason: 'پلیر یافت نشد.' };
    if ('name' in patch) p.name = String(patch.name || '').trim() || p.name;
    if ('regDevices' in patch) p.regDevices = count(patch.regDevices);
    if ('targetDevices' in patch) p.targetDevices = count(patch.targetDevices);
    if (p.type === 'agent') {
      if ('registrationCompleted' in patch) p.registrationCompleted = !!patch.registrationCompleted;
      if ('docsApproved' in patch) p.docsApproved = !!patch.docsApproved;
    }
    if ('partnerId' in patch && p.type === 'agent') {
      const pid = patch.partnerId || null;
      if (pid && (!getPlayer(state, pid) || getPlayer(state, pid).type !== 'partner')) {
        return { ok: false, code: 'BAD_PARTNER', reason: 'شریک انتخاب‌شده معتبر نیست.' };
      }
      p.partnerId = pid;
    }
    if ('referrerId' in patch && p.type === 'agent') {
      const r = referrals.setReferrer(state, id, patch.referrerId || null);
      if (!r.ok) return r;
    }
    return { ok: true, player: p };
  }

  /** حذف پلیر + پاک‌سازی ارجاعات وابسته (خرید اولیه، معرفی‌ها، عضویت در شبکه) */
  function removePlayer(state, id) {
    const i = state.players.findIndex(p => p.id === id);
    if (i < 0) return { ok: false, code: 'NO_PLAYER', reason: 'پلیر یافت نشد.' };
    const removed = state.players.splice(i, 1)[0];
    state.firstPurchases = (state.firstPurchases || []).filter(e => e.agentId !== id);
    state.players.forEach(p => {
      if (p.referrerId === id) p.referrerId = null;
      if (p.partnerId === id) p.partnerId = null;
    });
    return { ok: true, player: removed };
  }

  /** اعتبارسنجی منطقی ورودی‌ها (هشدار/خطا؛ محاسبه را متوقف نمی‌کند) */
  function validate(state) {
    const issues = [];
    const names = {};
    state.players.forEach(p => {
      names[p.name] = (names[p.name] || 0) + 1;
      if (p.targetDevices > p.regDevices) {
        issues.push({ level: 'error', code: 'TARGET_GT_REG', playerId: p.id,
          msg: `«${p.name}»: دستگاه مشمول تارگت (${p.targetDevices}) از دستگاه ثبت‌شده (${p.regDevices}) بیشتر است.` });
      }
      if (p.type === 'agent') {
        const fp = referrals.getFirstPurchase(state, p.id);
        if (!p.partnerId) issues.push({ level: 'warn', code: 'NO_PARTNER', playerId: p.id,
          msg: `«${p.name}» شریک مربوطه ندارد؛ حق ثبت نماینده به شریک (قدیم/جدید) برای او محاسبه نمی‌شود.` });
        if (fp && fp.devices > p.regDevices) issues.push({ level: 'error', code: 'FP_GT_REG', playerId: p.id,
          msg: `«${p.name}»: خرید اولیه (${fp.devices}) از کل دستگاه ثبت‌شده (${p.regDevices}) بیشتر است.` });
        if (p.referrerId) {
          const st = referrals.referralStatus(state, p);
          if (!st.eligible) issues.push({ level: 'info', code: 'REF_PENDING', playerId: p.id,
            msg: `«${p.name}» معرفی شده اما شرایط حق معرفی کامل نیست (${st.missing.join('، ')})؛ تا تکمیل، حق معرفی ایجاد نمی‌شود.` });
        }
      }
    });
    Object.keys(names).forEach(n => { if (names[n] > 1) issues.push({ level: 'warn', code: 'DUP_NAME', msg: `نام «${n}» برای ${names[n]} پلیر تکرار شده است.` }); });
    return issues.concat(referrals.audit(state));
  }

  /* ---------- نرمال‌سازی داده (بازیابی از ذخیره‌سازی/پشتیبان) ---------- */
  function mergeDeep(base, extra) {
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return base;
    Object.keys(base).forEach(k => {
      if (!(k in extra)) return;
      if (base[k] !== null && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = mergeDeep(base[k], extra[k]);
      else base[k] = extra[k];
    });
    return base;
  }
  function numOrNull(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('ساختار داده نامعتبر است.');
    const s = newState();
    s.config = mergeDeep(calc.defaultConfig(), raw.config || {});
    // مقادیر override و سقف‌ها باید عدد یا null باشند
    ['targetRateOverride'].forEach(k => { s.config.partner[k] = numOrNull(s.config.partner[k]); });
    ['approvedPriceOverride', 'budgetOverride'].forEach(k => { s.config.agent[k] = numOrNull(s.config.agent[k]); });
    s.config.budgetCap.partner = numOrNull(s.config.budgetCap.partner);
    s.config.budgetCap.agent = numOrNull(s.config.budgetCap.agent);

    const ids = new Set();
    // مهاجرت غیرمخرب: دادهٔ قدیمی فیلدهای ثبت‌نام/مدارک ندارد؛ نمایندگانی که قبلاً خرید اولیه‌شان ثبت شده «تکمیل/تأیید» فرض می‌شوند تا مبالغ قبلی تغییر نکند
    const legacyFp = new Set((Array.isArray(raw.firstPurchases) ? raw.firstPurchases : []).filter(e => e && e.agentId).map(e => e.agentId));
    (Array.isArray(raw.players) ? raw.players : []).forEach(p => {
      if (!p || (p.type !== 'partner' && p.type !== 'agent') || !p.id || ids.has(p.id)) return;
      ids.add(p.id);
      const np = {
        id: String(p.id), name: String(p.name || 'بدون نام'), type: p.type,
        partnerId: p.type === 'agent' ? (p.partnerId || null) : null,
        referrerId: p.type === 'agent' ? (p.referrerId || null) : null,
        regDevices: count(p.regDevices), targetDevices: count(p.targetDevices)
      };
      if (p.type === 'agent') {
        np.registrationCompleted = typeof p.registrationCompleted === 'boolean' ? p.registrationCompleted : legacyFp.has(p.id);
        np.docsApproved = typeof p.docsApproved === 'boolean' ? p.docsApproved : legacyFp.has(p.id);
      }
      s.players.push(np);
    });
    const agentSeen = new Set();
    (Array.isArray(raw.firstPurchases) ? raw.firstPurchases : []).forEach(e => {
      if (!e || !e.id || !ids.has(e.agentId) || agentSeen.has(e.agentId)) return; // حذف تکراری/یتیم
      agentSeen.add(e.agentId);
      s.firstPurchases.push({ id: String(e.id), agentId: e.agentId, devices: count(e.devices), createdAt: e.createdAt || null });
    });
    const maxNum = (arr, re) => arr.reduce((m, x) => { const t = re.exec(x); return t ? Math.max(m, Number(t[1])) : m; }, 0);
    s.seq.player = Math.max(Number(raw.seq && raw.seq.player) || 0, maxNum(s.players.map(p => p.id), /^P-(\d+)$/));
    s.seq.fp = Math.max(Number(raw.seq && raw.seq.fp) || 0, maxNum(s.firstPurchases.map(e => e.id), /^FP-(\d+)$/));
    s.meta = Object.assign(s.meta, raw.meta || {});
    return s;
  }

  /** داده نمونه (برای آزمون سریع؛ قابل پاک‌سازی) */
  function sampleState() {
    const s = newState();
    const P1 = addPlayer(s, { name: 'شریک نمونه ۱', type: 'partner', regDevices: 20, targetDevices: 12 }).player;
    const A1 = addPlayer(s, { name: 'نماینده الف', type: 'agent', partnerId: P1.id, regDevices: 15, targetDevices: 8 }).player;
    const A2 = addPlayer(s, { name: 'نماینده ب', type: 'agent', partnerId: P1.id, regDevices: 12, targetDevices: 6 }).player;
    const A3 = addPlayer(s, { name: 'نماینده ج', type: 'agent', partnerId: P1.id, regDevices: 8, targetDevices: 3 }).player;
    [A1, A2, A3].forEach(a => { a.registrationCompleted = true; a.docsApproved = true; });
    referrals.setReferrer(s, A1.id, P1.id);   // الف توسط شریک معرفی شده
    referrals.setReferrer(s, A2.id, A1.id);   // ب توسط الف
    referrals.setReferrer(s, A3.id, A2.id);   // ج توسط ب (الف بابت ج سهمی ندارد)
    referrals.registerFirstPurchase(s, A1.id, 10);
    referrals.registerFirstPurchase(s, A2.id, 10);
    referrals.registerFirstPurchase(s, A3.id, 8);
    return s;
  }

  return {
    STATE_VERSION, TYPE_LABEL, newState, normalizeState, sampleState,
    getPlayer, partners, agents, addPlayer, updatePlayer, removePlayer, validate
  };
});

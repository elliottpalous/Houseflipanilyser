(function () {
  'use strict';

  /* ============ Theme toggle ============ */
  var themeBtn = document.getElementById('theme-toggle');
  var root = document.documentElement;
  var theme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);
  updateThemeIcon();

  themeBtn.addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    updateThemeIcon();
  });

  function updateThemeIcon() {
    themeBtn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    themeBtn.innerHTML = theme === 'dark'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  /* ============ Currency / number formatting ============ */
  var gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmt(v) { return gbp.format(isFinite(v) ? v : 0); }
  function fmtPct(v) { return (isFinite(v) ? v : 0).toFixed(1) + '%'; }

  /* ============ Refurb cost/m² benchmarks (BRR reference) ============ */
  var REFURB_DEFAULTS = { light: 500, medium: 1200, heavy: 2000, structural: 2500 };

  /* ============ SDLT (England residential, progressive slabs) ============ */
  var SDLT_STANDARD = [
    { limit: 125000, rate: 0 },
    { limit: 250000, rate: 0.02 },
    { limit: 925000, rate: 0.05 },
    { limit: 1500000, rate: 0.10 },
    { limit: Infinity, rate: 0.12 }
  ];
  var SDLT_SURCHARGE = [
    { limit: 125000, rate: 0.05 },
    { limit: 250000, rate: 0.07 },
    { limit: 925000, rate: 0.10 },
    { limit: 1500000, rate: 0.15 },
    { limit: Infinity, rate: 0.17 }
  ];
  function calcSDLT(price, surcharge) {
    var bands = surcharge ? SDLT_SURCHARGE : SDLT_STANDARD;
    var remaining = Math.max(0, price);
    var prevLimit = 0;
    var tax = 0;
    for (var i = 0; i < bands.length; i++) {
      if (remaining <= 0) break;
      var bandSize = bands[i].limit - prevLimit;
      var taxable = Math.min(remaining, bandSize);
      tax += taxable * bands[i].rate;
      remaining -= taxable;
      prevLimit = bands[i].limit;
    }
    return tax;
  }

  /* ============ DOM refs ============ */
  var $ = function (id) { return document.getElementById(id); };

  var inputs = {
    purchasePrice: $('in-purchase-price'),
    sqmPre: $('in-sqm-pre'),
    financeType: $('in-finance-type'),
    depositPct: $('in-deposit-pct'),
    surchargeApplies: $('in-surcharge'),
    legalFees: $('in-legal-fees'),
    refurbType: $('in-refurb-type'),
    sqmPost: $('in-sqm-post'),
    refurbPerSqm: $('in-refurb-per-sqm'),
    vacantMonths: $('in-vacant-months'),
    interestRate: $('in-interest-rate'),
    monthlyBills: $('in-monthly-bills'),
    monetisation: $('in-monetisation'),
    salePerSqm: $('in-sale-per-sqm'),
    agentFeePct: $('in-agent-fee-pct')
  };

  var refurbTouched = false; // tracks manual override of refurb cost/m²

  inputs.refurbPerSqm.addEventListener('input', function () { refurbTouched = true; render(); });
  inputs.refurbType.addEventListener('change', function () {
    refurbTouched = false;
    inputs.refurbPerSqm.value = REFURB_DEFAULTS[inputs.refurbType.value];
    render();
  });

  inputs.financeType.addEventListener('change', function () {
    var isCash = inputs.financeType.value === 'cash';
    inputs.depositPct.disabled = isCash;
    inputs.interestRate.disabled = isCash;
    if (isCash) { inputs.depositPct.dataset.prev = inputs.depositPct.value; inputs.depositPct.value = 100; }
    else if (inputs.depositPct.dataset.prev) { inputs.depositPct.value = inputs.depositPct.dataset.prev; }
    render();
  });

  Object.keys(inputs).forEach(function (key) {
    var el = inputs[key];
    if (el === inputs.refurbPerSqm || el === inputs.refurbType || el === inputs.financeType) return;
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  /* ============ Core calc ============ */
  function readBase() {
    var isCash = inputs.financeType.value === 'cash';
    return {
      purchasePrice: parseFloat(inputs.purchasePrice.value) || 0,
      sqmPre: parseFloat(inputs.sqmPre.value) || 0,
      isCash: isCash,
      depositPct: isCash ? 100 : (parseFloat(inputs.depositPct.value) || 0),
      surchargeApplies: inputs.surchargeApplies.checked,
      legalFees: parseFloat(inputs.legalFees.value) || 0,
      refurbType: inputs.refurbType.value,
      sqmPost: parseFloat(inputs.sqmPost.value) || 0,
      refurbPerSqm: parseFloat(inputs.refurbPerSqm.value) || 0,
      vacantMonths: parseFloat(inputs.vacantMonths.value) || 0,
      interestRate: isCash ? 0 : (parseFloat(inputs.interestRate.value) || 0),
      monthlyBills: parseFloat(inputs.monthlyBills.value) || 0,
      monetisation: inputs.monetisation.value,
      salePerSqm: parseFloat(inputs.salePerSqm.value) || 0,
      agentFeePct: parseFloat(inputs.agentFeePct.value) || 0
    };
  }

  function calcScenario(base, rateDelta, monthsDelta) {
    rateDelta = rateDelta || 0;
    monthsDelta = monthsDelta || 0;
    var rate = base.interestRate + rateDelta;
    var vacantMonths = base.vacantMonths + monthsDelta;

    var mortgageAmount = base.isCash ? 0 : base.purchasePrice * (1 - base.depositPct / 100);
    var depositAmount = base.isCash ? base.purchasePrice : base.purchasePrice * (base.depositPct / 100);
    var stampDuty = calcSDLT(base.purchasePrice, base.surchargeApplies);
    var refurbCosts = base.sqmPost * base.refurbPerSqm;
    var monthlyMortgageInterest = base.isCash ? 0 : mortgageAmount * (rate / 100 / 12);
    var totalMortgageInterest = monthlyMortgageInterest * vacantMonths;
    var totalVacantCosts = totalMortgageInterest + base.monthlyBills * vacantMonths;
    var totalCashIn = depositAmount + stampDuty + base.legalFees + refurbCosts + totalVacantCosts;
    var estimatedSalePrice = base.salePerSqm * base.sqmPost;
    var agentFees = estimatedSalePrice * (base.agentFeePct / 100);
    var profit = estimatedSalePrice - agentFees - totalCashIn - mortgageAmount;
    var roi = totalCashIn > 0 ? (profit / totalCashIn) * 100 : 0;

    return {
      mortgageAmount: mortgageAmount,
      depositAmount: depositAmount,
      stampDuty: stampDuty,
      refurbCosts: refurbCosts,
      monthlyMortgageInterest: monthlyMortgageInterest,
      totalMortgageInterest: totalMortgageInterest,
      totalVacantCosts: totalVacantCosts,
      totalCashIn: totalCashIn,
      estimatedSalePrice: estimatedSalePrice,
      agentFees: agentFees,
      profit: profit,
      roi: roi,
      vacantMonthsUsed: vacantMonths,
      rateUsed: rate
    };
  }

  /* ============ Render ============ */
  function render() {
    var base = readBase();
    var r = calcScenario(base, 0, 0);
    var isRefinance = base.monetisation === 'refinance';
    var profitLabel = isRefinance ? 'Net Equity Released' : 'Flip Profit';

    // Purchase inputs section
    $('lbl-mortgage').textContent = base.isCash ? 'Mortgage (n/a — cash purchase)' : 'Mortgage';
    $('out-mortgage').textContent = fmt(r.mortgageAmount);
    $('out-deposit').textContent = fmt(r.depositAmount);
    $('out-sdlt').textContent = fmt(r.stampDuty);

    // Vacant period & finance
    $('out-refurb-costs').textContent = fmt(r.refurbCosts);
    $('out-mortgage-interest').innerHTML = fmt(r.totalMortgageInterest) +
      '<span class="computed-sub">' + fmt(r.monthlyMortgageInterest) + '/mo' + (base.isCash ? ' — cash purchase, no interest' : '') + '</span>';
    $('out-vacant-costs').textContent = fmt(r.totalVacantCosts);
    $('out-cash-in').textContent = fmt(r.totalCashIn);

    // Cash out
    $('out-sale-price').textContent = fmt(r.estimatedSalePrice);
    $('out-agent-fees').textContent = fmt(r.agentFees);
    $('lbl-profit').textContent = profitLabel;
    var profitCell = $('out-profit');
    profitCell.textContent = fmt(r.profit);
    profitCell.classList.toggle('positive', r.profit >= 0);
    profitCell.classList.toggle('negative', r.profit < 0);
    var roiCell = $('out-roi');
    roiCell.textContent = fmtPct(r.roi);
    roiCell.classList.toggle('positive', r.roi >= 0);
    roiCell.classList.toggle('negative', r.roi < 0);

    // KPI cards
    $('kpi-cash-in').textContent = fmt(r.totalCashIn);
    $('kpi-profit-label').textContent = profitLabel;
    var kpiProfit = $('kpi-profit');
    kpiProfit.textContent = fmt(r.profit);
    kpiProfit.classList.toggle('positive', r.profit >= 0);
    kpiProfit.classList.toggle('negative', r.profit < 0);
    $('kpi-profit-sub').textContent = isRefinance
      ? 'Equity released on refinance, net of cash in and mortgage repayment'
      : 'Net of agent fees, cash in and mortgage repayment';
    var kpiRoi = $('kpi-roi');
    kpiRoi.textContent = fmtPct(r.roi);
    kpiRoi.classList.toggle('positive', r.roi >= 0);
    kpiRoi.classList.toggle('negative', r.roi < 0);

    renderStress(base, r);
  }

  /* ============ Stress test ============ */
  var stressRate = $('stress-rate');
  var stressMonths = $('stress-months');
  stressRate.addEventListener('input', function () {
    $('stress-rate-label').textContent = '+' + parseFloat(stressRate.value).toFixed(2) + '%';
    render();
  });
  stressMonths.addEventListener('input', function () {
    $('stress-months-label').textContent = '+' + stressMonths.value + ' mo';
    render();
  });

  function renderStress(base, baseResult) {
    var rateDelta = parseFloat(stressRate.value) || 0;
    var monthsDelta = parseFloat(stressMonths.value) || 0;
    var s = calcScenario(base, rateDelta, monthsDelta);

    $('cmp-cashin-base').textContent = fmt(baseResult.totalCashIn);
    $('cmp-cashin-stress').textContent = fmt(s.totalCashIn);

    $('cmp-profit-base').textContent = fmt(baseResult.profit);
    var profitStressEl = $('cmp-profit-stress');
    profitStressEl.textContent = fmt(s.profit);
    profitStressEl.classList.remove('positive', 'negative');
    profitStressEl.classList.add(s.profit >= baseResult.profit ? 'positive' : 'negative');

    $('cmp-roi-base').textContent = fmtPct(baseResult.roi);
    var roiStressEl = $('cmp-roi-stress');
    roiStressEl.textContent = fmtPct(s.roi);
    roiStressEl.classList.remove('positive', 'negative');
    roiStressEl.classList.add(s.roi >= baseResult.roi ? 'positive' : 'negative');

    $('apply-stress').onclick = function () {
      inputs.interestRate.value = (base.interestRate + rateDelta).toFixed(2);
      inputs.vacantMonths.value = (base.vacantMonths + monthsDelta);
      stressRate.value = 0;
      stressMonths.value = 0;
      $('stress-rate-label').textContent = '+0.0%';
      $('stress-months-label').textContent = '+0 mo';
      render();
    };
  }

  /* ============ Reset ============ */
  var DEFAULTS = {
    'in-purchase-price': 350000, 'in-sqm-pre': 85, 'in-finance-type': 'mortgage',
    'in-deposit-pct': 25, 'in-surcharge': true, 'in-legal-fees': 1500,
    'in-refurb-type': 'medium', 'in-sqm-post': 95, 'in-refurb-per-sqm': 1200,
    'in-vacant-months': 6, 'in-interest-rate': 6.5, 'in-monthly-bills': 250,
    'in-monetisation': 'flip', 'in-sale-per-sqm': 6500, 'in-agent-fee-pct': 1
  };
  $('reset-btn').addEventListener('click', function () {
    Object.keys(DEFAULTS).forEach(function (id) {
      var el = $(id);
      if (el.type === 'checkbox') el.checked = DEFAULTS[id];
      else el.value = DEFAULTS[id];
    });
    inputs.depositPct.disabled = false;
    inputs.interestRate.disabled = false;
    refurbTouched = false;
    stressRate.value = 0;
    stressMonths.value = 0;
    $('stress-rate-label').textContent = '+0.0%';
    $('stress-months-label').textContent = '+0 mo';
    render();
  });

  /* ============ Export ============ */
  /* html2canvas can't reliably render live values inside <input>/<select>
     controls, so for capture we swap every form control in the capture
     area for a plain-text stand-in mirroring its current value, snapshot
     the DOM, then restore the real controls. */
  function withCaptureStyles(fn) {
    var el = $('analyser-capture');
    var swaps = [];

    function swapNode(node, text, extraClass) {
      var span = document.createElement('span');
      span.textContent = text;
      span.className = 'capture-static' + (extraClass ? ' ' + extraClass : '');
      node.parentNode.insertBefore(span, node);
      node.style.display = 'none';
      swaps.push({ node: node, span: span });
    }

    el.querySelectorAll('select').forEach(function (sel) {
      swapNode(sel, sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '', 'capture-static-select');
    });
    var hiddenSymbols = [];
    el.querySelectorAll('.currency-input-wrap .curr-symbol').forEach(function (sym) {
      hiddenSymbols.push({ node: sym, prev: sym.style.display });
      sym.style.display = 'none';
    });

    el.querySelectorAll('input.field-input').forEach(function (inp) {
      var wrap = inp.closest('.currency-input-wrap');
      var text = wrap ? fmt(parseFloat(inp.value) || 0) : inp.value;
      swapNode(inp, text, 'capture-static-input');
    });
    el.querySelectorAll('input.inline-pct').forEach(function (inp) {
      swapNode(inp, inp.value, 'capture-static-pct');
    });

    var result = fn(el);
    var cleanup = function () {
      swaps.forEach(function (s) {
        s.node.style.display = '';
        s.span.remove();
      });
      hiddenSymbols.forEach(function (h) { h.node.style.display = h.prev; });
    };
    if (result && typeof result.then === 'function') {
      return result.then(function (v) { cleanup(); return v; }, function (e) { cleanup(); throw e; });
    }
    cleanup();
    return result;
  }

  $('export-png').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    withCaptureStyles(function (el) {
      return html2canvas(el, { backgroundColor: getComputedStyle(document.body).getPropertyValue('--color-bg') || '#ffffff', scale: 2 }).then(function (canvas) {
        var link = document.createElement('a');
        link.download = 'house-flip-analyser.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      });
    }).catch(function () {}).then(function () { btn.disabled = false; });
  });

  $('export-pdf').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    withCaptureStyles(function (el) {
      return html2canvas(el, { backgroundColor: '#ffffff', scale: 2 }).then(function (canvas) {
        var imgData = canvas.toDataURL('image/jpeg', 0.92);
        var jsPDFCtor = window.jspdf.jsPDF;
        var pdfWidth = 595.28;
        var pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        var pdf = new jsPDFCtor({ orientation: 'p', unit: 'pt', format: [pdfWidth, Math.max(pdfHeight, 841.89)], compress: true });
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        pdf.save('house-flip-analyser.pdf');
      });
    }).catch(function () {}).then(function () { btn.disabled = false; });
  });

  /* ============ Init ============ */
  render();
})();

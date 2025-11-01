/*=====================================================================
  MyFi – Popup UI (v2)
  • Shows total spend + last-scanned
  • Triggers background scan
  • Renders category list + Chart.js pie chart
  • Generates smart-savings insights

document.addEventListener('DOMContentLoaded', () => {
  // -----------------------------------------------------------------
  // Elements
  // -----------------------------------------------------------------
  const generateBtn      = document.getElementById('generate-insights');
  const totalEl          = document.getElementById('total-amount');
  const lastScannedEl    = document.createElement('p'); // will be added once
  lastScannedEl.id = 'last-scanned-line';
  lastScannedEl.className = 'text-xs text-neutral-500 text-right mt-1';
  document.querySelector('.py-2.pt-4').appendChild(lastScannedEl);

  const insightsSection  = document.getElementById('insightsSection');
  const savingsPrompt    = document.getElementById('savingsPrompt');

  let spendingChart = null;               // keep reference to destroy later
  window.currentReceiptData = null;       // for insights

  // -----------------------------------------------------------------
  // Helper UI
  // -----------------------------------------------------------------
  const showStatus = (msg, type = 'info') => {
    statusDiv.textContent = msg;
    statusDiv.className = `text-center text-sm mt-2 ${type === 'loading' ? 'text-neutral-600' : 'text-red-600'}`;
    statusDiv.classList.remove('hidden');
  };
  const hideStatus = () => statusDiv.classList.add('hidden');

  // -----------------------------------------------------------------
  // Load data from storage
  // -----------------------------------------------------------------
  const loadData = () => {
    chrome.storage.local.get(['extractedData', 'lastScanned', 'error'], res => {
      hideStatus();

      if (res.error) {
        showStatus('Error: ' + res.error, 'error');
        return;
      }

      const receipts = (res.extractedData || []).filter(r => r.amount > 0 && !r.error);
      window.currentReceiptData = receipts;

      // ---- total & last-scanned -------------------------------------------------
      const total = receipts.reduce((s, r) => s + r.amount, 0).toFixed(2);
      totalEl.textContent = total;

      const scanTime = res.lastScanned
        ? new Date(res.lastScanned).toLocaleString()
        : '–';
      lastScannedEl.textContent = `Last scanned: ${scanTime}`;

      // ---- UI visibility --------------------------------------------------------
      if (receipts.length === 0) {
        document.getElementById('noData')?.classList.remove('hidden');
        savingsPrompt.classList.add('hidden');
        insightsSection.classList.add('hidden');
        renderDashboard({});               // clear chart / list
        return;
      }

      document.getElementById('noData')?.classList.add('hidden');
      renderDashboard(receipts);
      if (total > 0) savingsPrompt.classList.remove('hidden');
    });
  };

  // -----------------------------------------------------------------
  // Scan button – change text + spinner while scanning
  // -----------------------------------------------------------------
  generateBtn.addEventListener('click', () => {
    // Change button to "Scanning..." with spinner
    generateBtn.disabled = true;
    const originalHTML = generateBtn.innerHTML;
    generateBtn.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-5 w-5 text-neutral-200 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      Scanning...
    `;

    chrome.runtime.sendMessage({ action: 'refreshEmails' }, resp => {
      if (chrome.runtime.lastError || !resp?.status) {
        // Revert on error
        generateBtn.innerHTML = originalHTML;
        generateBtn.disabled = false;
        showStatus && showStatus('Failed to start scan', 'error');
        return;
      }
      const pollForCompletion = (onDone) => {
        chrome.storage.local.get(['lastScanned', 'error'], res => {
          if (res.error) {
            showStatus && showStatus('Scan error: ' + res.error, 'error');
            onDone && onDone();
            return;
          }
          if (res.lastScanned && Date.now() - res.lastScanned < 8000) {
            loadData();
            onDone && onDone();
          } else {
            setTimeout(() => pollForCompletion(onDone), 1200);
          }
        });
      };
    });
  });
  // -----------------------------------------------------------------
  // Render category list + Chart.js pie chart
  // -----------------------------------------------------------------
  const renderDashboard = data => {
    const container = document.querySelector('.border-2.border-neutral-300');
    if (!data || Object.keys(data).length === 0) {
      container.innerHTML = `<p class="text-sm text-center text-neutral-500">Scan receipts to see breakdown</p>`;
      if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
      return;
    }

    // ---- aggregate by category ------------------------------------------------
    const cats = {};
    data.forEach(r => {
      const c = r.category || 'other';
      cats[c] = (cats[c] || 0) + r.amount;
    });

    // ---- HTML for list --------------------------------------------------------
    let html = `<div class="p-3"><p class="text-sm font-semibold mb-2">Category Breakdown</p>`;
    Object.entries(cats)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, amt]) => {
        html += `
          <div class="flex justify-between items-center py-1 text-sm">
            <span>${getCategoryEmoji(cat)} ${capitalizeFirst(cat)}</span>
            <span class="font-semibold">₹${amt.toFixed(2)}</span>
          </div>`;
      });
    html += `</div>`;

    // ---- Chart section --------------------------------------------------------
    html += `
      <div class="p-3 mt-4">
        <p class="text-sm font-semibold mb-2">Spending Analysis</p>
        <div class="relative mx-auto" style="max-width:300px;">
          <canvas id="spendingChart"></canvas>
        </div>
      </div>`;

    container.innerHTML = html;

    // ---- Initialise Chart.js --------------------------------------------------
    const ctx = document.getElementById('spendingChart').getContext('2d');
    if (spendingChart) spendingChart.destroy();

    spendingChart = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: Object.keys(cats).map(capitalizeFirst),
        datasets: [{
          data: Object.values(cats),
          backgroundColor: [
            '#FF6384', // food
            '#36A2EB', // groceries
            '#FFCE56', // shopping
            '#4BC0C0', // travel
            '#9966FF', // entertainment
            '#E7E9ED'  // other
          ],
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.label}: ₹${ctx.parsed.toFixed(2)}`
            }
          }
        }
      }
    });
  };

  // -----------------------------------------------------------------
  // Smart-savings assistant (unchanged logic, just moved into a function)
  // -----------------------------------------------------------------
  const generateSmartInsights = () => {
    const data = window.currentReceiptData;
    if (!data || data.length === 0) {
      alert('No receipt data available. Please scan emails first.');
      return;
    }

    savingsPrompt.classList.add('hidden');
    insightsSection.classList.remove('hidden');

    const total = data.reduce((s, r) => s + r.amount, 0);
    const catTotals = data.reduce((acc, r) => {
      acc[r.category] = (acc[r.category] || 0) + r.amount;
      return acc;
    }, {});

    const insights = [];
    let potentialSavings = 0;
    const opps = [];

    // Shopping
    if (catTotals.shopping) {
      const pct = (catTotals.shopping / total) * 100;
      if (pct > 40) {
        const save = catTotals.shopping * 0.25;
        potentialSavings += save;
        opps.push({
          cat: 'shopping',
          amount: save,
          text: `Shopping’s eating ${pct.toFixed(0)}% of your wallet (₹${catTotals.shopping.toFixed(2)}). `
              + `Make a wishlist, wait 24 h, and shop sales to save ~₹${save.toFixed(2)}! `
              + `*Action*: Set a weekly limit & review Sunday.`
        });
      }
    }

    // Travel
    if (catTotals.travel) {
      const trips = data.filter(r => r.category === 'travel');
      const avg = catTotals.travel / trips.length;
      if (avg > 100) {
        const save = catTotals.travel * 0.2;
        potentialSavings += save;
        opps.push({
          cat: 'travel',
          amount: save,
          text: `Rides average ₹${avg.toFixed(2)}. Carpool or use public transport for short trips to pocket ~₹${save.toFixed(2)}! `
              + `*Action*: Switch to bus/metro for trips < 5 km.`
        });
      }
    }

    // Food
    if (catTotals.food) {
      const pct = (catTotals.food / total) * 100;
      if (pct > 30) {
        const save = catTotals.food * 0.3;
        potentialSavings += save;
        opps.push({
          cat: 'food',
          amount: save,
          text: `Food delivery is ${pct.toFixed(0)}% (₹${catTotals.food.toFixed(2)}). Cook 3× a week to save ~₹${save.toFixed(2)}! `
              + `*Action*: Plan 3 simple meals this week.`
        });
      }
    }

    // Sort & pick top 2
    opps.sort((a, b) => b.amount - a.amount);
    insights.push(...opps.slice(0, 2));

    // General budget tip
    const budgetSave = total * 0.15;
    if (budgetSave > 0) {
      potentialSavings += budgetSave;
      insights.push({
        icon: 'Target',
        text: `Set a ₹${(total * 0.85).toFixed(2)} budget (15 % less) and track daily to save ~₹${budgetSave.toFixed(2)}! `
            + `*Action*: Use a budgeting app or notebook.`
      });
    }

    // Render
    document.getElementById('savingsPotential')
            .textContent = `Potential Monthly Savings: ₹${potentialSavings.toFixed(2)}`;

    const list = document.getElementById('insightsList');
    list.innerHTML = '';
    insights.forEach((i, idx) => {
      const colors = ['bg-yellow-50 border-yellow-200',
                      'bg-blue-50 border-blue-200',
                      'bg-green-50 border-green-200'];
      const div = document.createElement('div');
      div.className = `border ${colors[idx % colors.length]} rounded-lg p-3 mb-2`;
      div.innerHTML = `<p class="text-sm text-neutral-700">
        <span class="text-lg mr-1">${i.icon || getCategoryEmoji(i.cat)}</span>${i.text}
      </p>`;
      list.appendChild(div);
    });
  };

  // -----------------------------------------------------------------
  // Click → show insights
  // -----------------------------------------------------------------
  document.addEventListener('click', e => {
    if (e.target.id === 'showInsightsBtn' || e.target.closest('#showInsightsBtn')) {
      generateSmartInsights();
    }
  });

  // -----------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------
  function getCategoryEmoji(cat) {
    const map = {
      food: 'Burger', groceries: 'Shopping Cart', shopping: 'Shopping Bags',
      travel: 'Taxi', entertainment: 'Clapper Board', other: 'Package'
    };
    return map[cat] || 'Package';
  }

  function capitalizeFirst(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // -----------------------------------------------------------------
  // Initial load
  // -----------------------------------------------------------------
  loadData();
});
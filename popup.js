document.addEventListener("DOMContentLoaded", () => {
  console.log("Popup loaded");
  const generateInsights = document.getElementById("generate-insights");
  const totalAmount = document.getElementById("total-amount");
  const loading = document.createElement("div");
  loading.id = "loading";
  loading.className = "text-center text-neutral-500 mt-2 hidden";
  loading.textContent = "Scanning emails...";
  document.querySelector(".border-neutral-300").appendChild(loading);

  const noData = document.createElement("div");
  noData.id = "noData";
  noData.className = "text-center text-neutral-500 mt-2 hidden";
  noData.textContent = "No receipts found. Scan again?";
  document.querySelector(".border-neutral-300").appendChild(noData);

  const adviceList = document.createElement("ul");
  adviceList.id = "adviceList";
  adviceList.className = "list-disc pl-5 text-sm text-neutral-600 mt-2";
  document
    .querySelector(".border-2.border-neutral-300")
    .appendChild(adviceList);

  function renderData() {
    chrome.storage.local.get(
      ["extractedData", "lastScanned"],
      ({ extractedData, lastScanned }) => {
        console.log("Rendering data:", { extractedData, lastScanned });
        if (extractedData && extractedData.length > 0) {
          renderDashboard(extractedData);
          totalAmount.textContent = extractedData
            .reduce((sum, item) => sum + item.amount, 0)
            .toFixed(2);
          const lastScanDiv = document.createElement("p");
          lastScanDiv.className = "text-sm text-neutral-500 mt-1";
          lastScanDiv.innerHTML = `Last Scanned: ${new Date(
            lastScanned
          ).toLocaleString()}`;
          const existingLastScan = document.querySelector(".py-2.pt-4 p");
          if (existingLastScan) existingLastScan.remove();
          document.querySelector(".py-2.pt-4").appendChild(lastScanDiv);
          renderAdvice(extractedData);
          noData.classList.add("hidden");
        } else {
          noData.classList.remove("hidden");
        }
      }
    );
  }
  renderData();

  generateInsights.addEventListener("click", () => {
    console.log("Generate Insights clicked");
    loading.classList.remove("hidden");
    noData.classList.add("hidden");
    chrome.runtime.sendMessage({ action: "refreshEmails" }, (response) => {
      console.log("Response from background:", response);
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError.message);
        loading.classList.add("hidden");
        return;
      }
      const interval = setInterval(() => {
        chrome.storage.local.get("lastScanned", ({ lastScanned }) => {
          if (lastScanned && new Date(lastScanned) > new Date() - 10000) {
            // 10 sec threshold
            clearInterval(interval);
            loading.classList.add("hidden");
            renderData();
          }
        });
      }, 1000);
    });
  });

  function renderDashboard(data) {
    const categories = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});
    const reportDiv = document.querySelector(".border-2.border-neutral-300");
    reportDiv.innerHTML =
      '<p class="text-sm pb-2">Expenditure trend analysis</p>';
    // Add Chart.js if desired
    // const canvas = document.createElement('canvas');
    // canvas.id = 'pieChart';
    // canvas.width = 300;
    // canvas.height = 180;
    // reportDiv.insertBefore(canvas, reportDiv.firstChild);
    // new Chart(canvas, {
    //     type: 'pie',
    //     data: { labels: Object.keys(categories), datasets: [{ data: Object.values(categories), backgroundColor: ['#4CAF50', '#FF6384', '#36A2EB'] }] },
    //     options: { plugins: { legend: { position: 'bottom' } } }
    // });
  }

  function renderAdvice(data) {
    if (!data || data.length === 0) {
      adviceList.innerHTML = "<li>No data yet. Scan receipts to get tips!</li>";
      return;
    }
    const total = data.reduce((sum, item) => sum + item.amount, 0).toFixed(2);
    const daysInMonth = 30;
    const avgDailySpend = (total / daysInMonth).toFixed(2);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const nextMonthName = nextMonth.toLocaleString("default", {
      month: "long",
    });
    const categories = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});
    const topCat = Object.entries(categories).sort(
      (a, b) => b[1] - a[1]
    )[0] || ["other", 0];

    const tips = [
      `You spent $${total} this month. Aim for a $${total} budget in ${nextMonthName}!`,
      `Average daily spend: $${avgDailySpend}. Cut it by $1/day to save $${
        30 - parseFloat(avgDailySpend)
      } next month.`,
      `Focus on ${topCat[0]}—set a limit based on this month’s $${topCat[1]}.`,
    ];

    adviceList.innerHTML = tips.map((tip) => `<li>${tip}</li>`).join("");
  }
});

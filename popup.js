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

  const insightsSection = document.createElement("div");
  insightsSection.id = "insightsSection";
  insightsSection.className = "hidden mt-4 pb-4";
  insightsSection.innerHTML = `
    <div class="py-2 flex items-center">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
      </svg>
      <h2 class="font-bold text-md px-1">Smart Savings Assistant</h2>
    </div>
    <div class="bg-amber-50 border border-amber-300 rounded-lg p-3 mb-3">
      <p class="text-sm font-semibold text-amber-900" id="savingsPotential">💰 Calculating savings...</p>
    </div>
    <div class="space-y-2" id="insightsList"></div>
  `;

  const savingsPrompt = document.createElement("div");
  savingsPrompt.id = "savingsPrompt";
  savingsPrompt.className = "hidden mt-4 pb-4";
  savingsPrompt.innerHTML = `
    <div class="bg-neutral-50 border border-neutral-200 rounded-lg p-4 text-center">
      <p class="text-sm text-neutral-700 mb-3">Want to save money next month?</p>
      <button id="showInsightsBtn" class="px-4 py-2 bg-green-600 text-white rounded-lg w-full hover:bg-green-700">
        ✨ Yes, Show Me How to Save!
      </button>
    </div>
  `;

  const reportSection = document.querySelector(".pt-2.pb-6");
  reportSection.parentNode.insertBefore(savingsPrompt, reportSection);
  reportSection.parentNode.insertBefore(insightsSection, reportSection);

  const adviceList = document.createElement("ul");
  adviceList.id = "adviceList";
  adviceList.className = "list-disc pl-5 text-sm text-neutral-600 mt-2";
  document
    .querySelector(".border-2.border-neutral-300")
    .appendChild(adviceList);

  window.currentReceiptData = null;

  function renderData() {
    chrome.storage.local.get(
      ["extractedData", "lastScanned"],
      ({ extractedData, lastScanned }) => {
        console.log("Rendering data:", { extractedData, lastScanned });

        if (extractedData && extractedData.length > 0) {
          const validReceipts = extractedData.filter(
            (r) => r.amount > 0 && !r.error
          );
          window.currentReceiptData = validReceipts;

          renderDashboard(validReceipts);

          const total = validReceipts.reduce(
            (sum, item) => sum + item.amount,
            0
          );
          totalAmount.textContent = total.toFixed(2);

          const lastScanDiv = document.createElement("p");
          lastScanDiv.className = "text-sm text-neutral-500 mt-1";
          lastScanDiv.innerHTML = `Last Scanned: ${new Date(
            lastScanned
          ).toLocaleString()}`;
          const existingLastScan = document.querySelector(".py-2.pt-4 p");
          if (existingLastScan) existingLastScan.remove();
          document.querySelector(".py-2.pt-4").appendChild(lastScanDiv);

          if (total > 0) {
            savingsPrompt.classList.remove("hidden");
          }

          noData.classList.add("hidden");
        } else {
          noData.classList.remove("hidden");
          savingsPrompt.classList.add("hidden");
        }
      }
    );
  }

  renderData();

  generateInsights.addEventListener("click", () => {
    console.log("Generate Insights clicked");
    loading.classList.remove("hidden");
    noData.classList.add("hidden");
    savingsPrompt.classList.add("hidden");
    insightsSection.classList.add("hidden");

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
            clearInterval(interval);
            loading.classList.add("hidden");
            renderData();
          }
        });
      }, 1000);
    });
  });

  document.addEventListener("click", (e) => {
    if (
      e.target.id === "showInsightsBtn" ||
      e.target.closest("#showInsightsBtn")
    ) {
      generateSmartInsights();
    }
  });

  function renderDashboard(data) {
    const categories = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});

    const reportDiv = document.querySelector(".border-2.border-neutral-300");

    let categoryHTML =
      '<div class="p-3"><p class="text-sm font-semibold mb-2">Category Breakdown</p>';

    Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, amount]) => {
        const emoji = getCategoryEmoji(cat);
        categoryHTML += `
          <div class="flex justify-between items-center py-1 text-sm">
            <span>${emoji} ${capitalizeFirst(cat)}</span>
            <span class="font-semibold">₹${amount.toFixed(2)}</span>
          </div>
        `;
      });

    categoryHTML += "</div>";

    reportDiv.innerHTML = categoryHTML;
  }
  function generateSmartInsights() {
    const data = window.currentReceiptData;
    if (!data || data.length === 0) {
      alert("No receipt data available. Please scan emails first.");
      return;
    }

    savingsPrompt.classList.add("hidden");
    insightsSection.classList.remove("hidden");

    const totalAmount = data.reduce((sum, item) => sum + item.amount, 0);
    const categoryTotals = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});

    const insights = [];
    let potentialSavings = 0;

    const savingsOpportunities = [];

    if (categoryTotals.shopping > 0) {
      const shoppingSpend = categoryTotals.shopping;
      const shoppingPercentage = ((shoppingSpend / totalAmount) * 100).toFixed(
        0
      );
      if (shoppingPercentage > 40) {
        const savingsAmount = shoppingSpend * 0.25;
        potentialSavings += savingsAmount;
        savingsOpportunities.push({
          category: "shopping",
          amount: savingsAmount,
          text: `🛍️ Hold up! Shopping’s eating ${shoppingPercentage}% of your wallet (₹${shoppingSpend.toFixed(
            2
          )}). Make a wishlist, wait 24 hours before buying, and shop sales to save ~₹${savingsAmount.toFixed(
            2
          )}! 🎯\n*Action Plan*: Set a weekly shopping limit and review it every Sunday.`,
        });
      }
    }

    if (categoryTotals.travel > 0) {
      const travelSpend = categoryTotals.travel;
      const travelReceipts = data.filter((r) => r.category === "travel");
      const avgTripCost = travelSpend / travelReceipts.length;
      if (avgTripCost > 100) {
        const savingsAmount = travelSpend * 0.2;
        potentialSavings += savingsAmount;
        savingsOpportunities.push({
          category: "travel",
          amount: savingsAmount,
          text: `🚗 Oops! Rides average ₹${avgTripCost.toFixed(
            2
          )}. Carpool or hop on a bus for short trips to pocket ~₹${savingsAmount.toFixed(
            2
          )}! 🚌\n*Action Plan*: Track trips this week—switch to public transport for any under 5km.`,
        });
      }
    }

    if (categoryTotals.food > 0) {
      const foodSpend = categoryTotals.food;
      const foodPercentage = ((foodSpend / totalAmount) * 100).toFixed(0);
      if (foodPercentage > 30) {
        const savingsAmount = foodSpend * 0.3;
        potentialSavings += savingsAmount;
        savingsOpportunities.push({
          category: "food",
          amount: savingsAmount,
          text: `🍽️ Whoa, champ! Food delivery’s at ${foodPercentage}% (₹${foodSpend.toFixed(
            2
          )}). Cook at home 3x a week to save ~₹${savingsAmount.toFixed(
            2
          )}! 🔥\n*Action Plan*: Plan 3 meals this week—start with a simple recipe!`,
        });
      }
    }

    savingsOpportunities.sort((a, b) => b.amount - a.amount);
    insights.push(...savingsOpportunities.slice(0, 2));

    const recommendedBudget = totalAmount * 0.85;
    const budgetSavings = totalAmount * 0.15;
    if (budgetSavings > 0) {
      potentialSavings += budgetSavings;
      insights.push({
        icon: "🎯",
        text: `Time to shine! Set a ₹${recommendedBudget.toFixed(
          2
        )} budget (15% less than ₹${totalAmount.toFixed(
          2
        )}) and track daily like a boss to save ~₹${budgetSavings.toFixed(
          2
        )}! 💪\n*Action Plan*: Use a budgeting app or notebook to monitor daily spends.`,
      });
    }

    document.getElementById(
      "savingsPotential"
    ).textContent = `💰 Potential Monthly Savings: ₹${potentialSavings.toFixed(
      2
    )}`;

    const insightsList = document.getElementById("insightsList");
    insightsList.innerHTML = "";

    insights.forEach((insight, index) => {
      const bgColor =
        index === 0
          ? "bg-yellow-50 border-yellow-200"
          : index === 1
          ? "bg-blue-50 border-blue-200"
          : "bg-green-50 border-green-200";
      const item = document.createElement("div");
      item.className = `border ${bgColor} rounded-lg p-3 mb-2`;
      item.innerHTML = `
      <p class="text-sm text-neutral-700">
        <span class="text-lg mr-1">${
          insight.icon || getCategoryEmoji(insight.category)
        }</span>
        ${insight.text}
      </p>
    `;
      insightsList.appendChild(item);
    });
  }
  function getCategoryEmoji(category) {
    const emojis = {
      food: "🍔",
      groceries: "🛒",
      shopping: "🛍️",
      travel: "🚕",
      entertainment: "🎬",
      other: "📦",
    };
    return emojis[category] || "📦";
  }

  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
});

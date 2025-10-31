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

  const errorDiv = document.createElement("div");
  errorDiv.id = "errorMessage";
  errorDiv.className =
    "text-center text-red-600 mt-2 hidden text-sm font-medium";
  document.querySelector(".border-neutral-300").appendChild(errorDiv);

  // Chips section for top spending categories
  const chipsSection = document.createElement("div");
  chipsSection.id = "chipsSection";
  chipsSection.className =
    "hidden mt-4 pb-3 border-b border-dashed border-neutral-300";
  chipsSection.innerHTML = `
    <div class="flex items-center mb-2">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
      </svg>
      <h3 class="text-sm font-semibold text-neutral-700 ml-1">Want to save money?</h3>
    </div>
    <div id="categoryChips" class="flex flex-wrap gap-2"></div>
  `;

  // Insights display area (appears when chip is clicked)
  const insightsSection = document.createElement("div");
  insightsSection.id = "insightsSection";
  insightsSection.className = "hidden mt-3 pb-3";
  insightsSection.innerHTML = `
    <div class="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-400 rounded-lg p-3 mb-3">
      <div class="flex items-start gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5 text-emerald-700 mt-0.5 flex-shrink-0">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
        <div class="flex-1">
          <p class="text-xs font-semibold text-emerald-900 mb-1" id="insightTitle">Smart Tips</p>
          <p class="text-sm font-bold text-emerald-800" id="savingsPotential">Save up to ₹XXX</p>
        </div>
      </div>
    </div>
    <div id="insightsList" class="space-y-2"></div>
  `;

  const reportSection = document.querySelector(".pt-2.pb-6");
  reportSection.parentNode.insertBefore(chipsSection, reportSection);
  reportSection.parentNode.insertBefore(insightsSection, reportSection);

  const forceBtn = document.createElement("button");
  forceBtn.textContent = "Force Rescan";
  forceBtn.className = "text-xs text-blue-600 underline mt-2";
  forceBtn.onclick = () => {
    chrome.storage.local.remove([
      "authToken",
      "extractedData",
      "lastScanned",
      "error",
    ]);
    generateInsights.click();
  };
  document.querySelector(".py-2.pt-4").appendChild(forceBtn);

  window.currentReceiptData = null;
  window.selectedCategory = null;

  function renderData() {
    chrome.storage.local.get(
      ["extractedData", "lastScanned", "error"],
      ({ extractedData, lastScanned, error }) => {
        console.log("Rendering data:", { extractedData, lastScanned, error });

        if (error) {
          errorDiv.textContent = `${error} Click "Generate Insights" to retry.`;
          errorDiv.classList.remove("hidden");
          noData.classList.add("hidden");
          chipsSection.classList.add("hidden");
          insightsSection.classList.add("hidden");
          totalAmount.textContent = "0.00";
          return;
        } else {
          errorDiv.classList.add("hidden");
        }

        if (extractedData && extractedData.length > 0) {
          const validReceipts = extractedData.filter(
            (r) => r.amount > 0 && !r.error
          );
          window.currentReceiptData = validReceipts;

          renderDashboard(validReceipts);
          renderCategoryChips(validReceipts);

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
          const existing = document.querySelector(".py-2.pt-4 p");
          if (existing) existing.remove();
          document.querySelector(".py-2.pt-4").appendChild(lastScanDiv);

          if (total > 0) chipsSection.classList.remove("hidden");
          noData.classList.add("hidden");
        } else {
          noData.classList.remove("hidden");
          chipsSection.classList.add("hidden");
        }
      }
    );
  }

  renderData();

  generateInsights.addEventListener("click", () => {
    console.log("Generate Insights clicked");

    generateInsights.disabled = true;
    generateInsights.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-4 h-4 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
        <span>Scanning...</span>
      </div>
    `;

    errorDiv.classList.add("hidden");
    noData.classList.add("hidden");
    chipsSection.classList.add("hidden");
    insightsSection.classList.add("hidden");
    chrome.storage.local.remove(["error"]);

    chrome.runtime.sendMessage({ action: "refreshEmails" }, (response) => {
      console.log("Response from background:", response);
      if (chrome.runtime.lastError) {
        console.error("Message error:", chrome.runtime.lastError.message);
        resetButton();
        return;
      }

      const interval = setInterval(() => {
        chrome.storage.local.get("lastScanned", ({ lastScanned }) => {
          if (lastScanned && new Date(lastScanned) > new Date() - 10000) {
            clearInterval(interval);
            resetButton();
            renderData();
          }
        });
      }, 1000);
    });

    function resetButton() {
      generateInsights.disabled = false;
      generateInsights.innerHTML = `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="size-6"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
          />
        </svg>
        Scan Receipts
      `;
    }
  });

  function renderCategoryChips(data) {
    const categories = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});

    const totalAmount = data.reduce((sum, item) => sum + item.amount, 0);

    // Get top 3 categories by spending
    const topCategories = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const chipsContainer = document.getElementById("categoryChips");
    chipsContainer.innerHTML = "";

    topCategories.forEach(([category, amount]) => {
      const percentage = ((amount / totalAmount) * 100).toFixed(0);
      const emoji = getCategoryEmoji(category);

      const chip = document.createElement("button");
      chip.className = `
        flex items-center gap-1.5 px-3 py-2 rounded-full 
        border-2 transition-all duration-200
        hover:scale-105 hover:shadow-md
        ${
          window.selectedCategory === category
            ? "bg-neutral-900 border-neutral-900 text-white"
            : "bg-white border-neutral-300 text-neutral-700 hover:border-neutral-400"
        }
      `;

      chip.innerHTML = `
        <span class="text-base">${emoji}</span>
        <span class="text-xs font-semibold">${capitalizeFirst(category)}</span>
        <span class="text-xs font-bold ${
          window.selectedCategory === category
            ? "text-white"
            : "text-neutral-900"
        }">
          ₹${amount.toFixed(0)}
        </span>
      `;

      chip.addEventListener("click", () => {
        window.selectedCategory = category;
        renderCategoryChips(data); // Re-render to update active state
        showInsightsForCategory(category, amount, percentage, data);
      });

      chipsContainer.appendChild(chip);
    });
  }

  function showInsightsForCategory(category, amount, percentage, allData) {
    insightsSection.classList.remove("hidden");

    const insights = generateInsightsForCategory(
      category,
      amount,
      percentage,
      allData
    );

    document.getElementById("insightTitle").textContent = `${getCategoryEmoji(
      category
    )} ${capitalizeFirst(category)} Savings`;
    document.getElementById(
      "savingsPotential"
    ).textContent = `Save up to ₹${insights.savings.toFixed(0)}`;

    const list = document.getElementById("insightsList");
    list.innerHTML = "";

    insights.tips.forEach((tip, i) => {
      const card = document.createElement("div");
      card.className = `p-3 rounded-lg border transition-all duration-200 hover:scale-[1.02] hover:shadow-md
        ${
          i === 0
            ? "bg-slate-50 border-slate-300"
            : i === 1
            ? "bg-neutral-50 border-neutral-300"
            : "bg-stone-50 border-stone-300"
        }
      `;

      card.innerHTML = `
        <div class="flex items-start gap-2">
          <span class="text-xl flex-shrink-0">${tip.icon}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-neutral-900 mb-1">${
              tip.title
            }</p>
            <p class="text-xs text-neutral-700 leading-relaxed">${
              tip.description
            }</p>
            ${
              tip.action
                ? `<p class="text-xs italic text-neutral-600 mt-2">💡 ${tip.action}</p>`
                : ""
            }
          </div>
        </div>
      `;

      list.appendChild(card);
    });

    // Smooth scroll to insights
    insightsSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function generateInsightsForCategory(category, amount, percentage, allData) {
    const totalAmount = allData.reduce((sum, i) => sum + i.amount, 0);
    let savings = 0;
    const tips = [];

    switch (category) {
      case "shopping":
        savings = amount * 0.25;
        tips.push({
          icon: "⏰",
          title: "24-Hour Rule",
          description: `You spent ₹${amount.toFixed(
            0
          )} (${percentage}%) on shopping. Wait 24 hours before buying to avoid impulse purchases.`,
          action: "Set a weekly shopping budget",
        });
        tips.push({
          icon: "🏷️",
          title: "Hunt for Deals",
          description:
            "Use price comparison tools and wait for sales. You could save 20-30% on most purchases.",
          action: "Install browser extensions for coupons",
        });
        tips.push({
          icon: "📝",
          title: "Make a List",
          description:
            "Shop with a list to avoid unnecessary items. Stick to needs over wants.",
          action: "Create a wishlist and prioritize items",
        });
        break;

      case "travel":
        const rides = allData.filter((r) => r.category === "travel");
        const avgRide = amount / rides.length;
        savings = amount * 0.2;
        tips.push({
          icon: "🚌",
          title: "Mix Your Transport",
          description: `Avg ride: ₹${avgRide.toFixed(
            0
          )}. Consider bus/metro for longer trips and save 40-60%.`,
          action: "Track your daily commute patterns",
        });
        tips.push({
          icon: "👥",
          title: "Carpool When Possible",
          description:
            "Split ride costs with colleagues or friends for regular trips.",
          action: "Join a carpool group at work",
        });
        tips.push({
          icon: "🚶",
          title: "Walk Short Distances",
          description: "Distances under 1km? Walking is free and healthy!",
          action: "Use a step counter app",
        });
        break;

      case "food":
        savings = amount * 0.3;
        tips.push({
          icon: "🍳",
          title: "Cook at Home",
          description: `${percentage}% on food delivery. Cooking just 3 meals/week saves ₹${(
            amount * 0.3
          ).toFixed(0)}.`,
          action: "Plan 3 home-cooked meals this week",
        });
        tips.push({
          icon: "📦",
          title: "Meal Prep Sundays",
          description:
            "Prepare meals in advance to avoid ordering when tired or busy.",
          action: "Start with preparing lunch for 2 days",
        });
        tips.push({
          icon: "💳",
          title: "Skip the Extras",
          description:
            "Avoid delivery fees and surge pricing. Pick up yourself when possible.",
          action: "Use free delivery coupons only",
        });
        break;

      case "groceries":
        savings = amount * 0.15;
        tips.push({
          icon: "🛒",
          title: "Buy in Bulk",
          description:
            "Non-perishables are cheaper in larger quantities. Stock up on essentials.",
          action: "Make a monthly shopping list",
        });
        tips.push({
          icon: "🏪",
          title: "Compare Prices",
          description:
            "Local stores can be 20-30% cheaper than quick-commerce apps.",
          action: "Visit a nearby supermarket this week",
        });
        tips.push({
          icon: "📅",
          title: "Weekly Shopping",
          description:
            "Shop once a week instead of daily to reduce impulse buys.",
          action: "Create a weekly meal plan",
        });
        break;

      case "entertainment":
        savings = amount * 0.25;
        tips.push({
          icon: "🎬",
          title: "Share Subscriptions",
          description:
            "Split OTT subscriptions with family/friends to cut costs in half.",
          action: "Audit your subscriptions",
        });
        tips.push({
          icon: "🎟️",
          title: "Early Bird Bookings",
          description:
            "Book movie tickets on weekdays or matinee shows for discounts.",
          action: "Use bank card offers",
        });
        tips.push({
          icon: "🏞️",
          title: "Free Activities",
          description:
            "Parks, hiking, and community events offer free entertainment.",
          action: "Find 2 free activities this month",
        });
        break;

      default:
        savings = amount * 0.15;
        tips.push({
          icon: "💰",
          title: "Track Everything",
          description:
            "You spent ₹" +
            amount.toFixed(0) +
            " here. Being aware helps you save 10-15%.",
          action: "Review all expenses weekly",
        });
        tips.push({
          icon: "🎯",
          title: "Set a Budget",
          description: "Set a monthly limit for this category and stick to it.",
          action: "Use the 50/30/20 budgeting rule",
        });
        tips.push({
          icon: "📊",
          title: "Monitor Trends",
          description:
            "Watch for spending patterns and cut unnecessary expenses.",
          action: "Review your spending monthly",
        });
    }

    return { savings, tips };
  }

  let pieChartInstance = null;
  let barChartInstance = null;

  function renderDashboard(data) {
    const categories = data.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + item.amount;
      return acc;
    }, {});

    const reportDiv = document.querySelector(".border-2.border-neutral-300");

    // Destroy previous chart instances
    if (pieChartInstance) {
      pieChartInstance.destroy();
      pieChartInstance = null;
    }
    if (barChartInstance) {
      barChartInstance.destroy();
      barChartInstance = null;
    }

    reportDiv.innerHTML = `
      <div class="p-3">
        <p class="text-sm font-semibold mb-3">Visual Breakdown</p>
        
        <!-- Pie Chart -->
        <div class="mb-4">
          <p class="text-xs text-neutral-600 mb-2">Category Distribution</p>
          <div class="relative" style="height: 200px;">
            <canvas id="categoryPieChart"></canvas>
          </div>
        </div>

        <!-- Bar Chart -->
        <div class="mb-2">
          <p class="text-xs text-neutral-600 mb-2">Spending by Category</p>
          <div class="relative" style="height: 180px;">
            <canvas id="categoryBarChart"></canvas>
          </div>
        </div>

        <!-- Transaction List -->
        <div class="mt-4 border-t border-neutral-200 pt-3">
          <p class="text-xs text-neutral-600 mb-2">Recent Transactions</p>
          <div id="transactionList" class="space-y-2 max-h-48 overflow-y-auto"></div>
        </div>
      </div>
    `;

    // Render charts after DOM is updated
    setTimeout(() => {
      renderPieChart(categories);
      renderBarChart(categories);
      renderTransactionList(data);
    }, 50);
  }

  function renderTransactionList(data) {
    const listContainer = document.getElementById("transactionList");
    if (!listContainer) return;

    // Sort by date (most recent first)
    const sortedData = [...data].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    sortedData.forEach((transaction) => {
      const item = document.createElement("div");
      item.className =
        "flex items-center justify-between p-2 hover:bg-neutral-50 rounded-lg transition-colors";

      const emoji = getCategoryEmoji(transaction.category);
      const merchantName =
        transaction.merchant !== "Unknown"
          ? transaction.merchant
          : extractMerchantFromSubject(transaction.subject);

      // Format date nicely
      const date = new Date(transaction.date);
      const formattedDate = date.toLocaleDateString("en-IN", {
        month: "short",
        day: "numeric",
      });

      item.innerHTML = `
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <span class="text-lg flex-shrink-0">${emoji}</span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold text-neutral-900 truncate">${merchantName}</p>
            <p class="text-xs text-neutral-500">${formattedDate}</p>
          </div>
        </div>
        <span class="text-xs font-bold text-neutral-900 flex-shrink-0">₹${transaction.amount.toFixed(
          2
        )}</span>
      `;

      listContainer.appendChild(item);
    });
  }

  function extractMerchantFromSubject(subject) {
    const lower = subject.toLowerCase();
    if (lower.includes("amazon")) return "Amazon";
    if (lower.includes("flipkart")) return "Flipkart";
    if (lower.includes("swiggy")) return "Swiggy";
    if (lower.includes("zomato")) return "Zomato";
    if (lower.includes("uber")) return "Uber";
    if (lower.includes("ola")) return "Ola";
    if (lower.includes("blinkit")) return "Blinkit";
    if (lower.includes("myntra")) return "Myntra";
    if (lower.includes("ajio")) return "Ajio";
    return "Unknown";
  }

  function renderPieChart(categories) {
    const ctx = document.getElementById("categoryPieChart");
    if (!ctx) return;

    // Check if Chart.js is loaded
    if (typeof Chart === "undefined") {
      console.error("Chart.js not loaded yet");
      ctx.parentElement.innerHTML =
        '<p class="text-xs text-center text-red-500">Chart library loading...</p>';
      return;
    }

    const sortedCategories = Object.entries(categories).sort(
      (a, b) => b[1] - a[1]
    );
    const labels = sortedCategories.map(([cat]) => capitalizeFirst(cat));
    const values = sortedCategories.map(([, amount]) => amount);
    const colors = sortedCategories.map(([cat]) => getCategoryColor(cat));

    pieChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: "#ffffff",
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: {
              boxWidth: 12,
              font: { size: 10 },
              padding: 8,
              generateLabels: (chart) => {
                const data = chart.data;
                return data.labels.map((label, i) => ({
                  text: `${getCategoryEmoji(
                    sortedCategories[i][0]
                  )} ${label} ₹${data.datasets[0].data[i].toFixed(0)}`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  hidden: false,
                  index: i,
                }));
              },
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = ((context.parsed / total) * 100).toFixed(1);
                return `₹${context.parsed.toFixed(2)} (${percentage}%)`;
              },
            },
          },
        },
      },
    });
  }

  function renderBarChart(categories) {
    const ctx = document.getElementById("categoryBarChart");
    if (!ctx) return;

    const sortedCategories = Object.entries(categories).sort(
      (a, b) => b[1] - a[1]
    );
    const labels = sortedCategories.map(
      ([cat]) => `${getCategoryEmoji(cat)} ${capitalizeFirst(cat)}`
    );
    const values = sortedCategories.map(([, amount]) => amount);
    const colors = sortedCategories.map(([cat]) => getCategoryColor(cat));

    barChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Amount Spent",
            data: values,
            backgroundColor: colors,
            borderColor: colors,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 10 },
              callback: (value) => "₹" + value.toFixed(0),
            },
            grid: {
              color: "rgba(0, 0, 0, 0.05)",
            },
          },
          x: {
            ticks: {
              font: { size: 9 },
            },
            grid: {
              display: false,
            },
          },
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => `₹${context.parsed.y.toFixed(2)}`,
            },
          },
        },
      },
    });
  }

  function getCategoryColor(category) {
    const colorMap = {
      food: "#FF6B6B", // Coral Red
      groceries: "#4ECDC4", // Teal
      shopping: "#95E1D3", // Mint
      travel: "#556FB5", // Navy Blue
      entertainment: "#A8E6CF", // Soft Green
      other: "#7D8597", // Slate Gray
    };
    return colorMap[category] || "#7D8597";
  }

  function getCategoryEmoji(category) {
    const map = {
      food: "🍔",
      groceries: "🛒",
      shopping: "🛍️",
      travel: "🚖",
      entertainment: "🎬",
      other: "📦",
    };
    return map[category] || "📦";
  }

  function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
});

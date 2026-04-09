import { bindAuthUi, registerPwaWorker, requireAuthPage } from "./auth.js";
import {
  calculateAccountBalances,
  formatCurrency,
  getAccounts,
  getCategories,
  getMonthKey,
  getMonthlySummary,
  getRecentTransactions,
  getTransactions,
  groupExpensesByCategory,
  hasSeenBeginnerGuide,
  markBeginnerGuideSeen
} from "./db.js";

let expenseChart;
const QUICK_EXPENSE_STORAGE_PREFIX = "finance.quickExpenseSlots";
const QUICK_EXPENSE_BUTTONS = [
  {
    slot: "food",
    buttonId: "quickFoodExpenseBtn",
    defaultLabel: "Хүнс",
    fallbackQuery: "food",
    aliases: ["хүнс", "food", "groceries", "grocery"]
  },
  {
    slot: "kids",
    buttonId: "quickKidsExpenseBtn",
    defaultLabel: "Хүүхэд",
    fallbackQuery: "kids",
    aliases: ["хүүхэд", "kids", "baby", "kita"]
  }
];

function normalizeQuickLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isExpenseCategory(category) {
  const categoryType = String(category?.type || "").toLowerCase();
  return !categoryType || categoryType === "expense" || categoryType === "both";
}

function getQuickStorageKey(userId) {
  return `${QUICK_EXPENSE_STORAGE_PREFIX}:${userId}`;
}

function readQuickCategoryMapping(userId) {
  try {
    const raw = localStorage.getItem(getQuickStorageKey(userId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeQuickCategoryMapping(userId, mapping) {
  try {
    localStorage.setItem(getQuickStorageKey(userId), JSON.stringify(mapping));
  } catch (error) {
    // localStorage can be unavailable in private mode; fail silently.
  }
}

function findCategoryByAliases(categories, aliases) {
  const aliasSet = new Set(aliases.map((alias) => normalizeQuickLookup(alias)));
  return categories.find((category) => aliasSet.has(normalizeQuickLookup(category.name))) || null;
}

function configureQuickExpenseButtons(categories, userId) {
  const expenseCategories = categories.filter((category) => isExpenseCategory(category));
  const savedMapping = readQuickCategoryMapping(userId);
  const nextMapping = { ...savedMapping };

  QUICK_EXPENSE_BUTTONS.forEach((quickConfig) => {
    const button = document.getElementById(quickConfig.buttonId);
    if (!button) {
      return;
    }

    const categoryFromSavedId = expenseCategories.find((category) => category.id === savedMapping[quickConfig.slot]);
    const matchedCategory = categoryFromSavedId || findCategoryByAliases(expenseCategories, quickConfig.aliases);

    if (matchedCategory) {
      button.textContent = `+ ${matchedCategory.name}`;
      button.href = `./transactions.html?expenseCategoryId=${encodeURIComponent(matchedCategory.id)}`;
      nextMapping[quickConfig.slot] = matchedCategory.id;
      return;
    }

    button.textContent = `+ ${quickConfig.defaultLabel}`;
    button.href = `./transactions.html?quick=${encodeURIComponent(quickConfig.fallbackQuery)}`;
    delete nextMapping[quickConfig.slot];
  });

  writeQuickCategoryMapping(userId, nextMapping);
}

function renderAccountBalances(accounts) {
  const container = document.getElementById("dashboardAccountBalances");

  if (!accounts.length) {
    container.innerHTML = '<div class="empty-state">Данс алга байна. Эхлээд данс нэмнэ үү.</div>';
    return;
  }

  container.innerHTML = accounts
    .map((account) => {
      return `
        <div class="rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 flex items-center justify-between">
          <div>
            <p class="font-semibold">${account.name}</p>
          </div>
          <p class="font-display font-semibold">${formatCurrency(account.current_balance)}</p>
        </div>
      `;
    })
    .join("");
}

function renderSummary(summary) {
  document.getElementById("monthIncome").textContent = formatCurrency(summary.incomeTotal);
  document.getElementById("monthExpense").textContent = formatCurrency(summary.expenseTotal);
  document.getElementById("monthNet").textContent = formatCurrency(summary.net);
}

function renderBudgetStatus(summary) {
  const label = document.getElementById("budgetStatusLabel");
  const hint = document.getElementById("budgetStatusHint");
  const detail = document.getElementById("budgetStatusDetail");
  const bar = document.getElementById("budgetStatusBar");

  const income = Number(summary.incomeTotal || 0);
  const expense = Number(summary.expenseTotal || 0);

  const ratio = income > 0 ? expense / income : expense > 0 ? 1.5 : 0;
  const ratioPercent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  bar.style.width = `${ratioPercent}%`;

  if (ratio <= 0.8) {
    label.textContent = "Ногоон: хэвийн";
    hint.textContent = "Зарлага аюулгүй түвшинд байна.";
    bar.className = "h-full rounded-full bg-emerald-500";
  } else if (ratio <= 1) {
    label.textContent = "Шар: анхаарах";
    hint.textContent = "Сарын төсөв шахагдаж байна. Жижиг зардалдаа анхаарна уу.";
    bar.className = "h-full rounded-full bg-amber-500";
  } else {
    label.textContent = "Улаан: хэтэрсэн";
    hint.textContent = "Зарлага орлогоос өндөр байна.";
    bar.className = "h-full rounded-full bg-rose-600";
  }

  detail.textContent = `Зарлагын хувь: сарын орлогын ${ratioPercent}%`;
}

function renderExpenseChart(groupedExpenses) {
  const canvas = document.getElementById("expenseChart");
  const hasChartLib = typeof window.Chart !== "undefined";

  if (!hasChartLib) {
    canvas.parentElement.innerHTML = '<div class="empty-state">Графикийн сан ачаалагдсангүй.</div>';
    return;
  }

  if (expenseChart) {
    expenseChart.destroy();
  }

  if (!groupedExpenses.length) {
    expenseChart = new window.Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Зарлага алга"],
        datasets: [
          {
            data: [1],
            backgroundColor: ["#d6efe4"],
            borderColor: ["#d6efe4"]
          }
        ]
      },
      options: {
        plugins: {
          legend: {
            position: "bottom"
          }
        }
      }
    });
    return;
  }

  const palette = ["#0f8f67", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6", "#6366f1"];

  expenseChart = new window.Chart(canvas, {
    type: "doughnut",
    data: {
      labels: groupedExpenses.map((item) => item.name),
      datasets: [
        {
          data: groupedExpenses.map((item) => item.amount),
          backgroundColor: groupedExpenses.map((_, index) => palette[index % palette.length]),
          borderColor: "#ffffff",
          borderWidth: 2
        }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom"
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.label ? `${context.label}: ` : "";
              return `${label}${formatCurrency(context.parsed)}`;
            }
          }
        }
      }
    }
  });
}

function renderRecentTransactions(recentTransactions, accounts, categories) {
  const body = document.getElementById("recentTransactionsBody");

  if (!recentTransactions.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Гүйлгээ хараахан алга.</div></td></tr>';
    return;
  }

  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));

  body.innerHTML = recentTransactions
    .map((transaction) => {
      const typeLabel =
        transaction.type === "expense" ? "Зарлага" : transaction.type === "income" ? "Орлого" : "Шилжүүлэг";
      const typeClass =
        transaction.type === "expense"
          ? "type-expense"
          : transaction.type === "income"
            ? "type-income"
            : "type-transfer";

      let accountLabel = "-";
      let amountLabel = "";

      if (transaction.type === "transfer") {
        const fromAccount = accountMap[transaction.from_account_id];
        const toAccount = accountMap[transaction.to_account_id];
        accountLabel = `${fromAccount?.name || "-"} → ${toAccount?.name || "-"}`;
        amountLabel = `↔ ${formatCurrency(transaction.transfer_amount)}`;
      } else {
        const account = accountMap[transaction.account_id];
        accountLabel = account?.name || "-";

        const sign = transaction.type === "expense" ? "-" : "+";
        amountLabel = `${sign} ${formatCurrency(transaction.amount)}`;
      }

      return `
        <tr>
          <td>${transaction.date || "-"}</td>
          <td><span class="type-chip ${typeClass}">${typeLabel}</span></td>
          <td class="font-semibold">${amountLabel}</td>
          <td>${accountLabel}</td>
          <td>${categoryMap[transaction.category_id]?.name || (transaction.type === "expense" ? "Бусад" : "-")}</td>
          <td>${transaction.note || "-"}</td>
        </tr>
      `;
    })
    .join("");
}

async function setupBeginnerGuideBanner(userId) {
  const banner = document.getElementById("beginnerGuideBanner");
  const dismissBtn = document.getElementById("dismissBeginnerGuideBtn");
  if (!banner || !dismissBtn) {
    return;
  }

  let hasSeen = true;
  try {
    hasSeen = await hasSeenBeginnerGuide(userId);
  } catch (error) {
    // If reading fails, keep the UI usable and do not block dashboard rendering.
    hasSeen = true;
  }

  if (hasSeen) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  markBeginnerGuideSeen(userId).catch(() => {});

  dismissBtn.addEventListener(
    "click",
    () => {
      banner.classList.add("hidden");
    },
    { once: true }
  );
}

export async function initDashboard() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  await setupBeginnerGuideBanner(user.uid);

  const [accounts, categories, transactions] = await Promise.all([
    getAccounts(user.uid),
    getCategories(user.uid),
    getTransactions(user.uid)
  ]);

  const accountsWithBalances = calculateAccountBalances(accounts, transactions);
  const monthKey = getMonthKey();
  const summary = getMonthlySummary(transactions, monthKey);
  const expensesByCategory = groupExpensesByCategory(transactions, categories, monthKey);
  const recentTransactions = getRecentTransactions(transactions, 8);

  configureQuickExpenseButtons(categories, user.uid);
  renderAccountBalances(accountsWithBalances);
  renderSummary(summary);
  renderBudgetStatus(summary);
  renderExpenseChart(expensesByCategory);
  renderRecentTransactions(recentTransactions, accounts, categories);
}

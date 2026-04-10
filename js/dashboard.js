import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  calculateAccountBalances,
  createCategory,
  createTransaction,
  formatCurrency,
  getAccounts,
  getCategories,
  getMonthKey,
  getMonthlySummary,
  getTodayDateString,
  getTransactions,
  groupExpensesByCategory,
  hasSeenBeginnerGuide,
  markBeginnerGuideSeen
} from "./db.js";

let expenseChart;
const DEFAULT_EXPENSE_CATEGORY_NAME = "Бусад";
const DEFAULT_EXPENSE_CATEGORY_ALIASES = new Set(["бусад", "misc"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCompactAmountInput(rawValue) {
  const compact = String(rawValue || "")
    .trim()
    .toLowerCase()
    .replaceAll("₮", "")
    .replace(/\s+/g, "");

  if (!compact) {
    return Number.NaN;
  }

  const normalized = compact.replace(",", ".");
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)(k)?$/);
  if (!match) {
    return Number.NaN;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return Number.NaN;
  }

  const expanded = match[2] ? base * 1000 : base;
  return Math.round(Math.abs(expanded));
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isExpenseCategory(category) {
  const type = String(category?.type || "").toLowerCase();
  return !type || type === "expense" || type === "both";
}

function findDefaultExpenseCategoryId(categories) {
  const match = categories.find((category) => {
    if (!isExpenseCategory(category)) {
      return false;
    }

    return DEFAULT_EXPENSE_CATEGORY_ALIASES.has(normalizeNameKey(category.name));
  });

  return match?.id || "";
}

function renderAccountBalances(accounts) {
  const container = document.getElementById("dashboardAccountBalances");

  if (!accounts.length) {
    container.innerHTML = '<div class="empty-state">Данс алга байна. Эхлээд данс нэмнэ үү.</div>';
    return;
  }

  container.innerHTML = accounts
    .map(
      (account) => `
        <div class="rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 flex items-center justify-between">
          <div>
            <p class="font-semibold">${escapeHtml(account.name)}</p>
          </div>
          <p class="font-display font-semibold">${formatCurrency(account.current_balance)}</p>
        </div>
      `
    )
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
    hasSeen = true;
  }

  if (hasSeen) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  dismissBtn.addEventListener(
    "click",
    async () => {
      try {
        await markBeginnerGuideSeen(userId);
      } catch (error) {
        // Ignore write failures so the page stays usable.
      }
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

  const expenseModal = document.getElementById("expenseModal");
  const incomeModal = document.getElementById("incomeModal");
  const transferModal = document.getElementById("transferModal");
  const dashboardTransactionsMonthFilter = document.getElementById("dashboardTransactionsMonthFilter");
  const recentTransactionsBody = document.getElementById("recentTransactionsBody");

  const expenseForm = document.getElementById("expenseForm");
  const incomeForm = document.getElementById("incomeForm");
  const transferForm = document.getElementById("transferForm");

  const dashboardOpenExpenseModalBtn = document.getElementById("dashboardOpenExpenseModalBtn");
  const dashboardOpenIncomeModalBtn = document.getElementById("dashboardOpenIncomeModalBtn");
  const dashboardOpenTransferModalBtn = document.getElementById("dashboardOpenTransferModalBtn");
  const closeExpenseModalBtn = document.getElementById("closeExpenseModalBtn");
  const closeIncomeModalBtn = document.getElementById("closeIncomeModalBtn");
  const closeTransferModalBtn = document.getElementById("closeTransferModalBtn");

  let accounts = [];
  let categories = [];
  let transactions = [];
  let defaultExpenseCategoryId = "";

  function openModal(modal, firstFieldId) {
    if (!modal) {
      return;
    }

    modal.classList.remove("hidden");
    if (firstFieldId) {
      document.getElementById(firstFieldId)?.focus();
    }
  }

  function closeModal(modal) {
    modal?.classList.add("hidden");
  }

  function closeAllModals() {
    [expenseModal, incomeModal, transferModal].forEach((modal) => modal?.classList.add("hidden"));
  }

  function ensureAccountsAvailable() {
    if (accounts.length) {
      return true;
    }

    showToast("Эхлээд данс нэмнэ үү.");
    window.location.href = "./accounts.html";
    return false;
  }

  async function ensureDefaultExpenseCategory() {
    defaultExpenseCategoryId = findDefaultExpenseCategoryId(categories);
    if (defaultExpenseCategoryId) {
      return;
    }

    const created = await createCategory(user.uid, {
      name: DEFAULT_EXPENSE_CATEGORY_NAME,
      type: "expense",
      parent_id: ""
    });

    defaultExpenseCategoryId = created.id;
    categories = await getCategories(user.uid);
  }

  function setDefaultDates() {
    const today = getTodayDateString();
    document.getElementById("expenseDate").value = today;
    document.getElementById("incomeDate").value = today;
    document.getElementById("transferDate").value = today;
    if (!dashboardTransactionsMonthFilter.value) {
      dashboardTransactionsMonthFilter.value = getMonthKey();
    }
  }

  function populateSelectOptions() {
    const expenseCategories = categories.filter((item) => item.type === "expense" || item.type === "both");
    const incomeCategories = categories.filter((item) => item.type === "income" || item.type === "both");

    const accountOptions = accounts
      .map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`)
      .join("");
    const expenseCategoryOptions = expenseCategories
      .map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
      .join("");
    const incomeCategoryOptions = [
      '<option value="">Ангилалгүй</option>',
      ...incomeCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`)
    ].join("");

    document.getElementById("expenseAccount").innerHTML = accountOptions;
    document.getElementById("incomeAccount").innerHTML = accountOptions;
    document.getElementById("transferFromAccount").innerHTML = accountOptions;
    document.getElementById("transferToAccount").innerHTML = accountOptions;

    const expenseCategorySelect = document.getElementById("expenseCategory");
    expenseCategorySelect.innerHTML = expenseCategoryOptions;
    expenseCategorySelect.value = defaultExpenseCategoryId || expenseCategories[0]?.id || "";

    document.getElementById("incomeCategory").innerHTML = incomeCategoryOptions;
  }

  function getDisplayedTransactions() {
    const monthKey = dashboardTransactionsMonthFilter.value || getMonthKey();
    return transactions.filter((transaction) => (transaction.date || "").startsWith(monthKey));
  }

  function renderTransactionsTable() {
    const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));
    const rows = getDisplayedTransactions();

    if (!rows.length) {
      recentTransactionsBody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Энэ сард гүйлгээ алга.</div></td></tr>';
      return;
    }

    recentTransactionsBody.innerHTML = rows
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
        let categoryLabel = categoryMap[transaction.category_id]?.name || (transaction.type === "expense" ? "Бусад" : "-");

        if (transaction.type === "transfer") {
          const fromAccount = accountMap[transaction.from_account_id];
          const toAccount = accountMap[transaction.to_account_id];
          accountLabel = `${fromAccount?.name || "-"} → ${toAccount?.name || "-"}`;
          amountLabel = `↔ ${formatCurrency(transaction.transfer_amount)}`;
          categoryLabel = "-";
        } else {
          const account = accountMap[transaction.account_id];
          accountLabel = account?.name || "-";
          amountLabel = `${transaction.type === "expense" ? "-" : "+"} ${formatCurrency(transaction.amount)}`;
        }

        return `
          <tr>
            <td>${escapeHtml(transaction.date || "-")}</td>
            <td><span class="type-chip ${typeClass}">${typeLabel}</span></td>
            <td class="font-semibold">${amountLabel}</td>
            <td>${escapeHtml(accountLabel)}</td>
            <td>${escapeHtml(categoryLabel)}</td>
            <td>${escapeHtml(transaction.note || "-")}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshDashboard() {
    [accounts, categories, transactions] = await Promise.all([
      getAccounts(user.uid),
      getCategories(user.uid),
      getTransactions(user.uid)
    ]);

    await ensureDefaultExpenseCategory();
    populateSelectOptions();
    setDefaultDates();

    const accountsWithBalances = calculateAccountBalances(accounts, transactions);
    const monthKey = getMonthKey();
    const summary = getMonthlySummary(transactions, monthKey);
    const expensesByCategory = groupExpensesByCategory(transactions, categories, monthKey);

    renderAccountBalances(accountsWithBalances);
    renderSummary(summary);
    renderBudgetStatus(summary);
    renderExpenseChart(expensesByCategory);
    renderTransactionsTable();
  }

  function clearOpenParam() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("open")) {
      return;
    }

    url.searchParams.delete("open");
    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function openInitialModalIfRequested() {
    const openType = String(new URLSearchParams(window.location.search).get("open") || "")
      .trim()
      .toLowerCase();

    if (!openType) {
      return;
    }

    if (openType === "expense") {
      if (ensureAccountsAvailable()) {
        openModal(expenseModal, "expenseAmount");
      }
    } else if (openType === "income") {
      if (ensureAccountsAvailable()) {
        openModal(incomeModal, "incomeAmount");
      }
    } else if (openType === "transfer") {
      if (ensureAccountsAvailable()) {
        openModal(transferModal, "transferAmount");
      }
    }

    clearOpenParam();
  }

  closeExpenseModalBtn?.addEventListener("click", () => closeModal(expenseModal));
  closeIncomeModalBtn?.addEventListener("click", () => closeModal(incomeModal));
  closeTransferModalBtn?.addEventListener("click", () => closeModal(transferModal));

  [expenseModal, incomeModal, transferModal].forEach((modal) => {
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
    }
  });

  dashboardOpenExpenseModalBtn?.addEventListener("click", () => {
    if (!ensureAccountsAvailable()) {
      return;
    }
    document.getElementById("expenseCategory").value = defaultExpenseCategoryId || document.getElementById("expenseCategory").value;
    openModal(expenseModal, "expenseAmount");
  });

  dashboardOpenIncomeModalBtn?.addEventListener("click", () => {
    if (!ensureAccountsAvailable()) {
      return;
    }
    openModal(incomeModal, "incomeAmount");
  });

  dashboardOpenTransferModalBtn?.addEventListener("click", () => {
    if (!ensureAccountsAvailable()) {
      return;
    }
    openModal(transferModal, "transferAmount");
  });

  dashboardTransactionsMonthFilter?.addEventListener("change", () => {
    renderTransactionsTable();
  });

  expenseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("expenseAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    const accountId = document.getElementById("expenseAccount").value;
    const categoryId = document.getElementById("expenseCategory").value || defaultExpenseCategoryId || null;
    if (!accountId) {
      showToast("Эхлээд данс сонгоно уу.");
      return;
    }
    if (!categoryId) {
      showToast("Эхлээд дор хаяж нэг зарлагын ангилал нэмнэ үү.");
      return;
    }

    await createTransaction(user.uid, {
      type: "expense",
      date: document.getElementById("expenseDate").value,
      amount,
      category_id: categoryId,
      account_id: accountId,
      note: document.getElementById("expenseNote").value
    });

    expenseForm.reset();
    closeModal(expenseModal);
    showToast("Зарлага хадгалагдлаа.");
    await refreshDashboard();
    document.getElementById("expenseCategory").value = defaultExpenseCategoryId || "";
  });

  incomeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("incomeAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    const accountId = document.getElementById("incomeAccount").value;
    if (!accountId) {
      showToast("Эхлээд данс сонгоно уу.");
      return;
    }

    await createTransaction(user.uid, {
      type: "income",
      date: document.getElementById("incomeDate").value,
      amount,
      category_id: document.getElementById("incomeCategory").value || null,
      account_id: accountId,
      note: document.getElementById("incomeNote").value
    });

    incomeForm.reset();
    closeModal(incomeModal);
    showToast("Орлого хадгалагдлаа.");
    await refreshDashboard();
  });

  transferForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("transferAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    const fromAccountId = document.getElementById("transferFromAccount").value;
    const toAccountId = document.getElementById("transferToAccount").value;
    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      showToast("Хоёр өөр данс сонгоно уу.");
      return;
    }

    await createTransaction(user.uid, {
      type: "transfer",
      date: document.getElementById("transferDate").value,
      transfer_amount: amount,
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      note: document.getElementById("transferNote").value
    });

    transferForm.reset();
    closeModal(transferModal);
    showToast("Шилжүүлэг хадгалагдлаа.");
    await refreshDashboard();
  });

  await refreshDashboard();
  openInitialModalIfRequested();
}

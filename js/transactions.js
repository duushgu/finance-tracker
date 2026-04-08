import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  createCategory,
  createTransaction,
  formatCurrency,
  getAccounts,
  getCategories,
  getMonthKey,
  getTodayDateString,
  getTransactions
} from "./db.js";

const DEFAULT_EXPENSE_CATEGORY_NAME = "Sonstiges";

function toDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() + diffToMonday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function renderTypeChip(type) {
  if (type === "expense") {
    return '<span class="type-chip type-expense">Ausgabe</span>';
  }

  if (type === "income") {
    return '<span class="type-chip type-income">Einnahme</span>';
  }

  return '<span class="type-chip type-transfer">Transfer</span>';
}

export async function initTransactionsPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const monthFilter = document.getElementById("transactionsMonthFilter");
  const transactionTableBody = document.getElementById("transactionsTableBody");

  const expenseForm = document.getElementById("expenseForm");
  const incomeForm = document.getElementById("incomeForm");
  const transferForm = document.getElementById("transferForm");
  const filterThisWeek = document.getElementById("filterThisWeek");
  const filterThisMonth = document.getElementById("filterThisMonth");

  let accounts = [];
  let categories = [];
  let transactions = [];
  let listMode = "month";
  let defaultExpenseCategoryId = "";

  function findDefaultExpenseCategoryId(list) {
    const match = list.find((item) => {
      const isExpenseCategory = item.type === "expense" || item.type === "both";
      const normalizedName = (item.name || "").trim().toLowerCase();
      return isExpenseCategory && normalizedName === DEFAULT_EXPENSE_CATEGORY_NAME.toLowerCase();
    });
    return match?.id || "";
  }

  function setDefaultDates() {
    const today = getTodayDateString();
    document.getElementById("expenseDate").value = today;
    document.getElementById("incomeDate").value = today;
    document.getElementById("transferDate").value = today;
    monthFilter.value = getMonthKey();
  }

  function populateSelectOptions() {
    const expenseCategories = categories.filter((item) => item.type === "expense" || item.type === "both");
    const incomeCategories = categories.filter((item) => item.type === "income" || item.type === "both");

    const accountOptions = accounts.map((account) => `<option value="${account.id}">${account.name}</option>`).join("");
    const expenseCategoryOptions = expenseCategories
      .map((category) => `<option value="${category.id}">${category.name}</option>`)
      .join("");
    const incomeCategoryOptions = [
      '<option value="">Keine Kategorie</option>',
      ...incomeCategories.map((category) => `<option value="${category.id}">${category.name}</option>`)
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

  function renderTransactionTable() {
    const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));

    const monthKey = monthFilter.value || getMonthKey();
    const filtered = transactions.filter((transaction) => (transaction.date || "").startsWith(monthKey));
    const weekRange = getWeekRange();
    const finalRows =
      listMode === "week"
        ? transactions.filter((transaction) => {
            if (!transaction.date) {
              return false;
            }
            const date = toDate(transaction.date);
            return date >= weekRange.start && date <= weekRange.end;
          })
        : filtered;

    if (!finalRows.length) {
      transactionTableBody.innerHTML =
        '<tr><td colspan="6"><div class="empty-state">Keine Buchungen in diesem Zeitraum.</div></td></tr>';
      return;
    }

    transactionTableBody.innerHTML = finalRows
      .map((transaction) => {
        const type = transaction.type;
        const amount = Number(transaction.transfer_amount || transaction.amount || 0);

        let amountText = "";
        let accountText = "-";

        if (type === "transfer") {
          const fromAccount = accountMap[transaction.from_account_id];
          const toAccount = accountMap[transaction.to_account_id];
          accountText = `${fromAccount?.name || "-"} → ${toAccount?.name || "-"}`;
          amountText = `↔ ${formatCurrency(amount)}`;
        } else {
          const account = accountMap[transaction.account_id];
          accountText = account?.name || "-";

          if (type === "expense") {
            amountText = `- ${formatCurrency(amount)}`;
          } else {
            amountText = `+ ${formatCurrency(amount)}`;
          }
        }

        const categoryName =
          categoryMap[transaction.category_id]?.name || (transaction.type === "expense" ? DEFAULT_EXPENSE_CATEGORY_NAME : "-");

        return `
          <tr>
            <td>${transaction.date || "-"}</td>
            <td>${renderTypeChip(type)}</td>
            <td class="font-semibold">${amountText}</td>
            <td>${accountText}</td>
            <td>${categoryName}</td>
            <td>${transaction.note || "-"}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshData() {
    [accounts, categories, transactions] = await Promise.all([
      getAccounts(user.uid),
      getCategories(user.uid),
      getTransactions(user.uid)
    ]);

    await ensureDefaultExpenseCategory();
    populateSelectOptions();
    renderTransactionTable();
  }

  expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const selectedExpenseCategory =
      document.getElementById("expenseCategory").value || defaultExpenseCategoryId || null;
    if (!selectedExpenseCategory) {
      showToast("Bitte zuerst mindestens eine Ausgaben-Kategorie anlegen.");
      return;
    }

    await createTransaction(user.uid, {
      type: "expense",
      date: document.getElementById("expenseDate").value,
      amount: document.getElementById("expenseAmount").value,
      category_id: selectedExpenseCategory,
      account_id: document.getElementById("expenseAccount").value,
      note: document.getElementById("expenseNote").value
    });

    expenseForm.reset();
    document.getElementById("expenseDate").value = getTodayDateString();
    document.getElementById("expenseCategory").value = defaultExpenseCategoryId || "";
    showToast("Ausgabe gespeichert.");
    await refreshData();
  });

  incomeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    await createTransaction(user.uid, {
      type: "income",
      date: document.getElementById("incomeDate").value,
      amount: document.getElementById("incomeAmount").value,
      category_id: document.getElementById("incomeCategory").value || null,
      account_id: document.getElementById("incomeAccount").value,
      note: document.getElementById("incomeNote").value
    });

    incomeForm.reset();
    document.getElementById("incomeDate").value = getTodayDateString();
    showToast("Einnahme gespeichert.");
    await refreshData();
  });

  transferForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fromAccount = document.getElementById("transferFromAccount").value;
    const toAccount = document.getElementById("transferToAccount").value;

    if (!fromAccount || !toAccount || fromAccount === toAccount) {
      showToast("Bitte zwei verschiedene Konten auswählen.");
      return;
    }

    await createTransaction(user.uid, {
      type: "transfer",
      date: document.getElementById("transferDate").value,
      transfer_amount: document.getElementById("transferAmount").value,
      from_account_id: fromAccount,
      to_account_id: toAccount,
      note: document.getElementById("transferNote").value
    });

    transferForm.reset();
    document.getElementById("transferDate").value = getTodayDateString();
    showToast("Transfer gespeichert.");
    await refreshData();
  });

  monthFilter.addEventListener("change", () => {
    listMode = "month";
    renderTransactionTable();
  });

  filterThisWeek.addEventListener("click", () => {
    listMode = "week";
    renderTransactionTable();
  });

  filterThisMonth.addEventListener("click", () => {
    listMode = "month";
    renderTransactionTable();
  });

  setDefaultDates();
  await refreshData();
}

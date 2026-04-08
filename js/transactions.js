import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  createTransaction,
  formatCurrency,
  getAccounts,
  getCategories,
  getMonthKey,
  getTodayDateString,
  getTransactions
} from "./db.js";

function renderTypeChip(type) {
  if (type === "expense") {
    return '<span class="type-chip type-expense">Expense</span>';
  }

  if (type === "income") {
    return '<span class="type-chip type-income">Income</span>';
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

  let accounts = [];
  let categories = [];
  let transactions = [];

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
      '<option value="">No category</option>',
      ...incomeCategories.map((category) => `<option value="${category.id}">${category.name}</option>`)
    ].join("");

    document.getElementById("expenseAccount").innerHTML = accountOptions;
    document.getElementById("incomeAccount").innerHTML = accountOptions;
    document.getElementById("transferFromAccount").innerHTML = accountOptions;
    document.getElementById("transferToAccount").innerHTML = accountOptions;

    document.getElementById("expenseCategory").innerHTML = expenseCategoryOptions;
    document.getElementById("incomeCategory").innerHTML = incomeCategoryOptions;
  }

  function renderTransactionTable() {
    const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));

    const monthKey = monthFilter.value || getMonthKey();
    const filtered = transactions.filter((transaction) => (transaction.date || "").startsWith(monthKey));

    if (!filtered.length) {
      transactionTableBody.innerHTML =
        '<tr><td colspan="6"><div class="empty-state">No transactions in this month.</div></td></tr>';
      return;
    }

    transactionTableBody.innerHTML = filtered
      .map((transaction) => {
        const type = transaction.type;
        const amount = Number(transaction.transfer_amount || transaction.amount || 0);

        let amountText = "";
        let accountText = "-";

        if (type === "transfer") {
          const fromAccount = accountMap[transaction.from_account_id];
          const toAccount = accountMap[transaction.to_account_id];
          const currency = fromAccount?.currency || toAccount?.currency || "EUR";
          accountText = `${fromAccount?.name || "-"} → ${toAccount?.name || "-"}`;
          amountText = `↔ ${formatCurrency(amount, currency)}`;
        } else {
          const account = accountMap[transaction.account_id];
          const currency = account?.currency || "EUR";
          accountText = account?.name || "-";

          if (type === "expense") {
            amountText = `- ${formatCurrency(amount, currency)}`;
          } else {
            amountText = `+ ${formatCurrency(amount, currency)}`;
          }
        }

        const categoryName = categoryMap[transaction.category_id]?.name || "-";

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

    populateSelectOptions();
    renderTransactionTable();
  }

  expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    await createTransaction(user.uid, {
      type: "expense",
      date: document.getElementById("expenseDate").value,
      amount: document.getElementById("expenseAmount").value,
      category_id: document.getElementById("expenseCategory").value,
      account_id: document.getElementById("expenseAccount").value,
      note: document.getElementById("expenseNote").value
    });

    expenseForm.reset();
    document.getElementById("expenseDate").value = getTodayDateString();
    showToast("Expense saved.");
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
    showToast("Income saved.");
    await refreshData();
  });

  transferForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fromAccount = document.getElementById("transferFromAccount").value;
    const toAccount = document.getElementById("transferToAccount").value;

    if (!fromAccount || !toAccount || fromAccount === toAccount) {
      showToast("Please select two different accounts.");
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
    showToast("Transfer saved.");
    await refreshData();
  });

  monthFilter.addEventListener("change", () => {
    renderTransactionTable();
  });

  setDefaultDates();
  await refreshData();
}

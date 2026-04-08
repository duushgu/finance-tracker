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
  groupExpensesByCategory
} from "./db.js";

let expenseChart;

function renderAccountBalances(accounts) {
  const container = document.getElementById("dashboardAccountBalances");

  if (!accounts.length) {
    container.innerHTML = '<div class="empty-state">No accounts found. Create one in Accounts.</div>';
    return;
  }

  container.innerHTML = accounts
    .map((account) => {
      return `
        <div class="rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 flex items-center justify-between">
          <div>
            <p class="font-semibold">${account.name}</p>
            <p class="text-xs text-slate-500">${account.currency}</p>
          </div>
          <p class="font-display font-semibold">${formatCurrency(account.current_balance, account.currency)}</p>
        </div>
      `;
    })
    .join("");
}

function renderSummary(summary, currency) {
  document.getElementById("monthIncome").textContent = formatCurrency(summary.incomeTotal, currency);
  document.getElementById("monthExpense").textContent = formatCurrency(summary.expenseTotal, currency);
  document.getElementById("monthNet").textContent = formatCurrency(summary.net, currency);
}

function renderExpenseChart(groupedExpenses) {
  const canvas = document.getElementById("expenseChart");
  const hasChartLib = typeof window.Chart !== "undefined";

  if (!hasChartLib) {
    canvas.parentElement.innerHTML = '<div class="empty-state">Chart library unavailable.</div>';
    return;
  }

  if (expenseChart) {
    expenseChart.destroy();
  }

  if (!groupedExpenses.length) {
    expenseChart = new window.Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["No Expenses"],
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
        }
      }
    }
  });
}

function renderRecentTransactions(recentTransactions, accounts, categories) {
  const body = document.getElementById("recentTransactionsBody");

  if (!recentTransactions.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state">No transactions recorded yet.</div></td></tr>';
    return;
  }

  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));

  body.innerHTML = recentTransactions
    .map((transaction) => {
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
        const currency = fromAccount?.currency || toAccount?.currency || "EUR";
        accountLabel = `${fromAccount?.name || "-"} → ${toAccount?.name || "-"}`;
        amountLabel = `↔ ${formatCurrency(transaction.transfer_amount, currency)}`;
      } else {
        const account = accountMap[transaction.account_id];
        const currency = account?.currency || "EUR";
        accountLabel = account?.name || "-";

        const sign = transaction.type === "expense" ? "-" : "+";
        amountLabel = `${sign} ${formatCurrency(transaction.amount, currency)}`;
      }

      return `
        <tr>
          <td>${transaction.date || "-"}</td>
          <td><span class="type-chip ${typeClass}">${transaction.type}</span></td>
          <td class="font-semibold">${amountLabel}</td>
          <td>${accountLabel}</td>
          <td>${categoryMap[transaction.category_id]?.name || "-"}</td>
          <td>${transaction.note || "-"}</td>
        </tr>
      `;
    })
    .join("");
}

export async function initDashboard() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

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

  const defaultCurrency = accounts[0]?.currency || "EUR";

  renderAccountBalances(accountsWithBalances);
  renderSummary(summary, defaultCurrency);
  renderExpenseChart(expensesByCategory);
  renderRecentTransactions(recentTransactions, accounts, categories);
}

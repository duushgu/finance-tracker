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
    container.innerHTML = '<div class="empty-state">Keine Konten gefunden. Lege zuerst ein Konto an.</div>';
    return;
  }

  container.innerHTML = accounts
    .map((account) => {
      return `
        <div class="rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 flex items-center justify-between">
          <div>
            <p class="font-semibold">${account.name}</p>
            <p class="text-xs text-slate-500">MNT / ₮</p>
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
    label.textContent = "Grün: im Plan";
    hint.textContent = "Ausgaben sind im sicheren Bereich.";
    bar.className = "h-full rounded-full bg-emerald-500";
  } else if (ratio <= 1) {
    label.textContent = "Gelb: eng";
    hint.textContent = "Monat wird knapp. Bitte auf kleine Ausgaben achten.";
    bar.className = "h-full rounded-full bg-amber-500";
  } else {
    label.textContent = "Rot: drüber";
    hint.textContent = "Ausgaben sind höher als Einnahmen.";
    bar.className = "h-full rounded-full bg-rose-600";
  }

  detail.textContent = `Ausgabenquote: ${ratioPercent}% vom Monatseinkommen`;
}

function renderExpenseChart(groupedExpenses) {
  const canvas = document.getElementById("expenseChart");
  const hasChartLib = typeof window.Chart !== "undefined";

  if (!hasChartLib) {
    canvas.parentElement.innerHTML = '<div class="empty-state">Chart-Bibliothek nicht verfügbar.</div>';
    return;
  }

  if (expenseChart) {
    expenseChart.destroy();
  }

  if (!groupedExpenses.length) {
    expenseChart = new window.Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Keine Ausgaben"],
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
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Noch keine Buchungen vorhanden.</div></td></tr>';
    return;
  }

  const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));

  body.innerHTML = recentTransactions
    .map((transaction) => {
      const typeLabel =
        transaction.type === "expense" ? "Ausgabe" : transaction.type === "income" ? "Einnahme" : "Transfer";
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
          <td>${categoryMap[transaction.category_id]?.name || (transaction.type === "expense" ? "Sonstiges" : "-")}</td>
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

  renderAccountBalances(accountsWithBalances);
  renderSummary(summary);
  renderBudgetStatus(summary);
  renderExpenseChart(expensesByCategory);
  renderRecentTransactions(recentTransactions, accounts, categories);
}

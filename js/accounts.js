import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  calculateAccountBalances,
  createAccount,
  formatCurrency,
  getAccounts,
  getTransactions
} from "./db.js";

export async function initAccountsPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const accountForm = document.getElementById("accountForm");
  const accountsTableBody = document.getElementById("accountsTableBody");

  async function renderAccounts() {
    const [accounts, transactions] = await Promise.all([getAccounts(user.uid), getTransactions(user.uid)]);
    const accountsWithBalance = calculateAccountBalances(accounts, transactions);

    if (!accountsWithBalance.length) {
      accountsTableBody.innerHTML =
        '<tr><td colspan="4"><div class="empty-state">No accounts yet. Create your first account.</div></td></tr>';
      return;
    }

    accountsTableBody.innerHTML = accountsWithBalance
      .map((account) => {
        return `
          <tr>
            <td>${account.name}</td>
            <td>${account.currency}</td>
            <td>${formatCurrency(account.initial_balance, account.currency)}</td>
            <td class="font-semibold">${formatCurrency(account.current_balance, account.currency)}</td>
          </tr>
        `;
      })
      .join("");
  }

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("accountName").value.trim();
    const currency = document.getElementById("accountCurrency").value;
    const initialBalance = document.getElementById("accountInitialBalance").value;

    if (!name) {
      showToast("Account name is required.");
      return;
    }

    await createAccount(user.uid, {
      name,
      currency,
      initial_balance: initialBalance
    });

    accountForm.reset();
    document.getElementById("accountCurrency").value = "EUR";
    document.getElementById("accountInitialBalance").value = "0";

    showToast("Account created.");
    await renderAccounts();
  });

  await renderAccounts();
}

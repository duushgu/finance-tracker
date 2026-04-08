import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  calculateAccountBalances,
  createAccount,
  formatCurrency,
  getAccounts,
  getTransactions,
  updateAccount
} from "./db.js";

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
  return Math.round(expanded);
}

export async function initAccountsPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const accountForm = document.getElementById("accountForm");
  const accountsTableBody = document.getElementById("accountsTableBody");
  const accountModal = document.getElementById("accountModal");
  const openAccountModalBtn = document.getElementById("openAccountModalBtn");
  const closeAccountModalBtn = document.getElementById("closeAccountModalBtn");

  let accountsWithBalance = [];
  let isInlineSaving = false;

  function openAccountModal() {
    accountModal.classList.remove("hidden");
    document.getElementById("accountName").focus();
  }

  function closeAccountModal() {
    accountModal.classList.add("hidden");
  }

  function getAccountById(accountId) {
    return accountsWithBalance.find((item) => item.id === accountId);
  }

  async function renderAccounts() {
    const [accounts, transactions] = await Promise.all([getAccounts(user.uid), getTransactions(user.uid)]);
    accountsWithBalance = calculateAccountBalances(accounts, transactions);

    if (!accountsWithBalance.length) {
      accountsTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Noch kein Konto vorhanden. Bitte zuerst ein Konto anlegen.</div></td></tr>';
      return;
    }

    accountsTableBody.innerHTML = accountsWithBalance
      .map((account) => {
        const netActivity = Number(account.current_balance || 0) - Number(account.initial_balance || 0);
        return `
          <tr data-account-id="${account.id}" data-net-activity="${netActivity}">
            <td
              class="editable-cell"
              contenteditable="true"
              data-field="name"
              spellcheck="false"
            >${escapeHtml(account.name)}</td>
            <td
              class="editable-cell font-semibold"
              contenteditable="true"
              data-field="current_balance"
              spellcheck="false"
            >${formatCurrency(account.current_balance)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function saveCellUpdate(cell) {
    const field = cell.dataset.field;
    const row = cell.closest("tr");
    if (!row) {
      return false;
    }

    const accountId = row.dataset.accountId;
    const account = getAccountById(accountId);
    if (!account) {
      return false;
    }

    const currentText = cell.textContent.trim();
    const originalText = (cell.dataset.originalValue || "").trim();
    if (currentText === originalText) {
      return false;
    }

    if (field === "name") {
      const nextName = currentText.trim();
      if (!nextName) {
        throw new Error("Kontoname darf nicht leer sein.");
      }

      await updateAccount(accountId, { name: nextName });
      return true;
    }

    if (field === "current_balance") {
      const targetCurrentBalance = parseCompactAmountInput(currentText);
      if (!Number.isFinite(targetCurrentBalance)) {
        throw new Error("Ungültiger Kontostand. Beispiel: 25000 oder 25k.");
      }

      const netActivity = Number(row.dataset.netActivity || 0);
      const nextInitialBalance = targetCurrentBalance - netActivity;
      await updateAccount(accountId, { initial_balance: nextInitialBalance });
      return true;
    }

    return false;
  }

  openAccountModalBtn.addEventListener("click", openAccountModal);
  closeAccountModalBtn.addEventListener("click", closeAccountModal);

  accountModal.addEventListener("click", (event) => {
    if (event.target === accountModal) {
      closeAccountModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !accountModal.classList.contains("hidden")) {
      closeAccountModal();
    }
  });

  accountsTableBody.addEventListener("focusin", (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }
    cell.dataset.originalValue = cell.textContent.trim();
  });

  accountsTableBody.addEventListener("keydown", (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      cell.blur();
    }
  });

  accountsTableBody.addEventListener("focusout", async (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell || isInlineSaving) {
      return;
    }

    isInlineSaving = true;
    try {
      const changed = await saveCellUpdate(cell);
      if (changed) {
        await renderAccounts();
        showToast("Konto aktualisiert.");
      }
    } catch (error) {
      cell.textContent = cell.dataset.originalValue || "";
      showToast(error.message || "Aktualisierung fehlgeschlagen.");
    } finally {
      isInlineSaving = false;
    }
  });

  accountForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("accountName").value.trim();
    const initialBalance = document.getElementById("accountInitialBalance").value;

    if (!name) {
      showToast("Bitte Kontonamen eingeben.");
      return;
    }

    await createAccount(user.uid, {
      name,
      initial_balance: initialBalance
    });

    accountForm.reset();
    document.getElementById("accountInitialBalance").value = "0";
    closeAccountModal();
    showToast("Konto gespeichert.");
    await renderAccounts();
  });

  await renderAccounts();
}

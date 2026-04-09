import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import {
  createCategory,
  createTransaction,
  deleteTransaction,
  formatCurrency,
  getAccounts,
  getCategories,
  getMonthKey,
  getTodayDateString,
  getTransactions,
  updateTransaction
} from "./db.js";

const DEFAULT_EXPENSE_CATEGORY_NAME = "Бусад";
const DEFAULT_EXPENSE_CATEGORY_ALIASES = new Set(["бусад", "misc"]);
const QUICK_EXPENSE_STORAGE_PREFIX = "finance.quickExpenseSlots";
const QUICK_CATEGORY_ALIASES = {
  food: ["хүнс", "food", "groceries", "grocery"],
  kids: ["хүүхэд", "kids", "baby", "kita"]
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function normalizeTransactionType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["зарлага", "zarlaga", "expense"].includes(normalized)) {
    return "expense";
  }
  if (["орлого", "orlogo", "income"].includes(normalized)) {
    return "income";
  }
  if (["шилжүүлэг", "shiljuuleg", "transfer"].includes(normalized)) {
    return "transfer";
  }
  return "";
}

function labelForType(type) {
  if (type === "expense") {
    return "Зарлага";
  }
  if (type === "income") {
    return "Орлого";
  }
  return "Шилжүүлэг";
}

function normalizeDateInput(value) {
  const trimmed = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "";
  }

  const date = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function normalizeNameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeQuickLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isExpenseCategory(category) {
  const type = String(category?.type || "").toLowerCase();
  return !type || type === "expense" || type === "both";
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

function findByName(list, value) {
  const key = normalizeNameKey(value);
  return list.find((item) => normalizeNameKey(item.name) === key) || null;
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

  const expenseModal = document.getElementById("expenseModal");
  const incomeModal = document.getElementById("incomeModal");
  const transferModal = document.getElementById("transferModal");
  const openExpenseModalBtn = document.getElementById("openExpenseModalBtn");
  const openIncomeModalBtn = document.getElementById("openIncomeModalBtn");
  const openTransferModalBtn = document.getElementById("openTransferModalBtn");
  const toggleDeleteTransactionModeBtn = document.getElementById("toggleDeleteTransactionModeBtn");
  const closeExpenseModalBtn = document.getElementById("closeExpenseModalBtn");
  const closeIncomeModalBtn = document.getElementById("closeIncomeModalBtn");
  const closeTransferModalBtn = document.getElementById("closeTransferModalBtn");

  let accounts = [];
  let categories = [];
  let transactions = [];
  let transactionMap = new Map();
  let listMode = "month";
  let defaultExpenseCategoryId = "";
  let isInlineSaving = false;
  let isDeleteMode = false;
  let selectedDeleteTransactionId = "";

  async function waitForInlineSaveIdle(timeoutMs = 1200) {
    const startedAt = Date.now();
    while (isInlineSaving && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 35));
    }
  }

  function openModal(modal, firstFieldId) {
    modal.classList.remove("hidden");
    if (firstFieldId) {
      document.getElementById(firstFieldId)?.focus();
    }
  }

  function closeModal(modal) {
    modal.classList.add("hidden");
  }

  function closeAllModals() {
    [expenseModal, incomeModal, transferModal].forEach((modal) => {
      modal.classList.add("hidden");
    });
  }

  function findDefaultExpenseCategoryId(list) {
    const match = list.find((item) => {
      const isExpenseCategory = item.type === "expense" || item.type === "both";
      const normalizedName = normalizeNameKey(item.name);
      return (
        isExpenseCategory &&
        (normalizedName === DEFAULT_EXPENSE_CATEGORY_NAME.toLowerCase() ||
          DEFAULT_EXPENSE_CATEGORY_ALIASES.has(normalizedName))
      );
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

    const accountOptions = accounts.map((account) => `<option value="${account.id}">${escapeHtml(account.name)}</option>`).join("");
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

  function clearQuickExpenseParams() {
    const url = new URL(window.location.href);
    let changed = false;

    ["expenseCategoryId", "quick"].forEach((param) => {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        changed = true;
      }
    });

    if (!changed) {
      return;
    }

    const search = url.searchParams.toString();
    const nextUrl = `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }

  function findExpenseCategoryFromQuickKey(quickKey) {
    const expenseCategories = categories.filter((item) => isExpenseCategory(item));
    const savedMapping = readQuickCategoryMapping(user.uid);
    const savedCategoryId = savedMapping[quickKey];
    if (savedCategoryId) {
      const fromSaved = expenseCategories.find((item) => item.id === savedCategoryId);
      if (fromSaved) {
        return fromSaved;
      }
    }

    const aliases = QUICK_CATEGORY_ALIASES[quickKey] || [quickKey];
    const aliasSet = new Set(aliases.map((alias) => normalizeQuickLookup(alias)));
    return expenseCategories.find((item) => aliasSet.has(normalizeQuickLookup(item.name))) || null;
  }

  function resolveQuickExpenseRequest() {
    const params = new URLSearchParams(window.location.search);
    const explicitCategoryId = String(params.get("expenseCategoryId") || "").trim();
    const quickKey = String(params.get("quick") || "")
      .trim()
      .toLowerCase();

    const hasQuickRequest = Boolean(explicitCategoryId || quickKey);
    if (!hasQuickRequest) {
      return { shouldOpen: false, categoryId: "" };
    }

    const expenseCategories = categories.filter((item) => isExpenseCategory(item));
    if (explicitCategoryId) {
      const fromId = expenseCategories.find((item) => item.id === explicitCategoryId);
      if (fromId) {
        return { shouldOpen: true, categoryId: fromId.id };
      }
    }

    if (quickKey) {
      const matchedCategory = findExpenseCategoryFromQuickKey(quickKey);
      if (matchedCategory) {
        const mapping = readQuickCategoryMapping(user.uid);
        mapping[quickKey] = matchedCategory.id;
        writeQuickCategoryMapping(user.uid, mapping);
        return { shouldOpen: true, categoryId: matchedCategory.id };
      }
    }

    return { shouldOpen: true, categoryId: "" };
  }

  function openQuickExpenseModalIfRequested() {
    const request = resolveQuickExpenseRequest();
    if (!request.shouldOpen) {
      return;
    }

    const expenseCategorySelect = document.getElementById("expenseCategory");
    expenseCategorySelect.value = request.categoryId || defaultExpenseCategoryId || expenseCategorySelect.value;
    openModal(expenseModal, "expenseAmount");
    clearQuickExpenseParams();
  }

  function applyDeleteModeStateToTable() {
    const rows = Array.from(transactionTableBody.querySelectorAll("tr[data-transaction-id]"));
    rows.forEach((row) => {
      const isSelected = isDeleteMode && row.dataset.transactionId === selectedDeleteTransactionId;
      row.classList.toggle("row-selectable", isDeleteMode);
      row.classList.toggle("row-selected", isSelected);
    });

    const editableCells = transactionTableBody.querySelectorAll(".editable-cell");
    editableCells.forEach((cell) => {
      cell.setAttribute("contenteditable", isDeleteMode ? "false" : "true");
    });
  }

  function updateDeleteButtonUi() {
    if (!toggleDeleteTransactionModeBtn) {
      return;
    }

    toggleDeleteTransactionModeBtn.classList.toggle("is-active", isDeleteMode);
    toggleDeleteTransactionModeBtn.textContent = "УСТ";

    if (!isDeleteMode) {
      toggleDeleteTransactionModeBtn.title = "Устгах горим эхлүүлэх";
      toggleDeleteTransactionModeBtn.setAttribute("aria-label", "Устгах горим эхлүүлэх");
      return;
    }

    if (selectedDeleteTransactionId) {
      toggleDeleteTransactionModeBtn.title = "Сонгосон мөрийг устгах";
      toggleDeleteTransactionModeBtn.setAttribute("aria-label", "Сонгосон мөрийг устгах");
      return;
    }

    toggleDeleteTransactionModeBtn.title = "Устгах горим дуусгах";
    toggleDeleteTransactionModeBtn.setAttribute("aria-label", "Устгах горим дуусгах");
  }

  function setDeleteMode(nextMode) {
    isDeleteMode = nextMode;
    if (!isDeleteMode) {
      selectedDeleteTransactionId = "";
    }
    updateDeleteButtonUi();
    applyDeleteModeStateToTable();
  }

  function renderTransactionTable() {
    const accountMap = Object.fromEntries(accounts.map((account) => [account.id, account]));
    const categoryMap = Object.fromEntries(categories.map((category) => [category.id, category]));
    transactionMap = new Map(transactions.map((item) => [item.id, item]));

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
        '<tr><td colspan="6"><div class="empty-state">Энэ хугацаанд гүйлгээ алга.</div></td></tr>';
      selectedDeleteTransactionId = "";
      applyDeleteModeStateToTable();
      return;
    }

    if (selectedDeleteTransactionId && !finalRows.some((item) => item.id === selectedDeleteTransactionId)) {
      selectedDeleteTransactionId = "";
    }

    transactionTableBody.innerHTML = finalRows
      .map((transaction) => {
        const type = transaction.type;
        const amount = Number(transaction.transfer_amount || transaction.amount || 0);

        const accountText =
          type === "transfer"
            ? `${accountMap[transaction.from_account_id]?.name || "-"} -> ${accountMap[transaction.to_account_id]?.name || "-"}`
            : accountMap[transaction.account_id]?.name || "-";

        const categoryName =
          categoryMap[transaction.category_id]?.name || (type === "expense" ? DEFAULT_EXPENSE_CATEGORY_NAME : "-");

        const selectedClass = isDeleteMode && transaction.id === selectedDeleteTransactionId ? " row-selected" : "";
        const selectableClass = isDeleteMode ? " row-selectable" : "";
        return `
          <tr data-transaction-id="${transaction.id}" class="${selectableClass}${selectedClass}">
            <td class="editable-cell" contenteditable="true" data-field="date" spellcheck="false">${escapeHtml(transaction.date || "")}</td>
            <td class="editable-cell" contenteditable="true" data-field="type" spellcheck="false">${labelForType(type)}</td>
            <td class="editable-cell font-semibold" contenteditable="true" data-field="amount" spellcheck="false">${formatCurrency(amount)}</td>
            <td class="editable-cell" contenteditable="true" data-field="account" spellcheck="false">${escapeHtml(accountText)}</td>
            <td class="editable-cell" contenteditable="true" data-field="category" spellcheck="false">${escapeHtml(categoryName)}</td>
            <td class="editable-cell" contenteditable="true" data-field="note" spellcheck="false">${escapeHtml(transaction.note || "")}</td>
          </tr>
        `;
      })
      .join("");

    applyDeleteModeStateToTable();
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

  async function resolveCategoryIdFromText(text, transactionType) {
    const cleaned = String(text || "").trim();
    if (!cleaned || cleaned === "-") {
      return transactionType === "expense" ? defaultExpenseCategoryId : null;
    }

    const existing = findByName(categories, cleaned);
    if (existing) {
      return existing.id;
    }

    const newType = transactionType === "income" ? "income" : "expense";
    const created = await createCategory(user.uid, {
      name: cleaned,
      type: newType,
      parent_id: ""
    });
    categories = await getCategories(user.uid);
    defaultExpenseCategoryId = findDefaultExpenseCategoryId(categories) || defaultExpenseCategoryId;
    return created.id;
  }

  function buildTypeTransitionUpdate(transaction, nextType) {
    const amount = Number(transaction.transfer_amount || transaction.amount || 0);

    if (nextType === "transfer") {
      const fromAccountId = transaction.type === "transfer" ? transaction.from_account_id : transaction.account_id;
      const toAccountId =
        transaction.type === "transfer"
          ? transaction.to_account_id
          : accounts.find((account) => account.id !== fromAccountId)?.id;

      if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
        throw new Error("Шилжүүлэг хийхэд хоёр өөр данс хэрэгтэй.");
      }

      return {
        type: "transfer",
        amount,
        account_id: null,
        category_id: null,
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        transfer_amount: amount
      };
    }

    let accountId = transaction.account_id;
    if (!accountId && transaction.type === "transfer") {
      accountId = nextType === "income" ? transaction.to_account_id : transaction.from_account_id;
    }
    if (!accountId) {
      accountId = accounts[0]?.id || null;
    }
    if (!accountId) {
      throw new Error("Ашиглах данс олдсонгүй.");
    }

    const nextCategoryId =
      nextType === "expense"
        ? transaction.type === "expense"
          ? transaction.category_id || defaultExpenseCategoryId
          : defaultExpenseCategoryId
        : transaction.type === "income"
          ? transaction.category_id || null
          : null;

    return {
      type: nextType,
      amount,
      account_id: accountId,
      category_id: nextCategoryId,
      from_account_id: null,
      to_account_id: null,
      transfer_amount: null
    };
  }

  async function saveCellUpdate(cell) {
    const row = cell.closest("tr");
    if (!row) {
      return false;
    }

    const transactionId = row.dataset.transactionId;
    const transaction = transactionMap.get(transactionId);
    if (!transaction) {
      return false;
    }

    const field = cell.dataset.field;
    const currentText = cell.textContent.trim();
    const originalText = (cell.dataset.originalValue || "").trim();
    if (currentText === originalText) {
      return false;
    }

    if (field === "date") {
      const nextDate = normalizeDateInput(currentText);
      if (!nextDate) {
        throw new Error("Огноо YYYY-MM-DD форматтай байх ёстой.");
      }
      await updateTransaction(transactionId, { date: nextDate });
      return true;
    }

    if (field === "type") {
      const nextType = normalizeTransactionType(currentText);
      if (!nextType) {
        throw new Error("Төрөл нь Зарлага, Орлого эсвэл Шилжүүлэг байх ёстой.");
      }
      if (nextType === transaction.type) {
        return false;
      }
      const updatePayload = buildTypeTransitionUpdate(transaction, nextType);
      await updateTransaction(transactionId, updatePayload);
      return true;
    }

    if (field === "amount") {
      const amount = parseCompactAmountInput(currentText);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      }
      if (transaction.type === "transfer") {
        await updateTransaction(transactionId, { transfer_amount: amount, amount });
      } else {
        await updateTransaction(transactionId, { amount });
      }
      return true;
    }

    if (field === "account") {
      if (transaction.type === "transfer") {
        const parts = currentText.split(/->|→/).map((item) => item.trim()).filter(Boolean);
        if (parts.length !== 2) {
          throw new Error("Шилжүүлэгт 'Дансаас -> Данс руу' гэж оруулна уу.");
        }

        const fromAccount = findByName(accounts, parts[0]);
        const toAccount = findByName(accounts, parts[1]);
        if (!fromAccount || !toAccount || fromAccount.id === toAccount.id) {
          throw new Error("Шилжүүлэг хийхийн тулд хоёр өөр байгаа данс шаардлагатай.");
        }

        await updateTransaction(transactionId, {
          from_account_id: fromAccount.id,
          to_account_id: toAccount.id
        });
        return true;
      }

      const account = findByName(accounts, currentText);
      if (!account) {
        throw new Error("Данс олдсонгүй.");
      }
      await updateTransaction(transactionId, { account_id: account.id });
      return true;
    }

    if (field === "category") {
      if (transaction.type === "transfer") {
        if (currentText && currentText !== "-") {
          throw new Error("Шилжүүлэгт ангилал байдаггүй.");
        }
        return false;
      }

      const categoryId = await resolveCategoryIdFromText(currentText, transaction.type);
      await updateTransaction(transactionId, { category_id: categoryId });
      return true;
    }

    if (field === "note") {
      await updateTransaction(transactionId, { note: currentText });
      return true;
    }

    return false;
  }

  openExpenseModalBtn.addEventListener("click", () => openModal(expenseModal, "expenseAmount"));
  openIncomeModalBtn.addEventListener("click", () => openModal(incomeModal, "incomeAmount"));
  openTransferModalBtn.addEventListener("click", () => openModal(transferModal, "transferAmount"));

  closeExpenseModalBtn.addEventListener("click", () => closeModal(expenseModal));
  closeIncomeModalBtn.addEventListener("click", () => closeModal(incomeModal));
  closeTransferModalBtn.addEventListener("click", () => closeModal(transferModal));

  [expenseModal, incomeModal, transferModal].forEach((modal) => {
    modal.addEventListener("click", (event) => {
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

  transactionTableBody.addEventListener("focusin", (event) => {
    if (isDeleteMode) {
      return;
    }
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }
    cell.dataset.originalValue = cell.textContent.trim();
  });

  transactionTableBody.addEventListener("keydown", (event) => {
    if (isDeleteMode) {
      return;
    }
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      cell.blur();
    }
  });

  transactionTableBody.addEventListener("focusout", async (event) => {
    if (isDeleteMode) {
      return;
    }
    const cell = event.target.closest(".editable-cell");
    if (!cell || isInlineSaving) {
      return;
    }

    isInlineSaving = true;
    try {
      const changed = await saveCellUpdate(cell);
      if (changed) {
        await refreshData();
        showToast("Гүйлгээ шинэчлэгдлээ.");
      }
    } catch (error) {
      cell.textContent = cell.dataset.originalValue || "";
      showToast(error.message || "Шинэчилж чадсангүй.");
    } finally {
      isInlineSaving = false;
    }
  });

  transactionTableBody.addEventListener("click", (event) => {
    if (!isDeleteMode) {
      return;
    }

    const row = event.target.closest("tr[data-transaction-id]");
    if (!row) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectedDeleteTransactionId = row.dataset.transactionId || "";
    applyDeleteModeStateToTable();
    updateDeleteButtonUi();
  });

  toggleDeleteTransactionModeBtn?.addEventListener("click", async () => {
    await waitForInlineSaveIdle();

    if (!isDeleteMode) {
      setDeleteMode(true);
      showToast("Устгах горим идэвхтэй: мөрөө сонгоод УСТ товч дарна уу.");
      return;
    }

    if (!selectedDeleteTransactionId) {
      setDeleteMode(false);
      showToast("Устгах горим дууслаа.");
      return;
    }

    const transactionId = selectedDeleteTransactionId;
    const transaction = transactionMap.get(transactionId);
    if (!transactionId || !transaction) {
      setDeleteMode(false);
      showToast("Зөв мөр сонгогдоогүй байна.");
      return;
    }

    const confirmDelete = window.confirm("Энэ гүйлгээг устгах уу?");
    if (!confirmDelete) {
      return;
    }

    toggleDeleteTransactionModeBtn.disabled = true;
    try {
      await deleteTransaction(transactionId);
      showToast("Гүйлгээ устгагдлаа.");
      selectedDeleteTransactionId = "";
      await refreshData();
      setDeleteMode(false);
    } catch (error) {
      showToast(error.message || "Гүйлгээг устгаж чадсангүй.");
    } finally {
      toggleDeleteTransactionModeBtn.disabled = false;
      updateDeleteButtonUi();
      applyDeleteModeStateToTable();
    }
  });

  expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("expenseAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    const selectedExpenseCategory =
      document.getElementById("expenseCategory").value || defaultExpenseCategoryId || null;
    if (!selectedExpenseCategory) {
      showToast("Эхлээд дор хаяж нэг зарлагын ангилал нэмнэ үү.");
      return;
    }

    await createTransaction(user.uid, {
      type: "expense",
      date: document.getElementById("expenseDate").value,
      amount,
      category_id: selectedExpenseCategory,
      account_id: document.getElementById("expenseAccount").value,
      note: document.getElementById("expenseNote").value
    });

    expenseForm.reset();
    document.getElementById("expenseDate").value = getTodayDateString();
    document.getElementById("expenseCategory").value = defaultExpenseCategoryId || "";
    closeModal(expenseModal);
    showToast("Зарлага хадгалагдлаа.");
    await refreshData();
  });

  incomeForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("incomeAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    await createTransaction(user.uid, {
      type: "income",
      date: document.getElementById("incomeDate").value,
      amount,
      category_id: document.getElementById("incomeCategory").value || null,
      account_id: document.getElementById("incomeAccount").value,
      note: document.getElementById("incomeNote").value
    });

    incomeForm.reset();
    document.getElementById("incomeDate").value = getTodayDateString();
    closeModal(incomeModal);
    showToast("Орлого хадгалагдлаа.");
    await refreshData();
  });

  transferForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = parseCompactAmountInput(document.getElementById("transferAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Дүн буруу байна. Жишээ: 25000 эсвэл 25k.");
      return;
    }

    const fromAccount = document.getElementById("transferFromAccount").value;
    const toAccount = document.getElementById("transferToAccount").value;

    if (!fromAccount || !toAccount || fromAccount === toAccount) {
      showToast("Хоёр өөр данс сонгоно уу.");
      return;
    }

    await createTransaction(user.uid, {
      type: "transfer",
      date: document.getElementById("transferDate").value,
      transfer_amount: amount,
      from_account_id: fromAccount,
      to_account_id: toAccount,
      note: document.getElementById("transferNote").value
    });

    transferForm.reset();
    document.getElementById("transferDate").value = getTodayDateString();
    closeModal(transferModal);
    showToast("Шилжүүлэг хадгалагдлаа.");
    await refreshData();
  });

  monthFilter.addEventListener("change", () => {
    listMode = "month";
    renderTransactionTable();
  });

  filterThisWeek?.addEventListener("click", () => {
    listMode = "week";
    renderTransactionTable();
  });

  filterThisMonth?.addEventListener("click", () => {
    listMode = "month";
    renderTransactionTable();
  });

  setDefaultDates();
  await refreshData();
  openQuickExpenseModalIfRequested();
  updateDeleteButtonUi();
}

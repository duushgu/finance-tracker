import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeDate(dateStr) {
  if (!dateStr) {
    return getTodayDateString();
  }

  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return getTodayDateString();
  }

  return date.toISOString().slice(0, 10);
}

export function formatCurrency(amount, currency = "EUR") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(toNumber(amount));
}

function withId(snapshot) {
  return snapshot.docs.map((entry) => ({
    id: entry.id,
    ...entry.data()
  }));
}

export async function createAccount(userId, payload) {
  return addDoc(collection(db, "accounts"), {
    name: payload.name.trim(),
    currency: payload.currency || "EUR",
    initial_balance: toNumber(payload.initial_balance),
    created_at: serverTimestamp(),
    user_id: userId
  });
}

export async function getAccounts(userId) {
  const accountQuery = query(collection(db, "accounts"), where("user_id", "==", userId));
  const snapshot = await getDocs(accountQuery);

  return withId(snapshot).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCategory(userId, payload) {
  return addDoc(collection(db, "categories"), {
    name: payload.name.trim(),
    type: payload.type || "expense",
    parent_id: payload.parent_id || null,
    user_id: userId,
    created_at: serverTimestamp()
  });
}

export async function getCategories(userId) {
  const categoryQuery = query(collection(db, "categories"), where("user_id", "==", userId));
  const snapshot = await getDocs(categoryQuery);

  return withId(snapshot).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTransaction(userId, payload) {
  const transactionType = payload.type;
  const amount = Math.abs(toNumber(payload.amount || payload.transfer_amount));

  const record = {
    type: transactionType,
    date: normalizeDate(payload.date),
    amount,
    account_id: payload.account_id || null,
    category_id: payload.category_id || null,
    note: payload.note?.trim() || "",
    from_account_id: null,
    to_account_id: null,
    transfer_amount: null,
    user_id: userId,
    created_at: serverTimestamp()
  };

  if (transactionType === "transfer") {
    record.account_id = null;
    record.category_id = null;
    record.from_account_id = payload.from_account_id;
    record.to_account_id = payload.to_account_id;
    record.transfer_amount = amount;
  }

  return addDoc(collection(db, "transactions"), record);
}

export async function getTransactions(userId) {
  const transactionQuery = query(collection(db, "transactions"), where("user_id", "==", userId));
  const snapshot = await getDocs(transactionQuery);

  return withId(snapshot).sort((a, b) => {
    const dateCompare = (b.date || "").localeCompare(a.date || "");
    if (dateCompare !== 0) {
      return dateCompare;
    }

    return (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0);
  });
}

export async function createSubscription(userId, payload) {
  return addDoc(collection(db, "subscriptions"), {
    name: payload.name.trim(),
    amount: Math.abs(toNumber(payload.amount)),
    category_id: payload.category_id,
    account_id: payload.account_id,
    frequency: payload.frequency || "monthly",
    next_charge_date: normalizeDate(payload.next_charge_date),
    user_id: userId,
    created_at: serverTimestamp()
  });
}

export async function getSubscriptions(userId) {
  const subscriptionQuery = query(collection(db, "subscriptions"), where("user_id", "==", userId));
  const snapshot = await getDocs(subscriptionQuery);
  return withId(snapshot);
}

export async function updateSubscription(subscriptionId, payload) {
  const reference = doc(db, "subscriptions", subscriptionId);
  await updateDoc(reference, payload);
}

export function calculateAccountBalances(accounts, transactions) {
  const balanceMap = new Map();

  accounts.forEach((account) => {
    balanceMap.set(account.id, toNumber(account.initial_balance));
  });

  transactions.forEach((transaction) => {
    const amount = toNumber(transaction.amount || transaction.transfer_amount);

    if (transaction.type === "income" && transaction.account_id) {
      balanceMap.set(transaction.account_id, toNumber(balanceMap.get(transaction.account_id)) + amount);
      return;
    }

    if (transaction.type === "expense" && transaction.account_id) {
      balanceMap.set(transaction.account_id, toNumber(balanceMap.get(transaction.account_id)) - amount);
      return;
    }

    if (transaction.type === "transfer") {
      const transferAmount = toNumber(transaction.transfer_amount || transaction.amount);

      if (transaction.from_account_id) {
        balanceMap.set(
          transaction.from_account_id,
          toNumber(balanceMap.get(transaction.from_account_id)) - transferAmount
        );
      }

      if (transaction.to_account_id) {
        balanceMap.set(
          transaction.to_account_id,
          toNumber(balanceMap.get(transaction.to_account_id)) + transferAmount
        );
      }
    }
  });

  return accounts.map((account) => ({
    ...account,
    current_balance: toNumber(balanceMap.get(account.id))
  }));
}

export function getMonthKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

export function getMonthlySummary(transactions, monthKey = getMonthKey()) {
  const monthlyItems = transactions.filter((item) => (item.date || "").startsWith(monthKey));

  let incomeTotal = 0;
  let expenseTotal = 0;

  monthlyItems.forEach((item) => {
    const amount = toNumber(item.amount || item.transfer_amount);

    if (item.type === "income") {
      incomeTotal += amount;
    }

    if (item.type === "expense") {
      expenseTotal += amount;
    }
  });

  return {
    monthKey,
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    monthlyItems
  };
}

export function groupExpensesByCategory(transactions, categories, monthKey = getMonthKey()) {
  const categoryMap = Object.fromEntries(categories.map((item) => [item.id, item.name]));
  const grouped = new Map();

  transactions
    .filter((item) => item.type === "expense" && (item.date || "").startsWith(monthKey))
    .forEach((item) => {
      const categoryName = categoryMap[item.category_id] || "Uncategorized";
      grouped.set(categoryName, toNumber(grouped.get(categoryName)) + toNumber(item.amount));
    });

  return Array.from(grouped.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function getRecentTransactions(transactions, limit = 8) {
  return [...transactions]
    .sort((a, b) => {
      const dateCompare = (b.date || "").localeCompare(a.date || "");
      if (dateCompare !== 0) {
        return dateCompare;
      }
      return (b.created_at?.seconds || 0) - (a.created_at?.seconds || 0);
    })
    .slice(0, limit);
}

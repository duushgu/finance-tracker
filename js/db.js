import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js";

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const APP_CURRENCY_CODE = "MNT";
export const APP_CURRENCY_SYMBOL = "₮";
export const STARTER_CATEGORIES = [
  { key: "misc", name: "Бусад", type: "expense" },
  { key: "housing", name: "Түрээс/Орон сууц", type: "expense" },
  { key: "utilities", name: "Цахилгаан/Интернэт/Даатгал", type: "expense" },
  { key: "food", name: "Хүнс", type: "expense" },
  { key: "kids", name: "Хүүхэд", type: "expense" },
  { key: "transport", name: "Тээвэр/Түлш", type: "expense" },
  { key: "work", name: "Ажил/Багаж", type: "expense" },
  { key: "health", name: "Эрүүл мэнд", type: "expense" },
  { key: "wedding", name: "Хурим", type: "expense" },
  { key: "savings", name: "Хадгаламж", type: "expense" },
  { key: "salary", name: "Цалин", type: "income" }
];

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

export function formatCurrency(amount) {
  const rounded = Math.round(toNumber(amount));
  const sign = rounded < 0 ? "-" : "";
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${grouped} ${APP_CURRENCY_SYMBOL}`;
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
    currency: APP_CURRENCY_CODE,
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

export async function updateAccount(accountId, payload) {
  return updateDoc(doc(db, "accounts", accountId), {
    ...payload,
    updated_at: serverTimestamp()
  });
}

export async function deleteAccount(accountId) {
  return deleteDoc(doc(db, "accounts", accountId));
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

export async function ensureStarterCategories(userId) {
  const existing = await getCategories(userId);
  if (existing.length) {
    const existingById = Object.fromEntries(existing.map((item) => [item.id, item]));
    const updates = STARTER_CATEGORIES.filter((item) => {
      const docId = `${userId}_starter_${item.key}`;
      const existingItem = existingById[docId];
      if (!existingItem) {
        return false;
      }

      return (
        String(existingItem.name || "") !== String(item.name || "") ||
        String(existingItem.type || "") !== String(item.type || "") ||
        existingItem.parent_id !== null
      );
    });

    if (!updates.length) {
      return { categories: existing, seeded: false, migrated: false };
    }

    await Promise.all(
      updates.map((item) =>
        updateDoc(doc(db, "categories", `${userId}_starter_${item.key}`), {
          name: item.name,
          type: item.type,
          parent_id: null,
          updated_at: serverTimestamp()
        })
      )
    );

    const migratedCategories = await getCategories(userId);
    return { categories: migratedCategories, seeded: false, migrated: true };
  }

  await Promise.all(
    STARTER_CATEGORIES.map((item) => {
      const docId = `${userId}_starter_${item.key}`;
      return setDoc(
        doc(db, "categories", docId),
        {
          name: item.name,
          type: item.type,
          parent_id: null,
          user_id: userId,
          created_at: serverTimestamp()
        },
        { merge: true }
      );
    })
  );

  const seededCategories = await getCategories(userId);
  return { categories: seededCategories, seeded: true, migrated: false };
}

export async function updateCategory(categoryId, payload) {
  return updateDoc(doc(db, "categories", categoryId), {
    ...payload,
    updated_at: serverTimestamp()
  });
}

export async function deleteCategory(categoryId) {
  return deleteDoc(doc(db, "categories", categoryId));
}

export async function hasSeenBeginnerGuide(userId) {
  const userRef = doc(db, "users", userId);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    return false;
  }

  return Boolean(snapshot.data()?.beginner_guide_seen_at);
}

export async function markBeginnerGuideSeen(userId) {
  const userRef = doc(db, "users", userId);
  await setDoc(
    userRef,
    {
      user_id: userId,
      beginner_guide_seen_at: serverTimestamp(),
      updated_at: serverTimestamp()
    },
    { merge: true }
  );
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

export async function updateTransaction(transactionId, payload) {
  return updateDoc(doc(db, "transactions", transactionId), {
    ...payload,
    updated_at: serverTimestamp()
  });
}

export async function deleteTransaction(transactionId) {
  return deleteDoc(doc(db, "transactions", transactionId));
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
      const categoryName = categoryMap[item.category_id] || "Бусад";
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

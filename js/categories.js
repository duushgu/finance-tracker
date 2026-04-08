import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import { createCategory, getCategories, updateCategory } from "./db.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function labelForType(type) {
  if (type === "expense") {
    return "Ausgabe";
  }
  if (type === "income") {
    return "Einnahme";
  }
  return "Beides";
}

function normalizeTypeInput(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (["ausgabe", "expense"].includes(normalized)) {
    return "expense";
  }
  if (["einnahme", "income"].includes(normalized)) {
    return "income";
  }
  if (["beides", "both"].includes(normalized)) {
    return "both";
  }

  return "";
}

export async function initCategoriesPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const categoryForm = document.getElementById("categoryForm");
  const categoriesTableBody = document.getElementById("categoriesTableBody");
  const categoryModal = document.getElementById("categoryModal");
  const openCategoryModalBtn = document.getElementById("openCategoryModalBtn");
  const closeCategoryModalBtn = document.getElementById("closeCategoryModalBtn");

  let categories = [];
  let isInlineSaving = false;
  const familyDefaults = [
    { name: "Sonstiges", type: "expense" },
    { name: "Miete/Wohnen", type: "expense" },
    { name: "Strom/Internet/Versicherung", type: "expense" },
    { name: "Lebensmittel", type: "expense" },
    { name: "Kinder", type: "expense" },
    { name: "Sprit/Transport", type: "expense" },
    { name: "Arbeit/Werkzeug", type: "expense" },
    { name: "Gesundheit", type: "expense" },
    { name: "Hochzeit", type: "expense" },
    { name: "Notgroschen", type: "expense" },
    { name: "Lohn", type: "income" }
  ];

  function openCategoryModal() {
    categoryModal.classList.remove("hidden");
    document.getElementById("categoryName").focus();
  }

  function closeCategoryModal() {
    categoryModal.classList.add("hidden");
  }

  function getCategoryById(categoryId) {
    return categories.find((item) => item.id === categoryId);
  }

  function renderCategoryTable() {
    if (!categories.length) {
      categoriesTableBody.innerHTML =
        '<tr><td colspan="2"><div class="empty-state">Noch keine Kategorien vorhanden.</div></td></tr>';
      return;
    }

    categoriesTableBody.innerHTML = categories
      .map((category) => {
        return `
          <tr data-category-id="${category.id}">
            <td class="editable-cell" contenteditable="true" data-field="name" spellcheck="false">${escapeHtml(category.name)}</td>
            <td class="editable-cell capitalize" contenteditable="true" data-field="type" spellcheck="false">${labelForType(category.type)}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshCategories() {
    categories = await getCategories(user.uid);
    renderCategoryTable();
  }

  async function ensureInitialCategories() {
    if (categories.length) {
      return;
    }

    for (const item of familyDefaults) {
      await createCategory(user.uid, {
        name: item.name,
        type: item.type,
        parent_id: ""
      });
    }

    categories = await getCategories(user.uid);
    showToast("Standard-Kategorien wurden automatisch angelegt.");
  }

  async function saveCellUpdate(cell) {
    const field = cell.dataset.field;
    const row = cell.closest("tr");
    if (!row) {
      return false;
    }

    const categoryId = row.dataset.categoryId;
    const category = getCategoryById(categoryId);
    if (!category) {
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
        throw new Error("Kategoriename darf nicht leer sein.");
      }
      await updateCategory(categoryId, { name: nextName });
      return true;
    }

    if (field === "type") {
      const nextType = normalizeTypeInput(currentText);
      if (!nextType) {
        throw new Error("Typ muss Ausgabe, Einnahme oder Beides sein.");
      }
      await updateCategory(categoryId, { type: nextType });
      return true;
    }

    return false;
  }

  openCategoryModalBtn.addEventListener("click", openCategoryModal);
  closeCategoryModalBtn.addEventListener("click", closeCategoryModal);

  categoryModal.addEventListener("click", (event) => {
    if (event.target === categoryModal) {
      closeCategoryModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !categoryModal.classList.contains("hidden")) {
      closeCategoryModal();
    }
  });

  categoriesTableBody.addEventListener("focusin", (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }
    cell.dataset.originalValue = cell.textContent.trim();
  });

  categoriesTableBody.addEventListener("keydown", (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      cell.blur();
    }
  });

  categoriesTableBody.addEventListener("focusout", async (event) => {
    const cell = event.target.closest(".editable-cell");
    if (!cell || isInlineSaving) {
      return;
    }

    isInlineSaving = true;
    try {
      const changed = await saveCellUpdate(cell);
      if (changed) {
        await refreshCategories();
        showToast("Kategorie aktualisiert.");
      }
    } catch (error) {
      cell.textContent = cell.dataset.originalValue || "";
      showToast(error.message || "Aktualisierung fehlgeschlagen.");
    } finally {
      isInlineSaving = false;
    }
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("categoryName").value.trim();
    const type = document.getElementById("categoryType").value;

    if (!name) {
      showToast("Bitte Name eingeben.");
      return;
    }

    await createCategory(user.uid, { name, type, parent_id: "" });

    categoryForm.reset();
    document.getElementById("categoryType").value = "expense";
    closeCategoryModal();
    showToast("Kategorie gespeichert.");
    await refreshCategories();
  });

  await refreshCategories();
  await ensureInitialCategories();
  renderCategoryTable();
}

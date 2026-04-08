import { bindAuthUi, registerPwaWorker, requireAuthPage, showToast } from "./auth.js";
import { createCategory, getCategories } from "./db.js";

export async function initCategoriesPage() {
  const user = await requireAuthPage();
  bindAuthUi(user);
  registerPwaWorker();

  const categoryForm = document.getElementById("categoryForm");
  const parentSelect = document.getElementById("categoryParent");
  const categoriesTableBody = document.getElementById("categoriesTableBody");

  let categories = [];

  function renderParentOptions() {
    const options = ['<option value="">No parent</option>'];

    categories.forEach((category) => {
      options.push(`<option value="${category.id}">${category.name}</option>`);
    });

    parentSelect.innerHTML = options.join("");
  }

  function renderCategoryTable() {
    if (!categories.length) {
      categoriesTableBody.innerHTML =
        '<tr><td colspan="3"><div class="empty-state">No categories yet. Add your first category.</div></td></tr>';
      return;
    }

    const categoryMap = Object.fromEntries(categories.map((item) => [item.id, item.name]));

    categoriesTableBody.innerHTML = categories
      .map((category) => {
        return `
          <tr>
            <td>${category.name}</td>
            <td class="capitalize">${category.type}</td>
            <td>${categoryMap[category.parent_id] || "-"}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function refreshCategories() {
    categories = await getCategories(user.uid);
    renderParentOptions();
    renderCategoryTable();
  }

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("categoryName").value.trim();
    const type = document.getElementById("categoryType").value;
    const parent_id = parentSelect.value;

    if (!name) {
      showToast("Category name is required.");
      return;
    }

    await createCategory(user.uid, { name, type, parent_id });

    categoryForm.reset();
    document.getElementById("categoryType").value = "expense";
    showToast("Category added.");
    await refreshCategories();
  });

  await refreshCategories();
}

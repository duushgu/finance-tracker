import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, googleProvider, isFirebaseConfigured } from "./firebase.js";

let persistencePromise;

function ensurePersistence() {
  if (!persistencePromise) {
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error("Auth persistence error:", error);
    });
  }

  return persistencePromise;
}

async function syncUserDocument(user) {
  if (!user) {
    return;
  }

  const userRef = doc(db, "users", user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      email: user.email || "",
      display_name: user.displayName || "",
      photo_url: user.photoURL || "",
      last_login_at: serverTimestamp()
    },
    { merge: true }
  );
}

export function showToast(message, duration = 2600) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, duration);
}

export function registerPwaWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

export async function setupLoginPage() {
  await ensurePersistence();

  const statusEl = document.getElementById("loginStatus");
  const loginBtn = document.getElementById("googleLoginBtn");

  if (!loginBtn) {
    return;
  }

  if (!isFirebaseConfigured) {
    statusEl.textContent = "Firebase config placeholders are still set. Update js/firebase.js first.";
    statusEl.className = "text-sm text-amber-700 text-center";
  }

  loginBtn.addEventListener("click", async () => {
    try {
      loginBtn.disabled = true;
      loginBtn.textContent = "Signing in...";
      const credential = await signInWithPopup(auth, googleProvider);
      await syncUserDocument(credential.user);
      window.location.href = "./dashboard.html";
    } catch (error) {
      console.error("Google sign in failed:", error);
      statusEl.textContent = error.message || "Google login failed.";
      statusEl.className = "text-sm text-rose-700 text-center";
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in with Google";
    }
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.href = "./dashboard.html";
    }
  });
}

export async function requireAuthPage() {
  await ensurePersistence();

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        await syncUserDocument(user);
        unsubscribe();
        resolve(user);
        return;
      }

      const currentPage = window.location.pathname.split("/").pop() || "index.html";
      if (currentPage !== "index.html") {
        window.location.href = "./index.html";
      }
    });
  });
}

export function bindAuthUi(user) {
  const userEmail = document.getElementById("currentUserEmail");
  if (userEmail && user) {
    userEmail.textContent = user.email || "";
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "./index.html";
    });
  }
}

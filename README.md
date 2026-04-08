# Finance Tracker (Static + Firebase)

Finance Tracker is a static web app built with HTML, TailwindCSS and vanilla JavaScript.
It uses Firebase Authentication (Google login) and Firestore as backend services.
The app is designed for GitHub Pages deployment.

## Features

- Google sign-in (Firebase Auth)
- User-scoped data (`user_id` filtered queries)
- Accounts with dynamic balance calculation
- Transactions: expense, income, transfer
- Categories with optional parent category
- Subscriptions and due-charge generation
- Dashboard with monthly totals and expenses-by-category chart (Chart.js)
- PWA install support (manifest + service worker)

## Project Structure

```text
finance-tracker/
├── index.html
├── dashboard.html
├── accounts.html
├── transactions.html
├── categories.html
├── subscriptions.html
├── manifest.json
├── service-worker.js
├── css/
│   └── style.css
├── js/
│   ├── firebase.js
│   ├── auth.js
│   ├── db.js
│   ├── transactions.js
│   ├── accounts.js
│   ├── categories.js
│   └── dashboard.js
└── assets/
    ├── icon.svg
    └── icon-maskable.svg
```

## Firebase Setup

1. Create a Firebase project.
2. Enable **Authentication > Sign-in method > Google**.
3. Create **Firestore Database**.
4. In **Project Settings > General > Your apps (Web app)** copy config values.
5. Replace placeholders in `js/firebase.js`:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

## Firestore Security Rules (recommended)

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{collection}/{docId} {
      allow read, write: if request.auth != null
        && (
          request.method == 'create'
            ? request.resource.data.user_id == request.auth.uid
            : resource.data.user_id == request.auth.uid
        );
    }
  }
}
```

## Local Run

Use any static server. Example:

```bash
cd finance-tracker
python3 -m http.server 5500
```

Open `http://localhost:5500`.

## GitHub Pages Deployment

1. Push the `finance-tracker/` contents to your repo root (or `docs/` folder).
2. In GitHub repo: **Settings > Pages**.
3. Select source branch (e.g. `main`) and folder (`/root` or `/docs`).
4. Add your GitHub Pages domain to **Firebase Authentication > Authorized domains**.
5. If needed, add Firestore indexes when prompted by Firebase console.

## Notes

- Every Firestore query in the app includes `where("user_id", "==", currentUser.uid)`.
- Account balances are computed from transactions as single source of truth.
- Service worker caches static app shell for faster reload and installability.

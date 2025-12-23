# How to Update the App

Since you are hosting this app yourself (likely on an internal server), updating it involves two steps: **Updating the Server** and **Updating the Users**.

## 1. Updating the Server (Deployment)
When you push new code to GitHub, your server doesn't know about it yet. You need to tell the server to download the new code and rebuild the app.

### The Easy Way (Using the Script)
I have created a script called `update_app.bat` in your project folder.

1.  Go to the computer/server hosting the app.
2.  Double-click `update_app.bat`.
3.  It will automatically:
    *   Download the latest code (`git pull`).
    *   Install any new libraries (`npm install`).
    *   Rebuild the app (`npm run build`).

### The Manual Way
If you prefer to do it manually, run these commands in the terminal on your server:
```powershell
git pull
npm install
npm run build
```

## 2. Updating the Users (PWA Auto-Update)
You do **not** need to tell your users to do anything.

1.  We configured the app with `registerType: 'autoUpdate'`.
2.  When a user opens the app, it checks your server for a new version.
3.  If a new version exists (the `dist` folder changed), the app will download it in the background.
4.  The next time they refresh or reopen the app, they will see the new version.

## Summary
1.  **You:** Push code to GitHub.
2.  **Server:** Run `update_app.bat`.
3.  **Users:** Get the update automatically next time they use the app.

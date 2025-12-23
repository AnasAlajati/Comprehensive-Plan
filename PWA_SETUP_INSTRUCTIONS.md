# PWA Setup Instructions

Your application has been configured as a Progressive Web App (PWA). This allows it to be installed on devices and work offline.

## 1. Add Icons
To make the app installable, you must add icon files to the `public` folder (create the folder if it doesn't exist).

**Required Files:**
1.  `public/pwa-192x192.png` (192x192 pixels)
2.  `public/pwa-512x512.png` (512x512 pixels)
3.  `public/apple-touch-icon.png` (180x180 pixels, optional but recommended for iOS)
4.  `public/favicon.ico` (Standard favicon)

## 2. Build the App
PWAs work best in production builds. To test the offline capabilities:

1.  Run the build command:
    ```bash
    npm run build
    ```
2.  Preview the build:
    ```bash
    npm run preview
    ```

## 3. Verify
1.  Open the app in Chrome.
2.  Open DevTools (F12) -> Application tab -> Service Workers.
3.  You should see a service worker registered.
4.  Go to "Network" tab, set to "Offline", and refresh. The app should still load!

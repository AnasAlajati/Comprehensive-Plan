# IMPORTANT: Add Icons for Install Button

You requested a "Download App" button. For this button to appear and work, the browser **REQUIRES** icon files.

## Action Required
You must add two image files to the `public` folder in your project.

1.  **Find any image** (like your company logo).
2.  **Resize/Save it** as a PNG file named `pwa-192x192.png` (approx 192x192 pixels).
3.  **Resize/Save it** as a PNG file named `pwa-512x512.png` (approx 512x512 pixels).
4.  **Place them** in: `c:\Users\mayad\OneDrive\Desktop\firestore-connectivity-demo (2)\public\`

## Why?
The "Install App" button listens for a browser event called `beforeinstallprompt`. Chrome/Edge will **NOT** fire this event if the app doesn't have icons in the manifest.

## Testing
1.  Add the images.
2.  Run `npm run build`.
3.  Run `npm run preview`.
4.  Open the link.
5.  You should see the "Install App" button in the top right header.

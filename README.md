DISCIPLINE HQ — FONT + JARVIS PET FIX

Files in this package:
- index.html
- styles.css
- app.js
- jarvis.js
- design-reference.png (reference image only)
- README-INSTALL.txt

WHAT THIS UPDATE FIXES
1. Typography: DM Sans for body text and Space Grotesk for headings, with a safe fallback stack.
2. Jarvis position: fixed to the viewport's lower-right corner with a very high z-index.
3. Visible robot pet: the launcher now renders a small, animated red-and-gold chibi powered-armour-inspired robot in CSS (no external image needed).
4. Chat panel: remains clickable and uses the existing Jarvis preview replies.

INSTALL ON GITHUB
1. Download and extract this ZIP.
2. Back up your repository's current files.
3. Replace index.html, styles.css, app.js and jarvis.js with these files.
4. Commit all four files to the same folder on the main branch.
5. Wait for GitHub Pages to redeploy, then hard-refresh the page (Ctrl+Shift+R).
6. If your browser still shows the old layout, open the site in a private/incognito window to rule out caching.

NOTES
- Google Fonts are loaded from fonts.googleapis.com; if offline or blocked, system fallbacks are used.
- The robot is CSS-drawn, not a full 3D model or exact copyrighted character.
- Jarvis is still a preview with predefined responses. Gemini is not connected.
- The current chat history is browser-local; it does not sync between devices.
- Test the website after deploying. This package has not been executed in your live browser.
- Do not place a Gemini API key in browser-visible JavaScript; use a secure backend endpoint for the later integration.

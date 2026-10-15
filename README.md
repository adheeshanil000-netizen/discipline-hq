DISCIPLINE HQ — CLOUDFLARE CLOUD-CONNECTED FRONTEND

FILES
- index.html
- styles.css
- app.js
- assets/earth-orbit-background.png

INSTALL
1. Back up the currently deployed site and export records from Settings > Export records.
2. Replace the site's index.html, styles.css, and app.js with these files.
3. Keep assets/earth-orbit-background.png in the assets folder beside index.html.
4. Deploy the frontend to the same static hosting/GitHub Pages/Cloudflare Pages location as before.
5. Open the site and choose Connect cloud in the top bar.
6. Create an account with a valid email and a password of at least 12 characters, or sign in to the same account on each device.
7. On first connection, if the cloud has no data, this device's current app state is uploaded automatically.
8. If cloud data already exists, choose Load cloud data to use the shared cloud copy, or choose Replace cloud with this device's data only if you explicitly want to overwrite the cloud copy.
9. On your phone, open the same deployed site and sign in with the same account.
10. In Intra-market and Post-market, use the top “Mark as No Trade” button on days you do not trade. That section will be excluded from that day’s discipline score; click Undo to include it again.

IMPORTANT
- This frontend uses the Worker endpoint:
  https://discipline-hq-api.adheeshanil000.workers.dev
- The Worker must be deployed with the D1 binding named DB and the API routes /api/register, /api/login, /api/logout, /api/data, and /api/health.
- Cloud data sync uses one JSON document per account through the Worker API. This includes app state, settings, checklists, records, reflections, nurse notes, and theme.
- The existing local browser copy is retained after sign-out.
- Cross-device refresh polling runs about every 12 seconds. Avoid editing the same record simultaneously on two devices.
- Use HTTPS hosting. Do not put your account password or Worker secrets into frontend source files.
- The AI Discipline Nurse remains a rule-based offline preview; this package does not connect Gemini.
- The account-mode link now clearly switches the modal into “Create your cloud account” registration mode.
- Intra-market and Post-market have explicit top-of-section No Trade buttons; they use the existing not-applicable scoring rule.
- Test first with non-critical data and keep backups.

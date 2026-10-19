# Issue #110 — automated browser evidence (2026-10-19)

**Run type:** automated Chromium UI walkthrough only. No human usability session was performed.  
**Baseline:** post-#165 `main`, `7e86b66b6a3ca5fe464ebf5836097aa9c5e2f7c6`.  
**Browser:** Google Chrome `155.0.8059.85`, headless Chromium; CDP-created isolated browser contexts for GM, Player A, Player B.  
**App/host:** Vite `http://127.0.0.1:5173/`; experimental host `http://127.0.0.1:4177`; fresh SQLite DB under `.playtest-issue110-20261019/revised5e.sqlite`; V2 enabled only for this loopback process. Temporary databases and browser profile are disposable and must not be committed.

## Reproduction

1. Start a fresh host with `POTOMAC_ENABLE_EXPERIMENTAL_V2=1`, `POTOMAC_SEED_DEMO=0`, and an absolute temporary `POTOMAC_DB` path. Start the web client bound to `127.0.0.1` with its API proxy pointed at that host.
2. In a fresh GM browser profile, open Campaign Home, choose **Revised 5e Encounter · 1.1.0**, name the campaign `Issue 110 Revised 5e Playtest`, and select **Create fresh experimental V2 campaign**.
3. Confirm Campaign Home and the Rules workspace show the pinned root `example.revised5e@1.1.0`, digest `sha256:d8a631a927bc43ae219c23d02d2aca4471b505e52bd5d479b71cd6029b60811e`.
4. From the Rules workspace, use **Enroll a player** twice. The runner reads the two one-time credentials from the GM UI into memory only; it neither prints nor saves them.
5. Create two isolated Chromium contexts, open the real loopback app, submit each issued credential via the app’s **Use player credential** browser prompt, navigate into Rules and return to Campaign Home.
6. Inspect sanitized screenshots and DOM text. The GM screenshot is taken after returning from the enrollment screen. Player screenshots are taken from their Campaign Home. Rules page observations are stored with principal UUIDs redacted.

Runner: [`automated-ui-capture.mjs`](automated-ui-capture.mjs). Sanitized screenshots: [`gm-campaign-home.png`](gm-campaign-home.png), [`playerA-campaign-home.png`](playerA-campaign-home.png), [`playerB-campaign-home.png`](playerB-campaign-home.png). The runner does not use API calls to create campaign or player state; all host state is created by the application UI. It does not seed a character or invoke module commands.

## Evidence limits

The Campaign Home UI visibly confirms the root module ID, version and digest. It does not display the complete capability closure, so this run does not independently verify the full lock closure. No player action, character assignment, combat, reaction, map, session lifecycle, restart/reconnect or retry was attempted because the ordinary workspace did not expose Revised 5e action controls and Campaign Home/Table showed no V2 encounter or character. Do not infer an authorization/privacy pass for private Revised 5e state from an empty campaign.

The separate Dice-pool smoke used its own fresh host and web origin (`4178`/`5174`). Campaign Home pinned `example.dicepool@1.0.0` with digest `sha256:4a9bc882fe0d53bc7efc11f0ac459887d6b1243c100b193069c9029d98ce8a65`. The GM created a scene through the generic schema form. No player enrollment/action or private GM-note projection assertion was completed; this remains a partial contrast smoke.

Automated Chromium is not human playtesting, keyboard-only acceptance, screen-reader evaluation, physical-device testing, or real-network testing. All unattempted acceptance remains pending under #110.

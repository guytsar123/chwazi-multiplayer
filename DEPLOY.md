# Deploying Chwazi (free, single service on Render)

One free Render web service runs the Socket.IO server **and** serves the built
React client from the same URL. No separate static host needed.

## 1. Put the code on GitHub
Create an empty repo at https://github.com/new (e.g. `chwazi-multiplayer`),
**without** a README/.gitignore. Then, from the project folder:

```powershell
git remote add origin https://github.com/<YOUR-USERNAME>/chwazi-multiplayer.git
git branch -M main
git push -u origin main
```

## 2. Deploy on Render
1. Sign in at https://render.com (free, "Sign in with GitHub").
2. **New → Blueprint** → pick the `chwazi-multiplayer` repo.
3. Render reads [render.yaml](render.yaml) automatically — just click **Apply**.
4. Wait ~2–3 min for the first build. You'll get a URL like
   `https://chwazi-multiplayer.onrender.com`.

That URL is the whole game. Share it / open it on phones. One person taps
**Create Lobby**, others **Join** with the code or QR.

## Notes
- **Free tier sleeps** after ~15 min idle; the first request after that takes
  ~30–50s to wake. Fine for casual play.
- Lobbies live in memory, so a server restart clears active rooms (by design).
- To run locally instead, see [run.ps1](run.ps1).

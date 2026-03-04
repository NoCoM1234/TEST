#  Master API

Backend API for the  Master userscript — handles encrypted alliance troop data sharing.

---

## Deploy to Render (step by step)

### Step 1 — Push to GitHub

1. Go to **github.com** and click **New repository**
2. Name it `-master-api`, set it to **Public**, click **Create repository**
3. On your computer, open a terminal/command prompt in this folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/-master-api.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

### Step 2 — Deploy on Render

1. Go to **render.com** and log in
2. Click **New +** → **Web Service**
3. Click **Connect a repository** and select `-master-api`
4. Fill in the settings:
   - **Name:** `-master-api` (or anything you like)
   - **Region:** Frankfurt (closest to Greece) or whichever is nearest to you
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`
5. Click **Create Web Service**
6. Wait ~2 minutes for it to build and deploy
7. Copy your service URL — it will look like `https://-master-api-xxxx.onrender.com`

---

### Step 3 — Add your URL to the userscript

In the  Master userscript, find this line near the top of the Alliance tab section:

```javascript
const ALLIANCE_API = 'YOUR_API_URL_HERE';
```

Replace `YOUR_API_URL_HERE` with the URL you copied from Render.

---

### Step 4 — Keep the server awake (important!)

Render's free tier puts your server to sleep after 15 minutes of inactivity. To prevent this:

1. Go to **uptimerobot.com** (free)
2. Create a free account
3. Click **Add New Monitor**
4. Select **HTTP(s)**
5. Friendly Name: ` API`
6. URL: your Render URL (e.g. `https://-master-api-xxxx.onrender.com`)
7. Monitoring Interval: **5 minutes**
8. Click **Create Monitor**

This pings your server every 5 minutes to keep it alive.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| POST | `/groups/create` | Create a new alliance group |
| POST | `/players/push` | Push your encrypted data |
| GET | `/players/:token` | Fetch all players in a group |
| DELETE | `/players/:token/:playerId` | Remove yourself from a group |

---

## How it works

- All troop data is **encrypted in the browser** with your group key before being sent
- The server only stores encrypted blobs — it cannot read your troop numbers
- Only players who know the group key can decrypt the data
- Stale data (not updated in 7 days) is automatically deleted

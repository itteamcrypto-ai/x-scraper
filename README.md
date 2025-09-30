# 🚀 X-SCRAPER 🐦

**X-SCRAPER** is an **OPEN-SOURCE** Node.js application designed for scrapes tweets and mentions from **X (FORMERLY TWITTER)**. It leves **PUPPETEER** for data extraction, processes the information using **AI** for classification and enrichment, and sends high-priority alerts to **DISCORD CHANNELS**. It's built to run reliably as a background service, using a cron job to process users sequentially every few minutes.

---

## ✨ KEY FEATURES

* **TWITTER SCRAPING**: 🕵️ Scrapes the latest tweets and mentions for a specified list of users from X.
* **AI ENHANCEMENT**: 🧠 Classifies and enriches the scraped tweet data using an external AI service.
* **DISCORD ALERTS**: 🔔 Sends crucial alerts and information instantly to Discord via webhooks.
* **DATA PERSISTENCE**: 💾 Utilizes **MONGODB** for robust data storage, tracking, and state management.
* **ROBUST OPERATIONS**: 💪 Includes comprehensive error handling and intelligent retry logic for stability.

---

## 🛠️ REQUIREMENTS

To run **SOLANA-X-SCRAPER**, you will need the following installed and configured:

* **NODE.JS** v18 or higher
* **MONGODB** database (local or remote instance)
* **MINIMUM 4GB RAM** (Essential for Puppeteer/Chromium processes)
* **X (TWITTER) PREMIUM ACCOUNT** (REQUIRED for reliable scraping and avoiding rate limits)
* **DISCORD WEBHOOK URLS** (For main alerts and a separate channel for error reporting)

---

## ⚙️ ENVIRONMENT VARIABLES

Create a `.env` file in the root directory to configure the application. Use the template below for your setup.

| VARIABLE NAME | DESCRIPTION |
| :--- | :--- |
| `MONGO_URI` | **MongoDB** connection string |
| `GEMINI_API_KEY` | **Google Gemini API Key** for AI classification (Placeholder for `AI_API_KEY`) |
| `DISCORD_POSTS_WEBHOOK` | Discord webhook for **MAIN ALERTS** (Replaces `DISCORD_WEBHOOK_URL`) |
| `DISCORD_ALERTS_WEBHOOK` | Discord webhook for **HIGH-PRIORITY ALERTS** (New) |
| `DISCORD_ERROR_WEBHOOK` | Discord webhook for **ERROR NOTIFICATIONS** (Replaces `DISCORD_ERROR_WEBHOOK_URL`) |
| `X_AUTH_TOKEN` | X (Twitter) session `auth_token` (Cookie value) |
| `X_CT0` | X (Twitter) session `ct0` (Cookie value) |
| `X_BEARER` | Bearer token (optional/situational) |
| `X_COOKIES` | Full X (Twitter) cookie string (optional/alternative) |
| `X_USERNAME` | X (Twitter) Premium Account Username |
| `X_PASSWORD` | X (Twitter) Premium Account Password |

**EXAMPLE `.ENV` FILE:**
```env
MONGO_URI=mongodb://127.0.0.1:27017/xscraper
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
DISCORD_POSTS_WEBHOOK=[https://discord.com/api/webhooks/main/](https://discord.com/api/webhooks/main/)...
DISCORD_ALERTS_WEBHOOK=[https://discord.com/api/webhooks/priority/](https://discord.com/api/webhooks/priority/)...
DISCORD_ERROR_WEBHOOK=[https://discord.com/api/webhooks/errors/](https://discord.com/api/webhooks/errors/)...
X_AUTH_TOKEN=your_x_auth_token
X_BEARER=your_x_bearer_token
X_CT0=your_x_ct0_token
X_COOKIES="auth_token=...; ct0=..."
X_USERNAME=your_premium_username
X_PASSWORD=your_premium_password
```

---

## 🚀 GETTING STARTED
Follow these simple steps to get the scraper up and running:

* **1. CLONE THE REPOSITORY.**

* **2. INSTALL DEPENDENCIES.**

* **3. CONFIGURE ENVIRONMENT:** Copy .env.example to .env and fill in all your required keys and URLs.

* **4. START MONGODB:** Ensure your MongoDB server is running and accessible via the MONGO_URI.
  
* **5. INITIALIZE USERS (CRITICAL STEP!):** The scraper REQUIRES the Users collection in MongoDB to exist and contain entries for the cron job to start processing. If this collection is empty, the scraper  for specific users run but won't process. You can inject 3 example users into your database using the provided seed file or using the API of users in src/index.ts
```Bash
  npm run init
```
* **6. TEST THE SCRAPER**
```Bash
  npm run dev
```
* **7. RUN FOR PRODUCTION**
```Bash
  npm run build
```
---

## 💡 USAGE AND CONFIGURATION
Follow these simple steps to get the scraper up and running:

* **The application runs perpetually as a BACKGROUND SERVICE.**

* CRON DEPENDENCY: The core scraping logic relies on the Users collection in MongoDB. Each user in this collection is processed sequentially by the cron job to scrape their tweets and mentions. If the Users collection is empty, the cron job will not execute the scraping function.

* To scrape a specific user, you must ensure that user is added to the MongoDB Users collection. The scraping logic is primarily handled in src/worker.ts.

* A CRON JOB processes the next user in the sequence approximately every 4 minutes (configurable in src/index.ts).
  
---
## ⚖️ LICENSE
This project is distributed under the MIT LICENSE. See the LICENSE file for more details.

---
## ⚠️ IMPORTANT NOTES

* **X PREMIUM ACCOUNT:** 💎 A paid X (Twitter) Premium account is mandatory for reliable operation and to bypass aggressive rate limiting and anti-bot measures.

* **RESOURCE USAGE:** 🖥️ 4GB+ RAM is a hard minimum requirement for Puppeteer/Chromium to run stably in a headless environment.

* **DISCORD SETUP:** 🔗 Ensure your Discord webhooks are correctly configured and permissions are set.

* **AI SERVICE:** 🤖 You must provide a valid API KEY for your chosen AI classification service (e.g., Gemini).

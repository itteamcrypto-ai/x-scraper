/**
 * Entry point for the X-Scraper application.
 * 
 * This file sets up the Express server (commented out by default), connects to the database,
 * and starts the main scraping worker. The worker uses Puppeteer to scrape tweets and mentions
 * from X (Twitter), processes them with AI, and sends relevant information to Discord channels.
 * 
 * The project is designed to be run as a background service, with a cron job that processes
 * users in sequence every few minutes.
 * 
 * Author: Your Name
 * License: MIT
 */

import express, { Application } from "express";
import cron from 'node-cron';
import cors from "cors";
import connectDB from "./config/db.js";
import userRoutes from "./routes/user.js";
import "dotenv/config";
import { runWorker, setupPersistentBrowser, getAllUsersFromDb, processUserAndMentions } from "./worker.js";
import ScraperState from './models/ScraperState.js';
import { Browser } from "puppeteer";
import { sendToDiscord, sendErrorChannel } from "./services/discordService.js";

/**
 * Main function to start the scraping worker.
 * - Connects to MongoDB.
 * - Launches a persistent Puppeteer browser session.
 * - Handles X Premium authentication errors.
 * - Starts the main scraping loop and a cron job to process users sequentially.
 */
export async function startWorker() {
  let browserInstance: Browser | 'premium' | null = null;
  let allUsers = [];
  try {
    // Connect to MongoDB
    await connectDB();

    // Launch Puppeteer browser and authenticate session
    browserInstance = await setupPersistentBrowser();

    // Handle X Premium block (account requires subscription)
    if (browserInstance === 'premium') {
      sendErrorChannel('Authentication failed: X is asking to subscribe to Premium. Please update your account credentials.');
      console.error("Authentication failed due to Premium block. Retrying in 10s.");
      setTimeout(startWorker, 10000);
      return;
    } else if (browserInstance != null) {
      // Start the main worker loop (scrapes all users in parallel)
      runWorker(browserInstance);

      // Name for the scraper state document in MongoDB
      const stateName = 'user-sequencer';

      // Cron job: every 4 minutes, process the next user in the list
      cron.schedule('*/4 * * * *', async () => {
        console.log('--- Starting cron scrape of a user ---');
        try {
          // Fetch all users from the database
          allUsers = await getAllUsersFromDb();
          if (allUsers?.length === 0) {
            console.log('No users to process. Exiting cron job.');
            return;
          }

          // Get or create the scraper state (tracks which user was processed last)
          const state = await ScraperState.findOneAndUpdate(
            { name: stateName },
            { $setOnInsert: { lastProcessedIndex: 0 } },
            { upsert: true, new: true }
          );

          let nextIndex = state.lastProcessedIndex;
          const userToProcess = allUsers ? allUsers[nextIndex] : false;

          // Process the next user in the list
          if (userToProcess) {
            if (browserInstance != null && browserInstance != 'premium') {
              await processUserAndMentions(browserInstance, userToProcess);
              // Update index for next run (circular)
              nextIndex = (nextIndex + 1) % allUsers.length;
              state.lastProcessedIndex = nextIndex;
              await state.save();
            }
          } else {
            // Reset index if user not found
            state.lastProcessedIndex = 0;
            await state.save();
          }
        } catch (error) {
          console.error('Error during cron user scrape:', error);
        }
      });
    }
  } catch (err) {
    // Handle fatal errors: send to Discord and retry after 10 seconds
    sendErrorChannel('Worker crashed, retrying in 10s');
    console.error("Worker crashed, retrying in 10s:", err);
    if (browserInstance != null && browserInstance != 'premium') {
      await browserInstance.close();
      browserInstance = null;
    }
    setTimeout(startWorker, 10000);
  }
}

// Start the worker on launch
startWorker().catch((err) => {
  console.error("Failed to start server:", err);
});

/**
 * (Optional) Express server setup.
 * Uncomment this section if you want to expose HTTP endpoints for health checks, user management, etc.
 */

// const app: Application = express();
// const PORT = process.env.PORT || 4000;

// // Middlewares
// app.use(cors());
// app.use(express.json());

// // Routes
// app.use("/users", userRoutes);

// // Start server
// async function start() {
//   app.listen(PORT, () => {
//     connectDB();
//     console.log(` Server running on http://localhost:${PORT}`);
//     
//     // // If u wanna still the API WORKING and the worker
//     // startWorker();
//   });
// }

// start().catch((err) => {
//   console.error(" Failed to start server:", err);
// });

/**
 * Project structure:
 * - src/
 *   - index.ts           // Entry point (this file)
 *   - worker.ts          // Scraping and processing logic
 *   - config/db.js       // MongoDB connection
 *   - models/            // Mongoose models (User, ScraperState, etc.)
 *   - routes/            // Express routes (optional)
 *   - services/          // Discord integration, AI, etc.
 * 
 * Environment variables:
 * - See .env.example for required configuration (MongoDB URI, Discord tokens, etc.)
 * 
 * For more details, see the README.md in the project root.
 */



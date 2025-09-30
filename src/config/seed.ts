// src/config/seed.ts
import "dotenv/config";
import connectDB from "./db.js";
import User from "../models/User.js";
import { startWorker } from "../index.js";

async function seedUsersAndStart() {
  try {
    await connectDB();
    console.log("Database connected. Starting seed process...");
    const initialUsers = [
      {
        username: "solana",
        url: "https://x.com/solana",
      },
      {
        username: "pumpdotfun",
        url: "https://x.com/pumpdotfun",
      },
      {
        username: "DexScreener",
        url: "https://x.com/DexScreener",
      },
    ];
    for (const u of initialUsers) {
      const exists = await User.findOne({ username: u.username });
      if (exists) {
        console.log(`User already exists: @${u.username}`);
        continue;
      }
      const newUser = new User(u);
      await newUser.save();
      console.log(`User added: @${u.username}`);
    }
    console.log("Seeding completed. Launching main application worker...");
    await startWorker();
  } catch (err) {
    console.error("Error during initialization (seeding or worker start):", err);
    process.exit(1);
  }
}
seedUsersAndStart();
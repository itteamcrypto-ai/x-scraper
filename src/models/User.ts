import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  username: string;    // Username in X (e.g., “solana”)
  url: string;         // Direct URL (e.g., https://x.com/solana)
  active: boolean;     // Whether or not to scrape
  category?: string;   // E.g.: “memecoins,” “influencer,” “exchange”
  createdAt: Date;     // Date of entry in DB
}

const UserSchema: Schema = new Schema({
  username: { type: String, required: true, unique: true },
  url: { type: String, required: true },
  active: { type: Boolean, default: true },
  category: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IUser>("User", UserSchema);

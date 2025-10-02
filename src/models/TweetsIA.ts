import mongoose, { Schema, Document } from "mongoose";

export interface TweetsIA extends Document {
  tweetId: string;
  username: string;
  text: string;
  timestamp: Date;
  category: string;       // e.g. "memecoin", "news", "viral"
  tags: string[];         // e.g. ["meme", "airdrop"]
  contracts: {
    address: string;
    blockchain: string;
  }[];    // Detected or confirmed addresses
  enriched?: EnrichedData[];
  createdAt: Date;
  mediaUrl: string | null;
  scrapedFor?: 'profile' | 'mention' | 'feed'; // Indicates the source of the tweet
}

export interface EnrichedData {
  address: string;
  tokenSymbol?: string;
  priceUsd?: number;
  fdv?: number;
  liquidity?: number;
  volume24h?: number;
  blockchain?: string;
}

const EnrichedDataSchema: Schema = new Schema({
  address: { type: String, required: true },
  tokenSymbol: { type: String, default: null },
  priceUsd: { type: Number, default: null },
  fdv: { type: Number, default: null },
  liquidity: { type: Number, default: null },
  volume24h: { type: Number, default: null },
  blockchain: { type: String, default: null }
});

const TweetIASchema: Schema = new Schema({
  tweetId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, required: true },
  category: { type: String, default: "unclassified" },
  tags: { type: [String], default: [] },
  contracts: {
    type: [
      {
        address: { type: String, required: true },
        blockchain: { type: String }
      }
    ],
    default: []
  },
  enriched: { type: [EnrichedDataSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  scrapedFor: { type: String, enum: ['profile', 'mention', 'feed'], default: 'feed' }
});

export default mongoose.model<TweetsIA>("TweetsIA", TweetIASchema);

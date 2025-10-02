import mongoose, { Schema, Document } from "mongoose";

export interface Post extends Document {
  tweetId: string;
  username: string;
  text: string;
  timestamp: Date;
  contracts: {
    address: string;
    blockchain: string;
  }[];
  status: string;
  createdAt: Date;
  mediaUrl: string;
  scrapedFor?: 'profile' | 'mention' | 'feed'; // Indicates the source of the tweet
}

const PostSchema: Schema = new Schema({
  tweetId: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  text: { type: String },
  timestamp: { type: Date, required: true },
  contracts: {
    type: [
      {
        address: { type: String, required: true },
        blockchain: { type: String }
      }
    ],
    default: []
  },
  status: { type: String, default: "unprocessed" },
  createdAt: { type: Date, default: Date.now },
  mediaUrl: { type: String },
  scrapedFor: { type: String, enum: ['profile', 'mention', 'feed'] }
});

export default mongoose.model<Post>("Post", PostSchema);

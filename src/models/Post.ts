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
});

export default mongoose.model<Post>("Post", PostSchema);

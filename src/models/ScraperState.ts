import mongoose, { Schema, Document } from "mongoose";


export interface IScraperState extends Document {
    name: string;
    lastProcessedIndex: number;
}

const ScraperStateSchema = new Schema({
    name: { type: String, required: true, unique: true },
    lastProcessedIndex: { type: Number, required: true, default: 0 },
});

export default mongoose.model<IScraperState>('ScraperState', ScraperStateSchema);
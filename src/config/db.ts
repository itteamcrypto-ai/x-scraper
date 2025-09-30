import mongoose from "mongoose";

const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/xscraper";
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected at", mongoUri);
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
  }
};

export default connectDB;

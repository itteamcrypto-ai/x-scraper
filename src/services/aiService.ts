// src/services/aiService.ts
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";
import axios from "axios";
import { Category } from "worker.js";


interface ClassificationInput {
    text: string;
    mediaUrl?: string; // Optional, url image/media
    mimeType?: string; // Optional
}


// Init Gemini
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

// Define schema for JSON output
const responseSchema = {
    type: Type.OBJECT,
    properties: {
        category: { type: Type.STRING },   // One of: memecoin, token-related, airdrop, trending, market/news, scam/risk, general, not-relevant
        tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING }, // Must be from predefined allowed tags only
        },
        contracts: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    address: { type: "STRING" },
                    blockchain: { type: "STRING" },
                },
                // Optional - You can enforce that these fields are required
                required: ["address"],
            }
        },
    },
    propertyOrdering: ["category", "tags", "contracts"],
};

//AI PROMPT
const aiPrompt = (text: string) => `
You are a highly discerning **Crypto Signals Analyst AI**. Your primary and most critical goal is to **aggressively filter out noise** and only categorize tweets that contain **concrete, actionable signals, major market moving insights, or verifiable, high-impact project updates for the 2025 crypto landscape.**

Analyze the provided content (Text and/or Image Description) and categorize it based on the official list. Your response must be **strict JSON** and in english, nothing else.


Content for Analysis:
"${text}"

Category Rules (STRICT FILTERING):
1. **Filtering Priority:** This is your highest priority. If the content falls into any of the following categories, it MUST be classified as **"not-relevant"**:
    *   **Vague/Motivational Posts:** Generic statements about "HODL," "microcaps are green," "Bonk Super Cycle," or personal feelings.
    *   **Basic Project Introductions/Marketing:** Statements that are just general project promotion, enthusiasm, or basic descriptions (e.g., "Jupiter is an aggregator," "Wallet is sexy").
    *   **Emotional/Teasers/Rhetorical Questions:** Posts like "The Truth About X," "What does X need to do?," or simple "ONE OF US" memes.
    *   **Simple Reposts, Mentions, or Price Charts without commentary/signal.**
    *   **General Macroeconomics** not specific to crypto.
2. **Category Specific Thresholds (Strict):**
    *   **Market Sentiment:** ONLY use this if it reflects a major, well-articulated shift in sentiment, not vague enthusiasm or personal opinion. Most sentiment posts should be 'not-relevant'.
    *   **Project Updates:** ONLY use this if it's a specific, actionable detail (e.g., specific staking rule, bug fix, major integration, a scheduled event), NOT general marketing or self-promotion.
    *   **New Meme/Viral:** ONLY use this if the post *itself* indicates massive, immediate viral potential or provides a link a new coin launch; otherwise, classify as 'not-relevant'.
    *   **Trending:** Use this only for verifiable data feeds (e.g., charts, watch lists, screener results). Personal opinions about trends are 'not-relevant'.

3. Choose the single best category from the official list below.
4. Do not invent or modify any category name.
5. **not-relevant** (Use this aggressively as your primary filter)

Official Categories (choose exactly one):
"${Object.values(Category).join('", "')}"

Tagging Rules:
- Tags must be directly related to projects, tokens, or actionable concepts mentioned.
- Identify and list all relevant keywords or token symbols.
- Include tokens, projects, blockchains (e.g., Solana), and trending terms (e.g., "rug pull", "shill").
- Tags must be lowercase.
- If no relevant keywords are found, return an empty array.

Contract Address Rules:
- Detect any valid smart contract addresses for Solana or EVM chains.
- List all detected addresses in the "contracts" array.
- If no contract addresses are detected, return an empty array.

JSON schema must be strictly followed:
{
    "category": "One of the official categories, like 'Airdrop'",
    "tags": ["relevant", "keywords", "from", "tweet"],
    "contracts": [
        { "address": "valid_contract_address", "blockchain": "blockchain_name" },
        { "address": "another_valid_address", "blockchain": "another_blockchain" }
    ]
}
`;

/**
 * Classifies a tweet using Google Gemini AI. 
 * @param input ClassificationInput
 * @returns 
 */
export async function classifyTweet(input: ClassificationInput) {
    const { text, mediaUrl, mimeType } = input;
    const contentParts: { text?: string, inlineData?: { data: string, mimeType: string } }[] = [];
    const promptText = aiPrompt(text);
    contentParts.push({ text: promptText });

    if (mediaUrl && mimeType) {
        //console.log("Sending tweet with image for analysis.");
        let imageBase64 = '';
        try {
            imageBase64 = await urlToBase64(mediaUrl, mimeType);
        } catch (e) {
            //console.error("The image could not be obtained, proceeding only with the text.");
        }
        if (imageBase64) {
            contentParts.push({
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType,
                },
            });
        }
    } else {
       // console.log("Sending text-only tweet for analysis.");
    }

     if (!text && contentParts.length === 1) { // 1 because the prompt is always there
         return { category: "not-relevant", tags: [], contracts: [] };
    }

     try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: contentParts, 
            config: {
                responseMimeType: "application/json",
                responseSchema,
            },
        });

        const parsed = JSON.parse(response.text ?? '{"category":"not-relevant","tags":[],"contracts":[]}');
        return parsed;

    } catch (err) {
        console.error("AI classification failed:", err);
        return { category: "not-relevant", tags: [], contracts: [] };
    }
}

/**
 * Downloads an image from a URL and converts it to a Base64 string.
 * @param url Image URL
 * @param mimeType MIME type of the image (e.g., "image/png")
 * @returns Base64 encoded string of the image
 */
async function urlToBase64(url: string, mimeType: string): Promise<string> {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const arrayBuffer = response.data as ArrayBuffer;
        const buffer = Buffer.from(arrayBuffer);
        return buffer.toString('base64');
    } catch (e) {
        console.error(`Failed to fetch and encode image from URL: ${url}`);
        return ''; // Return empty string on failure
    }
}
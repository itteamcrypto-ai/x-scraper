// src/services/aiService.ts
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";
import axios from "axios";

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
You are a highly discerning **Crypto Signals Analyst AI**. Your primary goal is to **filter out noise** and only categorize tweets that offer **clear, actionable signals, major market insight, or a legitimate project update**.

Analyze the provided content (Text and/or Image Description) and categorize it based on the official list. Your response must be **strict JSON** and nothing else.


Content for Analysis:
"${text}"

Category Rules:
- **Filtering Priority:** If the content is vague, a generic motivational post, a simple and not relevant repost/mentions, or a simple price chart without commentary/signal, use **"not-relevant"**.
- Choose the single best category from the official list below.
- Do not invent or modify any category name.

Official Categories (choose exactly one):
- Trending
- Viral
- Airdrop
- Market Analysis
- Signals
- Launch Alerts
- Presale
- Crypto News
- Project Updates
- Governance
- PnL Sharing
- New Meme
- Contract Alert
- Listing
- Price Alert
- News
- Scam Warning
- Market Sentiment
- Giveaway
- NFT
- not-relevant

Tagging Rules:
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
import axios from "axios";
import "dotenv/config";

import { TweetsIA, EnrichedData } from "../models/TweetsIA.js";

const mainWebhook = process.env.DISCORD_POSTS_WEBHOOK!;
const alertsWebhook = process.env.DISCORD_ALERTS_WEBHOOK!;
const errorsWebhook = process.env.DISCORD_ERROR_WEBHOOK!;

/**
 * Send a message to Discord channel via webhook
 */
export async function sendToDiscord(
  channel: "general" | "alerts",
  tweet: any
) {
  try {
    const url = channel === "general" ? mainWebhook : alertsWebhook;
    const content = createDiscordEmbed(tweet)
    await axios.post(url, content).then(async (response) => {
      //console.log('Send to discord:', response.data);
      // const urlPost = process.env.POSTS_WEBHOOK!;
      // const urlAlerts = process.env.ALERTS_WEBHOOK!;
      // const urlResend = channel === "general" ? urlPost : urlAlerts;
      // await axios.post(urlResend, content)
    }).catch((error) => {
      console.log("sendToDiscord ~ error:", error);
    })
  } catch (err) {
    console.error("Failed to send message to Discord:", err);
  }
}

function createDiscordEmbed(tweet: TweetsIA) {
  let color = 5793266; // General color, example: blue
  let title = "New Tweet";
  const fields = [];

  switch (tweet.category) {
    case 'Scam Warning':
      color = 15548997; // Red 
      title = "🚨 SCAM WARNING 🚨";
      break;
    case 'Price Alert':
    case 'Signals':
    case 'Market Analysis':
    case 'Market Sentiment':
    case 'PnL Sharing':
    case 'Trending':
    case 'Viral':
      color = 16776960; // Yellow 
      title = `📈 ${tweet.category.toUpperCase()} 📈`;
      break;
    case 'Airdrop':
    case 'Giveaway':
    case 'Launch Alerts':
    case 'Presale':
    case 'Listing':
      color = 3066993; // Green 
      title = `💰 ${tweet.category.toUpperCase()} 💰`;
      break;
    case 'Contract Alert':
      color = 10181046; // Purple 
      title = `✍️ ${tweet.category.toUpperCase()} ✍️`;
      break;
    case 'New Meme':
    case 'NFT':
      color = 12903741; // Pink 
      title = `🖼️ ${tweet.category.toUpperCase()} 🖼️`;
      break;
    case 'Project Updates':
    case 'Governance':
    case 'Crypto News':
    case 'News':
      color = 5793266; // Blue 
      title = `📰 ${tweet.category.toUpperCase()} 📰`;
      break;
    default:
      color = 10038562; // Gray 
      title = "ℹ️ GENERAL INFO ℹ️";
      break;
  }

  // Category field
  fields.push({
    name: "Category",
    value: tweet.category,
    inline: true
  });

  // Tag field
  if (tweet.tags && tweet.tags.length > 0) {
    fields.push({
      name: "Tags",
      value: tweet.tags.map(tag => `#${tag}`).join(', '),
      inline: true
    });
  }

  // enriched fields for each contract
  if (tweet.enriched && tweet.enriched.length > 0) {
    tweet.enriched.forEach((enrichedData: EnrichedData) => {
      const dexscreenerUrl = `https://dexscreener.com/${enrichedData.blockchain?.toLowerCase()}/${enrichedData.address}`;
      const enrichedValue =
        `• **Price USD:** $${enrichedData.priceUsd?.toFixed(8) || 'N/A'}\n` +
        `• **Liquidity:** $${(enrichedData?.liquidity || 0 / 1000000)?.toFixed(2) || 'N/A'}M\n` +
        `• **Volume (24h):** $${(enrichedData?.volume24h || 0 / 1000000)?.toFixed(2) || 'N/A'}M\n` +
        `• **FDV:** $${(enrichedData.fdv || 0 / 1000000)?.toFixed(2) || 'N/A'}M\n` +
        `\n[View on DexScreener](${dexscreenerUrl})`;

      fields.push({
        name: `Token Data: ${enrichedData.tokenSymbol || 'N/A'}`,
        value: enrichedValue,
        inline: false
      });
    });
  }

  // Logic image/video
  const imageUrl = tweet.mediaUrl ? tweet.mediaUrl : null;
  const imageField = imageUrl ? { url: imageUrl } : null;

  let authorName = `@${tweet.username}`; 

  if (tweet.scrapedFor === 'mention') {
    const targetUser = tweet.tweetId.split('/')[1]; 
    authorName = `👤 ${targetUser} (Mention or replie for @${tweet.username})`; 
  }

  const embed = {
    embeds: [
      {
        author: {
          name: authorName,
          url: `https://x.com${tweet.tweetId}`
        },
        title: title,
        description: tweet.text,
        url: `https://x.com${tweet.tweetId}`,
        color: color,
        fields: fields,
        image: imageField,
        footer: {
          text: `Link Tweet: https://x.com${tweet.tweetId}`
        },
        timestamp: tweet.timestamp,
      }
    ]
  };

  return embed;
}

export async function sendErrorChannel(
  text: any) {
  try {
    const url = errorsWebhook;
    const payload = {
      content: text,
    };
    await axios.post(url, payload).then((response) => {
      //console.log('Send to discord response:', response.data);
    }).catch((error) => {
      console.log("sendToDiscord ~ error:", error);
    })
    console.log(`Sent message to Discord Channel Error`);
  } catch (err) {
    console.error("Failed to send message sendErrorChannel:", err);
  }
}
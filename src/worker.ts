// src/worker.ts
// Uses Puppeteer for browser automation and Mongoose for MongoDB interactions.
// Processes tweets and mentions, classifies them with AI, enriches data, and sends relevant info to Discord channels.
// Handles errors and retries to ensure continuous operation.
import "dotenv/config";
import { classifyTweet } from "./services/aiService.js";
import TweetsIA from "./models//TweetsIA.js";
import User from "./models/User.js";
import Post from "./models/Post.js";
import { Tweet, ErrorMsg, setupBrowser, handleLogin, scrapeFeedFollowing, Credentials, readCredentials } from "./scraper.js";
import { getTokenDataFromDexScreener } from "./utils/getDataDexScreener.js"
import pLimit from "p-limit";
import { sendToDiscord } from "./services/discordService.js";
import { Browser, Page } from "puppeteer";


interface EnrichedData {
    address: string;
    tokenSymbol?: string;
    priceUsd?: number;
    fdv?: number;
    liquidity?: number;
    volume24h?: number;
    blockchain?: string;
}

enum Category {
    Trending = 'Trending',
    Viral = 'Viral',
    Airdrop = 'Airdrop',
    MarketAnalysis = 'Market Analysis',
    Signals = 'Signals',
    LaunchAlerts = 'Launch Alerts',
    Presale = 'Presale',
    CryptoNews = 'Crypto News',
    ProjectUpdates = 'Project Updates',
    Governance = 'Governance',
    PnLSharing = 'PnL Sharing',
    NewMeme = 'New Meme',
    ContractAlert = 'Contract Alert',
    Listing = 'Listing',
    PriceAlert = 'Price Alert',
    News = 'News',
    ScamWarning = 'Scam Warning',
    MarketSentiment = 'Market Sentiment',
    Giveaway = 'Giveaway',
    NFT = 'NFT',
    NotRelevant = 'not-relevant'
}

const AI_CALL_INTERVAL = 6000; // 6 seconds
const aiLimiter = pLimit(1); // Allows only one call at a time
let lastAICallTime = 0;

// -------------------- Config --------------------
const AI_TIMEOUT_MS = 15000; // 15s
let isLoggingIn = false;
let currentCredentials: Credentials | null = null;

async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 2000 // 2s initial
): Promise<T> {
    try {
        return await fn();
    } catch (err: any) {
        if (retries > 0 && err?.status === 503) {
            console.warn(`Gemini IA overloaded. Retrying in ${delay / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            return retryWithBackoff(fn, retries - 1, delay * 2); // backoff
        }
        throw err; // another error or no retries → we let it fail
    }
}


// -------------------- Helper: promise with timeout --------------------

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(fallback), ms);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
}

// -------------------- Process a single tweet --------------------
async function processTweet(t: Tweet) {
    try {
        const exists = await Post.findOne({ tweetId: t.url });
        if (exists) return;
        // Save raw tweet
        const post = new Post({
            tweetId: t.url,
            username: t.username,
            text: t.text,
            timestamp: new Date(t?.timestamp ? t.timestamp : Date.now()),
            mediaUrl: t.mediaUrl,
            scrapedFor: t.scrapedFor === undefined || t.scrapedFor === null ? 'feed' : t.scrapedFor // Default to 'feed' if undefined or null,
        });
        await post.save();
        const now = Date.now();
        const timeToWait = Math.max(0, lastAICallTime + AI_CALL_INTERVAL - now);
        if (timeToWait > 0) {
            //console.log(`Waiting ${timeToWait / 1000}s to avoid AI rate limit...`);
            await new Promise(resolve => setTimeout(resolve, timeToWait));
        }
        lastAICallTime = Date.now();

        //No allow img tweets, ask first
        // if (!t.text || t.text == '') {
        //     return
        // }

        const analysis = await aiLimiter(() =>
            withTimeout(
                retryWithBackoff(() => classifyTweet({
                    text: post.text || '',
                    mediaUrl: post.mediaUrl,
                    mimeType: 'image/jpeg',
                })),
                20000,
                { category: "error", tags: [], contracts: [] }
            )
        );
        if (analysis.category !== 'error') {
            const enrichedDataArray: EnrichedData[] = [];
            // If the AI found contracts, iterate over them
            if (analysis.contracts && analysis.contracts.length > 0) {
                for (const contract of analysis.contracts) {
                    const tokenData = await getTokenDataFromDexScreener(contract.address);
                    if (tokenData) {
                        //Create a new enriched data object for this contract
                        const enrichedData: EnrichedData = {
                            address: contract.address, // Save the contract address
                            tokenSymbol: tokenData.baseToken.symbol,
                            priceUsd: tokenData.priceUsd ? parseFloat(tokenData.priceUsd) : undefined,
                            fdv: tokenData.fdv,
                            liquidity: tokenData.liquidity?.usd,
                            volume24h: tokenData.volume.h24,
                            blockchain: contract.blockchain
                        };
                        enrichedDataArray.push(enrichedData);
                        //console.log(`Data enriched for token ${enrichedData.tokenSymbol}.`);
                    }
                }
            }
            if (analysis?.category == 'not-relevant') {
                await Post.findOneAndUpdate({ tweetId: t.url }, { status: 'discarded' }, { new: true });
                return;
            } else {
                const dtoTweetIA = {
                    tweetId: t.url,
                    username: t.username,
                    text: t.text,
                    timestamp: new Date(t.timestamp ? t.timestamp : Date.now()),
                    category: analysis.category,
                    tags: analysis.tags,
                    contracts: analysis.contracts,
                    enriched: enrichedDataArray,
                    mediaUrl: t.mediaUrl
                };
                // Switch Discord Channels
                switch (analysis.category) {
                    case Category.Airdrop:
                    case Category.LaunchAlerts:
                    case Category.Presale:
                    case Category.ContractAlert:
                    case Category.Listing:
                    case Category.PriceAlert:
                    case Category.ScamWarning:
                    case Category.Giveaway:
                    case Category.Signals:
                    case Category.PnLSharing:
                        await sendToDiscord('alerts', dtoTweetIA);
                        break;
                    case Category.NotRelevant:
                        // Don't send to Discord, just update the DB status
                        await Post.findOneAndUpdate({ tweetId: t.url }, { status: 'discarded' }, { new: true });
                        // console.log(`Tweet from @${dtoTweetIA.username} was not relevant and has been discarded.`);
                        return; // Exit the function to prevent further processing
                    case Category.Viral:
                    case Category.Trending:
                    case Category.NewMeme:
                    case Category.NFT:
                    case Category.MarketAnalysis:
                    case Category.MarketSentiment:
                    case Category.CryptoNews:
                    case Category.News:
                    case Category.ProjectUpdates:
                    case Category.Governance:
                    default:
                        // All other categories, including the default, go to the general channel.
                        if (analysis.category !== Category.NotRelevant) {
                            await sendToDiscord('general', dtoTweetIA);
                        }
                        break;
                }
                // Save & update Tweets and IA analysis
                try {
                    const tweetIA = new TweetsIA(dtoTweetIA);
                    await tweetIA.save();
                    await Post.findOneAndUpdate({ tweetId: t.url }, { status: 'processed' }, { new: true });
                    // console.log(`New Tweet IA saved @${dtoTweetIA.username}`);
                } catch (error) {
                    console.error("Error saving the tweet to the database:", error);
                }
            }
        } else if (analysis.category === 'error') {
            console.log("Error classifying tweet whit IA", t.url);
            await Post.findOneAndUpdate({ tweetId: t.url }, { status: 'unprocessed' }, { new: true })
        }
    } catch (err) {
        console.error("Error processing tweet:", err);
    }
}

// -------------------- Process a single user --------------------
export async function scrapeUserTweets(page: Page, username: string) {
    console.log(`[-------- @${username}] Checking tweets...`);
    const limit = 5;
    try {
        try {
            await page.goto(`https://x.com/${username}`, { waitUntil: "domcontentloaded", timeout: 120000 });
            const randomDelay = getRandomDelay(4000, 8000);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        } catch (error) {
            console.log("scrapeUserTweets page.goto error:", error);
            return { error: true, message: `got to x.com/${username} failed scrapeUserTweets` };
        }
        await page.waitForSelector('article', { timeout: 40000 });
        // --- Smooth scroll logic ---
        let previousTweetCount = 0;
        let currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
        let scrollAttempts = 0;
        const maxScrollAttempts = 10;
        while (currentTweetCount < 20 && scrollAttempts < maxScrollAttempts) {
            previousTweetCount = currentTweetCount;
            // Smooth scroll by 600px with a small delay
            await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
            await new Promise(resolve => setTimeout(resolve, getRandomDelay(800, 1200)));
            currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
            if (currentTweetCount === previousTweetCount) {
                // Try a couple more times before breaking
                let stagnantTries = 0;
                while (stagnantTries < 2 && currentTweetCount === previousTweetCount) {
                    await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
                    await new Promise(resolve => setTimeout(resolve, getRandomDelay(800, 1200)));
                    currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
                    stagnantTries++;
                }
                if (currentTweetCount === previousTweetCount) {
                    //console.log('No new tweets loaded. Breaking scroll loop.');
                    break;
                }
            }
            scrollAttempts++;
        }
        await new Promise(resolve => setTimeout(resolve, getRandomDelay(1000, 2000)));
        // Evaluate page and context
        const tweets: Tweet[] | ErrorMsg = await page.evaluate(
            (username, limit) => {
                const articles = Array.from(document.querySelectorAll("article")).filter(
                    (article) => {
                        const isPinned = Array.from(article.querySelectorAll('div')).some(
                            (div) => div.textContent?.includes('Fijado') || div.textContent?.includes('Pinned')
                        );
                        return !isPinned;
                    }
                );
                if (!articles.length) {
                    return {
                        error: true,
                        message: `Cannot find tweets for username: ${username}`,
                    };
                } else {
                    console.log('articles tweets length', articles.length + ' ', username);
                }
                const result = articles
                    .slice(0, limit)
                    .map((article) => {
                        const textEl = article.querySelector("div[lang]");
                        const text = textEl?.textContent?.trim() || "";
                        if (!text) return null;
                        const timeEl = article.querySelector("time");
                        const timestamp = timeEl?.getAttribute("datetime") || "";
                        const link = timeEl?.parentElement?.getAttribute("href") || "";
                        const url = link;
                        let mediaUrl: string | null = null;
                        const videoElement = article.querySelector('div[data-testid="videoComponent"] video');
                        const imageElement = article.querySelector('div[data-testid="tweetPhoto"] img');
                        if (videoElement) {
                            // mediaUrl = videoElement.getAttribute('src');
                        } else if (imageElement) {
                            mediaUrl = imageElement.getAttribute('src');
                        }
                        return { text, timestamp, url, mediaUrl, username };
                    })
                    .filter(t => t !== null) as Tweet[];
                return result;
            },
            username,
            limit
        );
        return tweets;
    } catch (err: any) {
        console.error(`Fatal error in scrapeUserTweets: ${err.message}`);
        return { error: true, message: `Scraping error: ${err.message}` };
    }
}

// Function dedicated to searching for mentions
export async function scrapeMentions(page: Page, username: string) {
    const limit = 5;
    try {
        const searchUrl = `https://x.com/search?q=${encodeURIComponent('@' + username)}&f=live`;
        try {
            await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
            const randomDelay = getRandomDelay(4000, 8000);
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        } catch (error) {
            console.log("scrapeMentions page.goto error:", error);
            return { error: true, message: `Could not reach search mentions for @${username}.` };
        }

        await page.waitForSelector('article', { timeout: 60000 });

        // --- Smooth scroll logic ---
        let previousTweetCount = 0;
        let currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
        let scrollAttempts = 0;
        const maxScrollAttempts = 10;
        while (currentTweetCount < 20 && scrollAttempts < maxScrollAttempts) {
            previousTweetCount = currentTweetCount;
            // Smooth scroll by 600px with a small delay
            await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
            await new Promise(resolve => setTimeout(resolve, getRandomDelay(800, 1200)));
            currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
            if (currentTweetCount === previousTweetCount) {
                // Try a couple more times before breaking
                let stagnantTries = 0;
                while (stagnantTries < 2 && currentTweetCount === previousTweetCount) {
                    await page.evaluate(() => window.scrollBy({ top: 600, behavior: 'smooth' }));
                    await new Promise(resolve => setTimeout(resolve, getRandomDelay(800, 1200)));
                    currentTweetCount = await page.evaluate(() => document.querySelectorAll('article').length);
                    stagnantTries++;
                }
                if (currentTweetCount === previousTweetCount) {
                    //console.log('No new tweets loaded. Breaking scroll loop.');
                    break;
                }
            }
            scrollAttempts++;
        }

        await new Promise(resolve => setTimeout(resolve, getRandomDelay(1000, 2000)));
        const tweets: Tweet[] | ErrorMsg = await page.evaluate(
            (username, limit) => {
                const articles = Array.from(document.querySelectorAll("article"));
                if (!articles.length) {
                    return {
                        error: true,
                        message: `Cannot find tweets for search query: ${username}`,
                    };
                }
                const result = articles
                    .slice(0, limit)
                    .map((article) => {
                        const textEl = article.querySelector("div[lang]");
                        const text = textEl?.textContent?.trim() || "";
                        if (!text) return null;
                        const timeEl = article.querySelector("time");
                        const timestamp = timeEl?.getAttribute("datetime") || "";
                        const link = timeEl?.parentElement?.getAttribute("href") || "";
                        const url = link ? link : "";
                        let mediaUrl: string | null = null;
                        const videoElement = article.querySelector('div[data-testid="videoComponent"] video');
                        const imageElement = article.querySelector('div[data-testid="tweetPhoto"] img');
                        if (videoElement) {
                            // mediaUrl = videoElement.getAttribute('src');
                        } else if (imageElement) {
                            mediaUrl = imageElement.getAttribute('src');
                        }
                        return { text, timestamp, url, mediaUrl, username };
                    })
                    .filter(t => t !== null) as Tweet[];
                return result;
            },
            username,
            limit
        );
        return tweets;
    } catch (err: any) {
        return { error: true, message: `Scraping error: ${err.message}` };
    }
}

/**
 * @description Scrapes and processes tweets and mentions for a user.
 * @param browser 
 * @param user { username: string }
 */
export async function processUserAndMentions(browser: Browser, user: { username: string }) {
    //console.log(`[--------- @${user.username}] Starting full scrape and process cycle...`);
    let page: Page | null = null;
    //const startTime = Date.now();
    try {
        // Open a single page for both processes.
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        // Get and processes tweets from the profile
        const userTweets = await scrapeUserTweets(page, user.username);
        if (!('error' in userTweets)) {
            //console.log(`Scraped ${userTweets.length} tweets from @${user.username}'s profile.`);
            for (const tweet of userTweets) {
                tweet.scrapedFor = 'profile'; // Mark as profile tweet
                await processTweet(tweet);
            }
        }
        // Get and processes mentions
        const userMentions = await scrapeMentions(page, user.username);
        if (!('error' in userMentions)) {
            //console.log(`Scraped ${userMentions.length} mentions for @${user.username}.`);
            for (const tweet of userMentions) {
                tweet.scrapedFor = 'mention'; // Mark as mention tweet
                await processTweet(tweet);
            }
        }
        // console.log(`[--------- @${user.username}] All cycles finished successfully.`);
    } catch (error) {
        console.error(`Fatal error during full scrape and process cycle for @${user.username}:`, error);
    } finally {
        //const duration = (Date.now() - startTime) / 1000;
        //console.log(`[--------- @${user.username}] All cycles finished in ${duration.toFixed(2)} seconds. Closing page.`);
        retryFailedAI(5)
        if (page) {
            await page.close(); // Close the page ONCE both processes are complete.
        }
    }
}

// -------------------- Retry AI for failed tweets --------------------




async function retryFailedAI(limit: number) {
    const pending = await Post.find({ status: "unprocessed" }).limit(limit);
    for (const t of pending) {
        console.log(`Retrying AI for tweet: ${t.tweetId}`);
        try {
            const analysis = await withTimeout(
                classifyTweet({
                    text: t.text || '', // Always send the text (it can be empty string)  
                    mediaUrl: t.mediaUrl, // Send url
                    mimeType: 'image/jpeg',
                }),
                AI_TIMEOUT_MS,
                { category: "error", tags: [], contracts: [] }
            );

            if (analysis.category !== 'error') {
                const enrichedDataArray: EnrichedData[] = [];
                // If the AI found contracts, iterate over them
                if (analysis.contracts && analysis.contracts.length > 0) {
                    for (const contract of analysis.contracts) {
                        const tokenData = await getTokenDataFromDexScreener(contract.address);
                        if (tokenData) {
                            //Create a new enriched data object for this contract
                            const enrichedData: EnrichedData = {
                                address: contract.address, // Save the contract address
                                tokenSymbol: tokenData.baseToken.symbol,
                                priceUsd: tokenData.priceUsd ? parseFloat(tokenData.priceUsd) : undefined,
                                fdv: tokenData.fdv,
                                liquidity: tokenData.liquidity?.usd,
                                volume24h: tokenData.volume.h24,
                                blockchain: contract.blockchain
                            };
                            enrichedDataArray.push(enrichedData);
                            //console.log(`Data enriched for token ${enrichedData.tokenSymbol}.`);
                        }
                    }
                }
                if (analysis?.category == 'not-relevant') {
                    await Post.findOneAndUpdate({ tweetId: t.tweetId }, { status: 'discarded' }, { new: true });
                    return;
                } else {
                    const dtoTweetIA = {
                        tweetId: t.tweetId,
                        username: t.username,
                        text: t.text,
                        timestamp: new Date(t.timestamp ? t.timestamp : Date.now()),
                        category: analysis.category,
                        tags: analysis.tags,
                        contracts: analysis.contracts,
                        enriched: enrichedDataArray,
                        mediaUrl: t.mediaUrl
                    };
                    // Switch Discord Channels
                    switch (analysis.category) {
                        case Category.Airdrop:
                        case Category.LaunchAlerts:
                        case Category.Presale:
                        case Category.ContractAlert:
                        case Category.Listing:
                        case Category.PriceAlert:
                        case Category.ScamWarning:
                        case Category.Giveaway:
                        case Category.Signals:
                        case Category.PnLSharing:
                            await sendToDiscord('alerts', dtoTweetIA);
                            break;
                        case Category.NotRelevant:
                            // Don't send to Discord, just update the DB status
                            await Post.findOneAndUpdate({ tweetId: t.tweetId }, { status: 'discarded' }, { new: true });
                            // console.log(`Tweet from @${dtoTweetIA.username} was not relevant and has been discarded.`);
                            return; // Exit the function to prevent further processing
                        case Category.Viral:
                        case Category.Trending:
                        case Category.NewMeme:
                        case Category.NFT:
                        case Category.MarketAnalysis:
                        case Category.MarketSentiment:
                        case Category.CryptoNews:
                        case Category.News:
                        case Category.ProjectUpdates:
                        case Category.Governance:
                        default:
                            // All other categories, including the default, go to the general channel.
                            if (analysis.category !== Category.NotRelevant) {
                                await sendToDiscord('general', dtoTweetIA);
                            }
                            break;
                    }
                    // Save & update Tweets and IA analysis
                    try {
                        const tweetIA = new TweetsIA(dtoTweetIA);
                        await tweetIA.save();
                        await Post.findOneAndUpdate({ tweetId: t.tweetId }, { status: 'processed' }, { new: true });
                        // console.log(`New Tweet IA saved @${dtoTweetIA.username}`);
                    } catch (error) {
                        console.error("Error saving the tweet to the database:", error);
                    }
                }
            }
        } catch (err) {
            console.error("Retry AI failed:", t.tweetId, err);
        }
    }
}


// -------------------- Estado Global del Worker --------------------
let browserInstance: Browser | null = null;
/**
 * Launch a browser, inject credentials, and verify the session.
 * Return true if the session is valid, otherwise return false.
 */
async function checkAndInjectCredentials(browser: Browser, credentials: Credentials | null): Promise<boolean | string> {
    if (!credentials) {
        console.warn("No credentials to check.");
        return false;
    }
    try {
        const page = await browser.newPage();
        // Inject session cookies (auth_token and ct0)
        const client = await page.createCDPSession();
        await client.send('Network.setCookies', {
            cookies: [
                { name: "auth_token", value: credentials.auth_token, domain: ".x.com", secure: true, httpOnly: true },
                { name: "ct0", value: credentials.ct0, domain: ".x.com", secure: true }
            ]
        });
        // Inject the bearer token into requests
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            if (request.url().includes('/graphql')) {
                const headers = request.headers();
                headers['authorization'] = `Bearer ${credentials.bearer_token}`;
                headers['x-csrf-token'] = credentials.ct0;
                request.continue({ headers });
            } else {
                request.continue();
            }
        });
        // Verify that the session is valid by navigating to the home page.
        await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 6000));
        const loggedOut = await page.$('a[href*="/i/flow/login"]');
        const subscribeButton = await page.$('a[href="/i/twitter_blue_sign_up"]');
        if (subscribeButton) {
            console.error('Authentication failed: X is asking to subscribe to Premium. Please update your account credentials.');
            await browser.close();
            return 'premium'
        }
        const scrollDuration = 6000;
        const startTime = Date.now();
        const scrollInterval = setInterval(async () => {
            if (page && Date.now() - startTime < scrollDuration) {
                await page.evaluate(() => window.scrollBy(0, 150));
            } else {
                clearInterval(scrollInterval);
            }
        }, 500);
        await new Promise(resolve => setTimeout(resolve, scrollDuration + 1000));
        await page.close();
        await page.setRequestInterception(false);
        if (loggedOut) {
            console.log("Session check failed. Credentials are old or invalid.");
            return false;
        } else {
            // console.log("Session check successful. Credentials are still valid.");
            return true;
        }
    } catch (error) {
        console.error("Error during credentials injection or session check:", error);
        return false;
    }
}

function getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function setupPersistentBrowser(): Promise<Browser | 'premium' | null> {
    if (isLoggingIn) {
        console.log("An authentication process is already running. Skipping.");
        // throw new Error("Login process already in progress.");
        return null
    }
    isLoggingIn = true;
    try {
        // STEP 1: Read the credentials from the file.
        try {
            currentCredentials = await readCredentials();
            if (currentCredentials?.auth_token === '' || !currentCredentials?.auth_token) {
                currentCredentials = null
            }
        } catch (err) {
            console.warn("Credentials file not found or corrupted. Will perform a full login.");
            currentCredentials = null;
        }
        // STEP 2: If there is no browser instance, we create one.
        if (!browserInstance) {
            browserInstance = await setupBrowser();
        }
        // STEP 3: Try using the saved credentials.
        const sessionIsValid = await checkAndInjectCredentials(browserInstance, currentCredentials);
        // STEP 4: If the credentials are invalid, we perform a full login.
        if (!sessionIsValid) {
            console.log("Session invalid or expired. Initiating full login...");
            // Close the current instance to ensure a clean start
            if (browserInstance) await browserInstance.close();
            browserInstance = await setupBrowser();
            const { credentials, page } = await handleLogin(browserInstance);
            currentCredentials = credentials
        } else if (sessionIsValid === 'premium') {
            return sessionIsValid
        }
        return browserInstance;
    } catch (error) {
        console.error("Failed to complete setup process.", error);
        if (browserInstance) await browserInstance.close();
        browserInstance = null;
        currentCredentials = null;
        throw new Error("Could not set up browser instance or login.");
    } finally {
        isLoggingIn = false;
    }
}

export async function getAllUsersFromDb(): Promise<{ username: string }[]> {
    try {
        const users = await User.find({}).sort({ _id: 1 });
        const usersL = users.map(u => ({ username: u.username }));
        return usersL;
    } catch (error) {
        console.log("Error fetching users from DB:", error);
        return [];
    }
}

// -------------------- Bucle Principal (runWorker) --------------------
export async function runWorker(browserInstance: Browser) {
    let notificationsPage: Page | null = null;
    try {
        console.log('Working...')
        notificationsPage = await browserInstance.newPage();
        await notificationsPage.goto('https://x.com/notifications', { waitUntil: 'domcontentloaded' });
        const randomDelay = getRandomDelay(4000, 8000); // Milisegundos
        await new Promise(resolve => setTimeout(resolve, randomDelay));
        // Wait for the "Home" link to appear in the sidebar
        const homeLinkSelector = 'a[href="/home"]';
        await notificationsPage.waitForSelector(homeLinkSelector, { timeout: 15000 });
        // Click the "Home" link to navigate
        await notificationsPage.click(homeLinkSelector);
        // Wait for the navigation to complete to the Home page
        await Promise.all([
            // The click action
            notificationsPage.click(homeLinkSelector),
            // The wait action: wait for a selector that's specific to the Home page feed
            notificationsPage.waitForSelector('[data-testid="primaryColumn"]', { timeout: 15000 })
        ]);
        //console.log("Successfully navigated to Home page via click.");
        while (true) {

            // console.log("-----------------------------------------");
            // console.log("Starting a new scraper cycle...");

            // Obtiene todos los IDs de tweets existentes en la base de datos de manera eficiente
            const tweetsDB = new Set((await Post.find({})).map(p => p.tweetId));
            // Ejecuta el ciclo de scraping para obtener los tweets del feed
            const tweetsFromFeed = await scrapeFeedFollowing(notificationsPage);
            // Filtra los tweets para encontrar solo los que no están en la base de datos
            const uniqueNewTweets = tweetsFromFeed.filter(tweet => {
                const tweetUrl = tweet.url;
                return tweetUrl && !tweetsDB.has(tweetUrl);
            });
            if (uniqueNewTweets.length > 0) {
                // Valida los tweets únicos para asegurar que tienen los datos esenciales
                const validNewTweets = uniqueNewTweets.filter(t =>
                    t.username && (t.text || t.mediaUrl) && t.url && t.timestamp
                );
                // Procesa solo los tweets nuevos y válidos
                for (const tweet of validNewTweets) {
                    await processTweet(tweet);
                }
            } else {
                //console.log("No new tweets found to process in this cycle.");
            }
        }
    } catch (err) {
        // Close the page to clean up the browser's context
        if (notificationsPage) {
            try { await notificationsPage.close(); } catch (e) { }
        }
        console.error("Fatal error in runWorker. Propagating to startWorker for browser reset.", err);
        // Re-throw the error to be caught by startWorker's catch block
        throw err;
    }
}

import puppeteer from "puppeteer";
import "dotenv/config";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from 'url';

// -------------------- Types --------------------

export interface Tweet {
    username?: string | null;
    text?: string | null;
    url?: string | null;
    timestamp?: string | null;
    mediaUrl?: string | null;
    scrapedFor?: 'profile' | 'mention' | 'feed' | null;
}

export interface ErrorMsg {
    error: boolean;
    message: string;
}

export interface Credentials {
    auth_token: string;
    ct0: string;
    bearer_token: string;
}

// -------------------- File Path --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CREDENTIALS_FILE_PATH = path.join(__dirname, "config", "credentials.json");

// -------------------- Helper Functions --------------------
/**
 * Reads the credentials from the credentials.json file.
 * Returns null if the file does not exist.
 */
export async function readCredentials(): Promise<Credentials | null> {
    try {
        const data = await fs.readFile(CREDENTIALS_FILE_PATH, "utf-8");
        return JSON.parse(data);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log("Credentials file not found. An initial login will be attempted.");
        } else {
            console.error("Error reading credentials file:", error);
        }
        return null;
    }
}

/**
 * Writes the new credentials to the credentials.json file.
 */
async function writeCredentials(credentials: Credentials): Promise<void> {
    try {
        await fs.mkdir(path.dirname(CREDENTIALS_FILE_PATH), { recursive: true });
        await fs.writeFile(CREDENTIALS_FILE_PATH, JSON.stringify(credentials, null, 2));
        console.log("New credentials have been saved to credentials.json.");
    } catch (error) {
        console.error("Error writing credentials file:", error);
    }
}

/**
 * Handles the automatic login process to get fresh cookies and tokens.
 * This function is now fully independent and manages its own browser instance.
 */
export async function handleLogin(browser: puppeteer.Browser) {
    console.log("Initiating automatic login to get fresh credentials...");
    let newBearerToken: string | null = null;
    let newAuthToken: string | undefined;
    let newCt0: string | undefined;
    let page: puppeteer.Page | null = null;
    try {
        page = await browser.newPage();
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
        });
        await page.goto("https://x.com/i/flow/login?lang=en", { waitUntil: "domcontentloaded" });
        await page.waitForSelector('input[name="text"]', { timeout: 25000 });
        //console.log("Typing username...");
        await page.type('input[name="text"]', process.env.X_USERNAME!, { delay: 50 });
        await page.keyboard.press("Enter");
        await page.waitForSelector('input[name="password"]', { timeout: 25000 });
        //console.log("Typing password...");
        await page.type('input[name="password"]', process.env.X_PASSWORD!, { delay: 50 });
        await page.keyboard.press("Enter");
        await page.waitForNavigation({ waitUntil: "domcontentloaded" });
        //console.log("Logged in and navigated to home page.");
        // --- Step 1: Obtain the auth_token and ct0 cookies  ---
        const client = await page.createCDPSession();
        const cookies = (await client.send('Network.getAllCookies')).cookies;
        newAuthToken = cookies.find(c => c.name === "auth_token")?.value;
        newCt0 = cookies.find(c => c.name === "ct0")?.value;
        // --- Step 2: Intercept RESPONSES to capture the Bearer Token ---
        const bearerTokenPromise = new Promise<string | null>((resolve) => {
            const responseListener = async (response: puppeteer.HTTPResponse) => {
                const url = response.url();
                const headers = response.request().headers();
                // We look for requests that go to GraphQL and contain the authorization header.
                if (url.includes('/graphql') && headers['authorization'] && headers['authorization'].startsWith('Bearer ')) {
                    const token = headers['authorization'].replace('Bearer ', '');
                    console.log(`🎉 Bearer Token Captured from URL: ${url}`);
                    newBearerToken = token;
                    page?.off('response', responseListener); // Deactivate the listener once we have the token
                    resolve(token);
                }
            };
            page?.on('response', responseListener);
            // Timeout to prevent the promise from hanging if the token is not found
            setTimeout(() => {
                if (!newBearerToken) {
                    console.warn("Bearer Token not captured within 20 seconds.");
                    page?.off('response', responseListener);
                    resolve(null);
                }
            }, 20000); // 20 seconds to capture the token
        });
        // After login, X automatically loads the feed, which should trigger GraphQL requests.
        // We will simulate a small scroll to force more network activity and give the listener time.
        console.log("Simulating a small scroll to trigger network activity...");
        await page.evaluate(() => window.scrollBy(0, 300));
        await new Promise(resolve => setTimeout(resolve, 3000));
        newBearerToken = await bearerTokenPromise;
        if (!newAuthToken || !newCt0 || !newBearerToken) {
            console.error("Missing credentials after attempt:", {
                newAuthToken: !!newAuthToken,
                newCt0: !!newCt0,
                newBearerToken: !!newBearerToken
            });
            throw new Error("Failed to extract all required credentials after login.");
        }
        const newCredentials = { auth_token: newAuthToken, ct0: newCt0, bearer_token: newBearerToken };
        await writeCredentials(newCredentials);
        console.log("Login successful. New credentials saved.");
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
        return { credentials: newCredentials, page };
    } catch (loginErr) {
        console.error("Login process failed:", loginErr);
        if (page) {
            try {
                await page.close();
            } catch (closeErr) {
                console.error("Error closing page in error handler:", closeErr);
            }
        }
        throw new Error("Login failed, cannot get new credentials.");

    }
}

export async function setupBrowser(): Promise<puppeteer.Browser> {
    const browserInstance = await puppeteer.launch({ headless: "shell", timeout: 300000 , protocolTimeout: 300000, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"], });
    return browserInstance
}

function getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function slowScroll(page: puppeteer.Page, scrollCount: number) {
    for (let i = 0; i < scrollCount; i++) {
        const scrollDistance = getRandomDelay(300, 800);
        await page.evaluate(distance => window.scrollBy(0, distance), scrollDistance);
        // Wait for a random pause for the content to load
        const waitTime = getRandomDelay(1500, 3000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
}

// -------------------- Scrape Following Feed --------------------
export async function scrapeFeedFollowing(page: puppeteer.Page) {
    try {
        // 1. Find all links that go to /home.
        const homeLinks = await page.$$('a[href="/home"]');
        let followingTab = null;
        // 2. Iterate over each link to find the one with the text “Following.”
        for (const link of homeLinks) {
            const textContent = await page.evaluate(el => el.textContent, link);
            if (textContent.trim() === 'Following') {
                followingTab = link;
                break;
            }
        }
        if (followingTab) {
            await Promise.all([
                followingTab.click(),
                page.waitForSelector('[data-testid="primaryColumn"]', { timeout: 25000 })
            ]);
        } else {
            console.warn("Could not find 'Following' tab. Scraping from default feed.");
        }
    } catch (err) {
        console.error("Error clicking on 'Following' tab:", err);
    }
    // --- 3. Simulate multiple scrolls to load more posts ---
    // We use the new feature to make 3-5 slow, random scrolls.
    await slowScroll(page, getRandomDelay(3, 5));
    // --- 4. Extract visible tweets from the feed ---
    const tweetsFromFeed = await page.evaluate(() => {
        const articleElements = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        return articleElements.map(el => {
            const usernameLink = el.querySelector('[data-testid="User-Name"] a[href^="/"]');
            const usernUrl = usernameLink?.getAttribute('href') || null;
            const username = usernUrl ? usernUrl.slice(1) : null;
            const textEl = el.querySelector('[data-testid="tweetText"]');
            const timeEl = el.querySelector("time");
            const text = textEl?.textContent?.trim() || null;
            const link = timeEl?.parentElement?.getAttribute("href") || null;
            const url = link;
            const timestamp = timeEl?.getAttribute('datetime') || null;
            let mediaUrl = null;
            const videoElement = el.querySelector('div[data-testid="videoComponent"] video');
            const imageElement = el.querySelector('div[data-testid="tweetPhoto"] img');
            if (videoElement) {
                mediaUrl = videoElement.getAttribute('src');
            } else if (imageElement) {
                mediaUrl = imageElement.getAttribute('src');
            }
            return { username, text, url, timestamp, mediaUrl };
        });
    });

    // --- 5. Return to the beginning for the New posts button ---
    await page.evaluate(() => window.scrollTo(0, 0));
    const randomDelay = getRandomDelay(1000, 3000);
    await new Promise(resolve => setTimeout(resolve, randomDelay));


    // --- 6. Click on the “Show new posts” button if it appears. ---
    const showPostsButton = await page.waitForSelector('div[data-testid="pill-label"]', { timeout: 10000 }).catch(() => null);
    if (showPostsButton) {
        await showPostsButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for posts to load
    }
    const latestTweets = tweetsFromFeed.slice(0, 20);
    return latestTweets;
}

export async function checkNotifications(page: puppeteer.Page) {
    const unreadBadgeSelector = 'a[data-testid="AppTabBar_Notifications_Link"] [aria-label*="unread"]';
    const unreadBadge = await page.$(unreadBadgeSelector);
    if (!unreadBadge) {
        return null;
    }

    if (unreadBadge) {
        const notificationsPage = await page.browser().newPage();
        await notificationsPage.goto('https://x.com/notifications', { waitUntil: 'networkidle0' });
        // Slower scroll to capture more notifications
        for (let i = 0; i < 3; i++) {
            await notificationsPage.evaluate(() => window.scrollBy(0, window.innerHeight));
            await new Promise(resolve => setTimeout(resolve, 2000)); // Pause to allow content to load
        }
        const tweetsFromNotifications = await notificationsPage.evaluate(() => {
            const notificationElements = Array.from(document.querySelectorAll('article[data-testid="notification"]'));
            return notificationElements.map(el => {
                // Find the tweet link inside the notification article
                const tweetLinkElement = el.querySelector('a[href*="/status/"]');
                const url = tweetLinkElement ? `https://x.com${tweetLinkElement.getAttribute('href')}` : null;
                // Extract the username from the link in the notification text
                const usernameLinkElement = el.querySelector('a[role="link"][href^="/"]');
                const username = usernameLinkElement?.getAttribute('href')?.replace('/', '');
                // Get the full text of the notification, not just the tweet content
                const notificationText = el.querySelector('span.r-bcqeeo.r-1ttztb7')?.textContent?.trim() || '';
                // Get the timestamp
                const timestamp = el.querySelector('time')?.getAttribute('datetime');
                // Find the media URL (if any)
                let mediaUrl: string | null = null;
                const imageElement = el.querySelector('div[data-testid="tweetPhoto"] img');
                const videoElement = el.querySelector('div[data-testid="videoComponent"] video');
                if (imageElement) {
                    mediaUrl = imageElement.getAttribute('src');
                } else if (videoElement) {
                    mediaUrl = videoElement.getAttribute('src');
                }
                return {
                    username: username,
                    text: notificationText, // Use the notification text
                    url: url,
                    timestamp: timestamp,
                    mediaUrl: mediaUrl
                };
            }).filter(t => t.url !== null && t.url.includes('/status/')); // Filter out notifications that don't lead to a post
        });
        return { tweets: tweetsFromNotifications, notificationsPage }

    }
}
import axios from 'axios';
import {  sendErrorChannel } from "../services/discordService.js";

interface TokenInfo {
    address: string;
    name: string;
    symbol: string;
}

interface DexScreenerPair {
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: TokenInfo;
    quoteToken: TokenInfo;
    priceUsd?: string;
    liquidity?: {
        usd?: number;
    };
    volume: {
        h24: number;
    };
    fdv?: number;
}

interface DexScreenerAPIResponse {
    schemaVersion: string;
    pairs: DexScreenerPair[];
}

/**
 * Search for token data in the DexScreener API.
 */
export async function getTokenDataFromDexScreener(address: string): Promise<DexScreenerPair | null> {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    try {
        const response = await axios.get<DexScreenerAPIResponse>(url);
        const pairs = response.data.pairs;
        if (!pairs || pairs.length === 0) {
            await sendErrorChannel(`🗑️ **Contract Filtered:** No active pairs were found on DexScreener for address: \`${address}\`. (Likely low/zero liquidity or unlisted.)`);
            return null;
        }
        const bestPair = pairs.reduce((best: DexScreenerPair | null, current: DexScreenerPair) => {
            const currentLiquidity = current.liquidity?.usd || 0;
            const bestLiquidity = best?.liquidity?.usd || 0;
            if (currentLiquidity > bestLiquidity) {
                return current;
            }
            return best;
        }, null);
        return bestPair;
    } catch (error) {
        console.error(`Error obtaining data from DexScreener for ${address}:`, error);
        return null;
    }
}
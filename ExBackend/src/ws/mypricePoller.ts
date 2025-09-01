import { WebSocket } from "ws"; // WebSocket client
import * as dotenv from "dotenv";
import { createClient } from "redis";
import { uuKeyRedisQueue } from "./config";
dotenv.config();

//  Redis client (Step 1 for redis Client!)
const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
redis.on("error", (err) => console.error("Redis Client Error", err));

const symbols = ["btcusdt", "ethusdt", "solusdt"];
const streams = symbols.map((s) => `${s}@trade`).join("/");
const BINANCE_URL = `wss://stream.binance.com:9443/stream?streams=${streams}`;
const POLYGON_URL = `wss://socket.polygon.io/crypto`;
const POLYGON_KEY = process.env.POLYGON_KEY || "";
//Damnnn Polygon API is paid - need to get that 
interface PolygonCryptoResponse {
  status: string;
  symbol: string;
  last: {
    price: number;
    timestamp: number;
  };
}

//  Helper: topublish ticks to Redis Pub/Sub
async function publishTick(tick: any) {
  try {
    const subscriberCount = await redis.publish("ticks", JSON.stringify(tick)); // publish to channel "ticks"
    console.log("Published tick to Redis:", tick);
    console.log(`Published tick to Redis Pub/Sub. Subscribers: ${subscriberCount}`);
    await redis.rPush(uuKeyRedisQueue, JSON.stringify(tick));
  //   //@ts-ignore
  //   const tickStr = await redis.lindex(uuKeyRedisQueue, 0); // peek at first element
  //   if (tickStr) {
  // //@ts-ignore
  // console.log("First tick in queue:", JSON.parse(tickStr));
  // }
}catch (err) {
    console.error("Redis publish error:", err);
  }
}
//  Binance WS setup
function setupBinance() {
  const binanceWs = new WebSocket(BINANCE_URL);
  binanceWs.on("open", () => {
    console.log(`Connected to Binance WS (${symbols.join(", ")})`);
  });
  binanceWs.on("message", async (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      const data = parsed.data;
      const streamSymbol = parsed.stream.split("@")[0].toUpperCase();
      const tick = {
        ts: new Date(data.T).toISOString(), //timestamp
        assetId: streamSymbol, //symbol
        source: "BINANCE",
        price: parseFloat(data.p),
      };
      //can take quantity to show volume below 
      await publishTick(tick);
    } catch (err: any) {
      console.error("Error parsing binance tick:", err);
    }
  });
  binanceWs.on("close", () => {
    console.error("Binance WS Closed. Reconnecting in 5s..");
    setTimeout(setupBinance, 5000);
  });
  binanceWs.on("error", (err: any) => {
    console.error("Error connecting to Binance WS", err);
    binanceWs.close();
  });
}
export async function start() {
  await redis.connect();
  console.log("Redis connected");
  setupBinance();
  // Later  add: setupPolygon() etc stocks maybe
}


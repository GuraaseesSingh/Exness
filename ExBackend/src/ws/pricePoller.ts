//Need tO implement using kafka
// import { WebSocketServer, WebSocket } from "ws";
// const symbols = ["btcusdt","ethusdt","solusdt"];
// const stream = symbols.map((s)=>`${s}@aggTrade`).join('/')
// const url = `wss://stream.binance.com:9443/stream?streams=${stream}`
// const ws = new WebSocket(url)
// ws.on("open",()=>{
//       console.log(`Connected to Binance WS for ${symbols.join(", ")}`);
// })
// ws.on("message", (raw) => {
//   const msg = JSON.parse(raw.toString());
//   const { stream, data } = msg;

//   console.log(
//     `[${stream}] Price: ${data.p}, Qty: ${data.q}, Time: ${new Date(data.T)}`
//   );
// });
// ws/pricePoller.js
import {WebSocket} from "ws";
import { Kafka } from "kafkajs";
import * as dotenv from "dotenv";
// import fetch from "node-fetch";
dotenv.config();
const kafka = new Kafka({ clientId: "tick-producer", brokers: ["localhost:9092"] });
const producer = kafka.producer();
const binanceSymbols = ["btcusdt", "solusdt", "ethusdt"];
const binanceStreams = binanceSymbols.map((s) => `${s}@trade`).join("/");
const BINANCE_URL = `wss://stream.binance.com:9443/stream?streams=${binanceStreams}`;
const POLYGON_URL = `wss://socket.polygon.io/crypto`;
const POLYGON_KEY = process.env.POLYGON_KEY ;
const equitySymbols = ["X:BTCUSD", "X:ETHUSD", "X:SOLUSD"];
const POLL_INTERVAL = 5000;
interface PolygonCryptoResponse {
  status: string;
  symbol: string;
  last: {
    price: number;
    timestamp: number;
  };
}
async function publishTick(tick: any) {
  try {
    await producer.send({
      topic: "ticks",
      messages: [{ key: tick.assetId, value: JSON.stringify(tick) }],
    });
  } catch (err: any) {
    console.error("Kafka publish error", err);
  }
}

function startBinanceWS() {
  const binanceWS = new WebSocket(BINANCE_URL);
  binanceWS.on("open", () => {
    console.log(`Connected to Binance WS (${binanceSymbols.join(", ")})`);
  })
    // binanceWs.on("ping", (s) =>s.pong());

//@ts-ignore
  binanceWS.on("message", async(msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      const data = parsed.data;
      const streamSymbol = parsed.stream.split("@")[0].toUpperCase();

      const tick = {
        ts: new Date(data.T).toISOString(),
        assetId: streamSymbol,
        source: "BINANCE",
        price: parseFloat(data.p),
      };

      await publishTick(tick);
    } catch(err: any) {
      console.error("Error parsing binance tick:", err);
    }
  });
  binanceWS.on("close", () => {
    console.error("WS Closed. Reconnecting in 5s..");
    setTimeout(startBinanceWS, 5000);
  });
  binanceWS.on("error", (err:any) => {
    console.error("Eror connecting to binanceWS", err);
    binanceWS.close();
  });
}
function startPolygonWS() {
  const polygonWS = new WebSocket(POLYGON_URL);

  polygonWS.on("open", () => {
    console.log("Connected to polygon WS");
    polygonWS.send(JSON.stringify({ action: "auth", params: POLYGON_KEY } ));
    polygonWS.send(
      JSON.stringify({
        action: "subscribe",
        params: equitySymbols.map((s) => `T.${s}`).join(","),
      })
    );
  });

  polygonWS.on("message", async(msg:any) => {
    console.log("Polygon raw:", msg.toString());
    try {
      const updates = JSON.parse(msg.toString());
      for (const u of updates) {
        if (u.ev === "T") {
          const tick = {
            ts: new Date(u.t).toISOString(),
            assetId: u.sym,
            source: "POLYGON",
            price: u.p,
          };

          await publishTick(tick);
        }
      }
    } catch(err: any) {
      console.error("Error parsing Polygon tick:", err);
    }
  });

  polygonWS.on("close", () => {
    console.error("Polygon WS closed, Reconnecting in 5s...");
    setTimeout(startPolygonWS, 5000);
  });

  polygonWS.on("error", (err: any) => {
    console.error("Polygon WS error:", err);
    polygonWS.close();
  });
}
const cryptoSymbols = [
  { base: "BTC", quote: "USD" },
  { base: "ETH", quote: "USD" },
];

async function pollPolygonREST() {
  for (const { base, quote } of cryptoSymbols) {
    try {
      const url = `https://api.polygon.io/v1/last/crypto/${base}/${quote}?apiKey=${POLYGON_KEY}`;
      const res = await fetch(url);
      const json = (await res.json()) as PolygonCryptoResponse;

      if (json?.last) {
        const tick = {
          ts: new Date(json.last.timestamp).toISOString(),
          assetId: `${base}${quote}`,
          source: "POLYGON_REST",
          price: json.last.price,
        };

        await publishTick(tick);
        console.log("Polygon tick:", tick);
      } else {
        console.error("Polygon response missing last:", json);
      }
    } catch (err) {
      console.error(`Error fetching Polygon price for ${base}${quote}:`, err);
    }
  }
  setTimeout(pollPolygonREST, POLL_INTERVAL);
}
async function start() {
  await producer.connect();
  console.log("Kafka Producer connected");
  startBinanceWS();
  // startPolygonWS();
  // pollPolygonREST();
}
start().catch(console.error);
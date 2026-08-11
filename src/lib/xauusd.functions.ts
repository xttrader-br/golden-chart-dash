import { createServerFn } from "@tanstack/react-start";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FibLevel = { pct: number; price: number; zone: "compra" | "venda" | "neutro" };

export type Snapshot = {
  fetchedAt: number;
  bid: number;
  ask: number;
  spread: number;
  mid: number;
  lastTickAt: number;
  today: { open: number; high: number; low: number; date: number; range: number };
  previous: { open: number; high: number; low: number; close: number; date: number };
  vwap: { week: number; weekStart: number; previousWeek: number; previousWeekEnd: number };
  range: { avg10: number; days: number; usedPct: number };
  fib: { anchor: number; levels: FibLevel[]; position: number; bias: string };
  intraday: Candle[];
};


const FEED = "https://freeserv.dukascopy.com/2.0/index.php";

async function feed(params: Record<string, string>): Promise<number[][]> {
  const url = new URL(FEED);
  const search: Record<string, string> = {
    path: "chart/json3",
    instrument: "XAU/USD",
    splits: "true",
    stocks: "true",
    time_direction: "P",
    timestamp: String(Date.now()),
    jsonp: "cb",
    ...params,
  };
  for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Referer: "https://freeserv.dukascopy.com/2.0/",
      "User-Agent": "Mozilla/5.0",
    },
  });
  const text = await res.text();
  const json = text.replace(/^\s*cb\(/, "").replace(/\);?\s*$/, "");
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((row): row is number[] => Array.isArray(row));
}

const toCandles = (rows: number[][]): Candle[] =>
  rows
    .map((r) => ({ timestamp: r[0]!, open: r[1]!, high: r[2]!, low: r[3]!, close: r[4]! }))
    .sort((a, b) => a.timestamp - b.timestamp);

export const getSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<Snapshot> => {
  const [tickRows, minuteRows, hourRows, dayRows] = await Promise.all([
    feed({ interval: "TICK", offer_side: "B", limit: "1" }),
    feed({ interval: "1MIN", offer_side: "B", limit: "300" }),
    feed({ interval: "1HOUR", offer_side: "B", limit: "48" }),
    feed({ interval: "1DAY", offer_side: "B", limit: "5" }),
  ]);

  const days = toCandles(dayRows);
  const prev = days[days.length - 1];
  if (!prev) throw new Error("Feed Dukascopy indisponível");

  const intraday = toCandles(minuteRows);
  const hours = toCandles(hourRows);

  // Trading day starts right after the last completed daily candle.
  const dayStart = prev.timestamp + 864e5;
  const todayHours = hours.filter((c) => c.timestamp >= dayStart);
  const session = todayHours.length ? todayHours : intraday;

  const lastTick = tickRows[0];
  const lastClose = intraday[intraday.length - 1]?.close ?? prev.close;
  const bid = lastTick?.[1] ?? lastClose;
  const ask = lastTick?.[2] ?? lastClose;

  const highs = session.map((c) => c.high);
  const lows = session.map((c) => c.low);

  return {
    fetchedAt: Date.now(),
    bid,
    ask,
    spread: ask - bid,
    mid: (ask + bid) / 2,
    lastTickAt: lastTick?.[0] ?? (intraday[intraday.length - 1]?.timestamp ?? prev.timestamp),
    today: {
      open: session[0]?.open ?? prev.close,
      high: Math.max(...highs, bid),
      low: Math.min(...lows, bid),
      date: dayStart,
    },
    previous: {
      open: prev.open,
      high: prev.high,
      low: prev.low,
      close: prev.close,
      date: prev.timestamp,
    },
    intraday,
  };
});

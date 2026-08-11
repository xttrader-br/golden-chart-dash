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
    .map((r) => ({
      timestamp: r[0]!,
      open: r[1]!,
      high: r[2]!,
      low: r[3]!,
      close: r[4]!,
      volume: r[5] ?? 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

const isWeekday = (ts: number) => {
  const d = new Date(ts).getUTCDay();
  return d !== 0 && d !== 6;
};

/** 00:00 UTC of Monday of the week containing ts. */
const weekStartOf = (ts: number) => {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 864e5;
};

const vwapOf = (candles: Candle[]) => {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const v = c.volume > 0 ? c.volume : 1;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;
  }
  return vol ? pv / vol : 0;
};

export const getSnapshot = createServerFn({ method: "GET" }).handler(async (): Promise<Snapshot> => {
  const [tickRows, minuteRows, hourRows, dayRows] = await Promise.all([
    feed({ interval: "TICK", offer_side: "B", limit: "1" }),
    feed({ interval: "1MIN", offer_side: "B", limit: "300" }),
    feed({ interval: "1HOUR", offer_side: "B", limit: "500" }),
    feed({ interval: "1DAY", offer_side: "B", limit: "20" }),
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
  const todayOpen = session[0]?.open ?? prev.close;
  const todayHigh = Math.max(...highs, bid);
  const todayLow = Math.min(...lows, bid);
  const todayRange = todayHigh - todayLow;

  // ---- VWAP semanal (somente dias úteis) ----
  const weekdayHours = hours.filter((c) => isWeekday(c.timestamp));
  const curWeekStart = weekStartOf(dayStart);
  const prevWeekStart = curWeekStart - 7 * 864e5;
  const weekCandles = weekdayHours.filter((c) => c.timestamp >= curWeekStart);
  const prevWeekCandles = weekdayHours.filter(
    (c) => c.timestamp >= prevWeekStart && c.timestamp < curWeekStart,
  );
  const prevWeekEnd = prevWeekCandles[prevWeekCandles.length - 1]?.timestamp ?? prevWeekStart;

  // ---- Range médio dos últimos 10 dias úteis concluídos ----
  const completedWeekdays = days.filter((d) => isWeekday(d.timestamp)).slice(-10);
  const avg10 =
    completedWeekdays.reduce((s, d) => s + (d.high - d.low), 0) / (completedWeekdays.length || 1);
  const usedPct = avg10 ? (todayRange / avg10) * 100 : 0;

  // ---- Fibonacci ancorado na abertura (50%) com amplitude do range médio ----
  const half = avg10 / 2;
  const levels: FibLevel[] = [0, 20, 40, 60, 80, 100].map((pct) => ({
    pct,
    price: todayOpen - half + (avg10 * pct) / 100,
    zone: pct < 50 ? "compra" : pct > 50 ? "venda" : "neutro",
  }));
  const position = avg10 ? ((bid - (todayOpen - half)) / avg10) * 100 : 50;
  const bias =
    position <= 20
      ? "Compra forte — extremo inferior do range"
      : position < 40
        ? "Compra — desconto sobre a abertura"
        : position < 50
          ? "Compra fraca — próximo da abertura"
          : position <= 60
            ? "Neutro — equilíbrio na abertura"
            : position <= 80
              ? "Venda — prêmio sobre a abertura"
              : "Venda forte — extremo superior do range";

  return {
    fetchedAt: Date.now(),
    bid,
    ask,
    spread: ask - bid,
    mid: (ask + bid) / 2,
    lastTickAt: lastTick?.[0] ?? (intraday[intraday.length - 1]?.timestamp ?? prev.timestamp),
    today: {
      open: todayOpen,
      high: todayHigh,
      low: todayLow,
      date: dayStart,
      range: todayRange,
    },
    previous: {
      open: prev.open,
      high: prev.high,
      low: prev.low,
      close: prev.close,
      date: prev.timestamp,
    },
    vwap: {
      week: vwapOf(weekCandles),
      weekStart: curWeekStart,
      previousWeek: vwapOf(prevWeekCandles),
      previousWeekEnd: prevWeekEnd,
    },
    range: { avg10, days: completedWeekdays.length, usedPct },
    fib: { anchor: todayOpen, levels, position, bias },
    intraday,
  };
});


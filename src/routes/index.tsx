import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSnapshot, type Candle, type Snapshot } from "@/lib/xauusd.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "XAUUSD Live — Cotação Ouro em Tempo Real (Dukascopy)" },
      {
        name: "description",
        content:
          "Dashboard de cotação XAUUSD em tempo real com abertura do dia, fechamento, máxima e mínima do dia anterior via dados tick da Dukascopy.",
      },
      { property: "og:title", content: "XAUUSD Live — Cotação Ouro em Tempo Real" },
      {
        property: "og:description",
        content: "Bid/ask ao vivo, OHLC do dia anterior e gráfico intradiário do ouro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const fmt = (n: number | undefined, d = 3) =>
  n === undefined || Number.isNaN(n) ? "—" : n.toFixed(d);

function Stat({
  label,
  value,
  tone = "default",
  sub,
}: {
  label: string;
  value: string;
  tone?: "default" | "up" | "down" | "gold";
  sub?: string | undefined;
}) {
  const toneClass =
    tone === "up"
      ? "text-success"
      : tone === "down"
        ? "text-destructive"
        : tone === "gold"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function Chart({ candles, refs }: { candles: Candle[]; refs: { label: string; value: number }[] }) {
  if (candles.length < 2) return <div className="h-64 rounded-md border border-border bg-card" />;
  const w = 1000;
  const h = 280;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs, ...refs.map((r) => r.value));
  const min = Math.min(...lows, ...refs.map((r) => r.value));
  const pad = (max - min) * 0.08 || 1;
  const y = (v: number) => h - ((v - (min - pad)) / (max - min + pad * 2)) * h;
  const x = (i: number) => (i / (candles.length - 1)) * w;
  const line = candles.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(c.close).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const up = candles[candles.length - 1]!.close >= candles[0]!.open;

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap gap-4 px-1 text-[11px] text-muted-foreground">
        {refs.map((r) => (
          <span key={r.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-px w-4 border-t border-dashed border-primary" />
            {r.label} <span className="font-mono text-primary">{r.value.toFixed(3)}</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-64 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "var(--success)" : "var(--destructive)"} stopOpacity="0.25" />
            <stop offset="100%" stopColor={up ? "var(--success)" : "var(--destructive)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {refs.map((r) => (
          <g key={r.label}>
            <line
              x1={0}
              x2={w}
              y1={y(r.value)}
              y2={y(r.value)}
              stroke="var(--primary)"
              strokeWidth={1}
              strokeDasharray="6 6"
              opacity={0.55}
            />
          </g>
        ))}
        <path d={area} fill="url(#fill)" />
        <path
          d={line}
          fill="none"
          stroke={up ? "var(--success)" : "var(--destructive)"}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function Dashboard() {
  const fetchSnapshot = useServerFn(getSnapshot);
  const { data, isFetching, error } = useQuery<Snapshot>({
    queryKey: ["xauusd-snapshot"],
    queryFn: () => fetchSnapshot(),
    refetchInterval: 5000,
  });

  const prevClose = data?.previous.close;
  const change = data && prevClose ? data.bid - prevClose : undefined;
  const changePct = change && prevClose ? (change / prevClose) * 100 : undefined;
  const tone = change === undefined ? "default" : change >= 0 ? "up" : "down";

  return (
    <main className="min-h-screen bg-background px-5 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <h1 className="font-mono text-3xl font-bold tracking-tight text-primary">XAU/USD</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ouro spot · dados tick Dukascopy · atualização a cada 5s
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div className="flex items-center justify-end gap-2">
              <span
                className={`inline-block size-2 rounded-full ${isFetching ? "bg-primary" : "bg-success"}`}
              />
              {isFetching ? "Sincronizando…" : "Ao vivo"}
            </div>
            <div className="mt-1 font-mono">
              Último tick:{" "}
              {data ? new Date(data.lastTickAt).toLocaleTimeString("pt-BR", { timeZone: "UTC" }) + " UTC" : "—"}
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-md border border-destructive bg-card p-4 text-sm text-destructive">
            Falha ao obter dados da Dukascopy. Nova tentativa em instantes.
          </div>
        ) : null}

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Preço atual (bid)"
            value={fmt(data?.bid)}
            tone={tone}
            sub={
              change === undefined
                ? undefined
                : `${change >= 0 ? "+" : ""}${change.toFixed(3)} (${changePct?.toFixed(2)}%) vs fech. anterior`
            }
          />
          <Stat label="Ask" value={fmt(data?.ask)} sub={`Spread ${fmt(data?.spread, 3)}`} />
          <Stat label="Abertura de hoje" value={fmt(data?.today.open)} tone="gold" />
          <Stat
            label="Range de hoje"
            value={`${fmt(data?.today.low)} / ${fmt(data?.today.high)}`}
            sub="mínima / máxima"
          />
        </section>

        <h2 className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">
          Dia anterior
          {data ? ` — ${new Date(data.previous.date).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""}
        </h2>
        <section className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Abertura" value={fmt(data?.previous.open)} />
          <Stat label="Fechamento" value={fmt(data?.previous.close)} tone="gold" />
          <Stat label="Máxima" value={fmt(data?.previous.high)} tone="up" />
          <Stat label="Mínima" value={fmt(data?.previous.low)} tone="down" />
        </section>

        <h2 className="mt-8 text-xs uppercase tracking-widest text-muted-foreground">
          Intradiário M1 · últimas horas
        </h2>
        <div className="mt-3">
          <Chart
            candles={data?.intraday ?? []}
            refs={
              data
                ? [
                    { label: "Fech. ant.", value: data.previous.close },
                    { label: "Abertura", value: data.today.open },
                  ]
                : []
            }
          />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Fonte: feed público da Dukascopy Bank (ticks + candles, preços bid). O dia de negociação encerra
          às 00:00 UTC, mesma convenção do MT5 — pequenas diferenças de alguns milésimos vêm do spread
          e do provedor de liquidez da sua corretora.
        </p>
      </div>
    </main>
  );
}

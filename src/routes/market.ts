import { json } from '../lib/http';

interface QuoteItem {
  symbol: string;
  name: string;
  priceBrl: number;
  priceUsd?: number;
  changePct: number;
  source: string;
}

interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  category: string;
}

function stripCdata(raw: string): string {
  return raw
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? stripCdata(m[1]) : '';
}

function parseRssItems(xml: string, source: string, category: string, limit = 8): NewsItem[] {
  const items: NewsItem[] = [];
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of matches) {
    if (items.length >= limit) break;
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link && link.startsWith('http')) {
      items.push({
        title,
        link,
        source,
        publishedAt: pubDate || new Date().toISOString(),
        category,
      });
    }
  }
  return items;
}

async function fetchWithTimeout(url: string, ms = 4500): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; FinancasPessoaisWorker/3.0)',
        accept: 'application/json, application/rss+xml, application/xml, text/xml, */*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function handleMarketRoute(request: Request, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/market' || request.method !== 'GET') return null;

  const quotes: QuoteItem[] = [];
  const news: NewsItem[] = [];

  const [fxRes, cryptoRes, invRssRes, infoRssRes] = await Promise.allSettled([
    fetchWithTimeout('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL'),
    fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd,brl&include_24hr_change=true'),
    fetchWithTimeout('https://br.investing.com/rss/news.rss'),
    fetchWithTimeout('https://www.infomoney.com.br/feed/'),
  ]);

  if (fxRes.status === 'fulfilled' && fxRes.value.ok) {
    try {
      const fx = (await fxRes.value.json()) as Record<string, { bid?: string; pctChange?: string }>;
      if (fx.USDBRL?.bid) {
        quotes.push({
          symbol: 'USD/BRL',
          name: 'Dólar Comercial',
          priceBrl: Number(fx.USDBRL.bid),
          changePct: Number(fx.USDBRL.pctChange || 0),
          source: 'AwesomeAPI',
        });
      }
      if (fx.EURBRL?.bid) {
        quotes.push({
          symbol: 'EUR/BRL',
          name: 'Euro Comercial',
          priceBrl: Number(fx.EURBRL.bid),
          changePct: Number(fx.EURBRL.pctChange || 0),
          source: 'AwesomeAPI',
        });
      }
    } catch {
      // ignora erro de parse individual
    }
  }

  if (cryptoRes.status === 'fulfilled' && cryptoRes.value.ok) {
    try {
      const cg = (await cryptoRes.value.json()) as Record<
        string,
        { brl?: number; usd?: number; brl_24h_change?: number; usd_24h_change?: number }
      >;
      if (cg.bitcoin?.brl) {
        quotes.push({
          symbol: 'BTC',
          name: 'Bitcoin',
          priceBrl: Number(cg.bitcoin.brl),
          priceUsd: Number(cg.bitcoin.usd || 0),
          changePct: Number(cg.bitcoin.brl_24h_change ?? cg.bitcoin.usd_24h_change ?? 0),
          source: 'CoinGecko',
        });
      }
      if (cg.ethereum?.brl) {
        quotes.push({
          symbol: 'ETH',
          name: 'Ethereum',
          priceBrl: Number(cg.ethereum.brl),
          priceUsd: Number(cg.ethereum.usd || 0),
          changePct: Number(cg.ethereum.brl_24h_change ?? cg.ethereum.usd_24h_change ?? 0),
          source: 'CoinGecko',
        });
      }
      if (cg.solana?.brl) {
        quotes.push({
          symbol: 'SOL',
          name: 'Solana',
          priceBrl: Number(cg.solana.brl),
          priceUsd: Number(cg.solana.usd || 0),
          changePct: Number(cg.solana.brl_24h_change ?? cg.solana.usd_24h_change ?? 0),
          source: 'CoinGecko',
        });
      }
    } catch {
      // ignora erro de parse individual
    }
  }

  if (invRssRes.status === 'fulfilled' && invRssRes.value.ok) {
    try {
      const xml = await invRssRes.value.text();
      news.push(...parseRssItems(xml, 'Investing.com', 'Mercados', 8));
    } catch {
      // ignora erro de RSS
    }
  }

  if (infoRssRes.status === 'fulfilled' && infoRssRes.value.ok) {
    try {
      const xml = await infoRssRes.value.text();
      news.push(...parseRssItems(xml, 'InfoMoney', 'Economia', 8));
    } catch {
      // ignora erro de RSS
    }
  }

  news.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return json(
    {
      ok: true,
      updatedAt: new Date().toISOString(),
      quotes,
      news: news.slice(0, 14),
    },
    200,
    { 'cache-control': 'public, max-age=300' }
  );
}

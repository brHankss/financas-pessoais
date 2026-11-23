// Read card statements locally (PDF & CSV).
// Extracts each purchase individually with date, normalized description, cents, installment X/Y,
// and deterministic occurrence-indexed deduplication keys matching src/lib/dedup.ts.
window.StatementReader = (() => {
  const months = 'jan fev mar abr mai jun jul ago set out nov dez'.split(' ');
  const datePattern = /^(\d{1,2})(?:\s*[/.-]\s*|\s+)(\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s*[/.-]\s*(\d{4}|\d{2}))?\.?\s+/i;
  const isoDateExact = /^(\d{4})-(\d{2})-(\d{2})/;
  const brDateExact = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/;
  const moneyPattern = /(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*([CD+-])?$/i;
  const installmentPattern = /(?:\b(?:parc(?:ela)?\.?)\s*)?\b(\d{1,2})\s*(?:\/|\bde\b)\s*(\d{1,2})\b/i;

  function extractInstallment(raw) {
    const trimmed = String(raw || '').trim();
    const part = trimmed.match(installmentPattern);
    if (!part) return { description: trimmed, index: 1, count: 1 };
    const index = Number(part[1]);
    const count = Number(part[2]);
    if (!index || count < index || count > 99) return { description: trimmed, index: 1, count: 1 };
    const description = trimmed
      .replace(part[0], '')
      .replace(/[\s(\-–]+$|^\s*\)\s*|\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { description: description || trimmed, index, count };
  }

  const normalize = (s) => {
    const { description } = extractInstallment(s);
    return description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  function isIgnoredDescription(desc) {
    const clean = String(desc || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return /^(pagamento (?:recebido|de fatura|efetuado|fatura)|pagto fatura|estorno|saldo anterior|total\b|credito de|devolucao|cashback|desconto antecipacao)/.test(clean);
  }

  function inferCategory(description, remoteCategory) {
    const text = `${remoteCategory || ''} ${description || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/(salari|pro-labore|prolabore|holerite|remunerac|rendimento|dividend|payroll|salary)/.test(text)) return 'Salário';
    if (/(ifood|rappi|uber\s*eats|mercado|supermerc|atacad|padaria|acougue|restaur|lanch|cafe|pizza|burger|hortifruti|food|grocer|dining|bakery)/.test(text)) return 'Alimentação';
    if (/(uber|99app|99pop|cabify|posto|combustiv|gasolina|etanol|estacionam|pedagio|sem parar|veloe|metro|onibus|passagem|aerea|latam|gol|azul|transport|taxi|fuel|parking)/.test(text)) return 'Transporte';
    if (/(aluguel|condomin|energia|enel|cemig|copel|light|agua|sabesp|sanepar|gas|internet|vivo|claro|tim|oi|iptu|housing|rent|utilit)/.test(text)) return 'Moradia';
    if (/(farmac|drogaria|droga|raia|pacheco|hospital|clinic|medic|odonto|dentist|exame|laborat|plano de saude|unimed|amil|sulamerica|health|pharmacy|doctor)/.test(text)) return 'Saúde';
    if (/(escola|faculd|univers|curso|udemy|alura|coursera|livro|livraria|educac|mensalidade escolar|education|school)/.test(text)) return 'Educação';
    if (/(netflix|spotify|disney|hbo|max|prime video|amazon prime|youtube|icloud|apple\.com|google one|chatgpt|openai|assinat|subscription|stream)/.test(text)) return 'Assinaturas';
    if (/(cinema|ingresso|teatro|show|viagem|hotel|airbnb|booking|bar|clube|entreten|lazer|entertainment|travel|leisure)/.test(text)) return 'Lazer';
    if (/(amazon|mercado livre|mercadolivre|shopee|shein|magalu|magazine|americanas|casas bahia|renner|riachuelo|zara|nike|adidas|loja|shopping)/.test(text)) return 'Compras';
    return 'Compras';
  }

  function parseDateCell(raw, month) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const iso = s.match(isoDateExact);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const br = s.match(brDateExact);
    if (br) {
      const day = Number(br[1]);
      const m = Number(br[2]);
      const year = br[3]
        ? Number(br[3].length === 2 ? '20' + br[3] : br[3])
        : Number(month.slice(0, 4)) - Number(m > Number(month.slice(5)));
      if (m >= 1 && m <= 12 && day >= 1 && day <= new Date(year, m, 0).getDate()) {
        return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      return null;
    }
    const textDate = (s + ' ').match(datePattern);
    if (textDate) {
      const m = Number(textDate[2]) || months.indexOf(textDate[2].toLowerCase()) + 1;
      const year = textDate[3]
        ? Number(textDate[3].length === 2 ? '20' + textDate[3] : textDate[3])
        : Number(month.slice(0, 4)) - Number(m > Number(month.slice(5)));
      const day = Number(textDate[1]);
      if (m >= 1 && m <= 12 && day >= 1 && day <= new Date(year, m, 0).getDate()) {
        return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
    return null;
  }

  function parseMoneyCell(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    if (/C$/i.test(s)) return null; // credit/refund marker
    s = s.replace(/R\$/gi, '').replace(/\s+/g, '').replace(/[D+]$/i, '');
    if (!s || s.startsWith('-') || s.startsWith('(')) return null;
    // Detect Brazilian format (1.234,56 or 49,90) vs US format (1,234.56 or 49.90)
    let val;
    if (/^\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
      val = Number(s.replace(/\./g, '').replace(',', '.'));
    } else if (/^\d{1,3}(?:,\d{3})*\.\d{1,2}$/.test(s) || /^\d+\.\d{1,2}$/.test(s) || /^\d+$/.test(s)) {
      val = Number(s.replace(/,/g, ''));
    } else {
      return null;
    }
    if (!Number.isFinite(val) || val <= 0) return null;
    const cents = Math.round(val * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }

  function parsePdfLine(line, month) {
    const date = line.match(datePattern);
    if (!date) return null;
    const body = line.slice(date[0].length).trim();
    const money = body.match(moneyPattern);
    if (!money) return null;
    let description = body.slice(0, money.index).trim();
    if (
      /^-|^\(|[-(]\s*(?:R\$)?\s*$/.test(description) ||
      /[-C]/i.test(money[2] || '') ||
      /-/.test(money[1]) ||
      isIgnoredDescription(description)
    ) {
      return null;
    }
    const inst = extractInstallment(description);
    description = inst.description;
    const cents = Number(money[1].replace(/[^0-9]/g, ''));
    if (!description || !Number.isSafeInteger(cents) || cents <= 0) return null;
    const m = Number(date[2]) || months.indexOf(date[2].toLowerCase()) + 1;
    const year = date[3]
      ? Number(date[3].length === 2 ? '20' + date[3] : date[3])
      : Number(month.slice(0, 4)) - Number(m > Number(month.slice(5)));
    const day = Number(date[1]);
    if (m < 1 || m > 12 || !day || day > new Date(year, m, 0).getDate()) return null;
    return {
      description,
      date: [year, String(m).padStart(2, '0'), String(day).padStart(2, '0')].join('-'),
      cents,
      index: inst.index,
      count: inst.count,
      category: inferCategory(description),
    };
  }

  function splitCsvRow(line, sep) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseCsvText(text, month) {
    const rawLines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!rawLines.length) return { rows: [], skipped: 0 };

    const sample = rawLines[0];
    const counts = {
      ';': (sample.match(/;/g) || []).length,
      ',': (sample.match(/,/g) || []).length,
      '\t': (sample.match(/\t/g) || []).length,
    };
    const sep = counts[';'] >= counts[','] && counts[';'] >= counts['\t']
      ? ';'
      : counts['\t'] > counts[',']
        ? '\t'
        : ',';

    const firstCells = splitCsvRow(rawLines[0], sep).map((c) =>
      c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
    );

    let dateCol = firstCells.findIndex((c) => /^(data|date|dt|dia|data compra|data lancamento)$/.test(c));
    let descCol = firstCells.findIndex((c) => /^(title|titulo|descricao|description|estabelecimento|lancamento|historico|memo|compra)$/.test(c));
    let amountCol = firstCells.findIndex((c) => /^(amount|valor|value|total|valor r\$|valor \(r\$\))$/.test(c));
    let catCol = firstCells.findIndex((c) => /^(category|categoria)$/.test(c));
    let partCol = firstCells.findIndex((c) => /^(parcela|parcelas|installment|installments)$/.test(c));

    const hasHeader = dateCol !== -1 || descCol !== -1 || amountCol !== -1;
    const startIdx = hasHeader ? 1 : 0;
    if (!hasHeader) {
      dateCol = 0;
      descCol = 1;
      amountCol = firstCells.length >= 3 ? firstCells.length - 1 : 2;
    }

    const rows = [];
    let skipped = 0;

    for (let i = startIdx; i < rawLines.length; i++) {
      const cells = splitCsvRow(rawLines[i], sep);
      if (cells.length < 3) {
        skipped++;
        continue;
      }

      const dateVal = parseDateCell(dateCol >= 0 ? cells[dateCol] : cells[0], month);
      const rawDesc = descCol >= 0 ? cells[descCol] : cells[1];
      const cents = parseMoneyCell(amountCol >= 0 ? cells[amountCol] : cells[cells.length - 1]);

      if (!dateVal || !rawDesc || !cents || isIgnoredDescription(rawDesc)) {
        skipped++;
        continue;
      }

      let inst = extractInstallment(rawDesc);
      if (partCol >= 0 && cells[partCol]) {
        const partFromCol = extractInstallment(cells[partCol]);
        if (partFromCol.count > 1) {
          inst = { description: inst.description, index: partFromCol.index, count: partFromCol.count };
        }
      }

      const rawCat = catCol >= 0 ? cells[catCol] : '';
      rows.push({
        date: dateVal,
        description: inst.description,
        cents,
        index: inst.index,
        count: inst.count,
        category: inferCategory(inst.description, rawCat),
      });
    }

    return { rows, skipped };
  }

  function pageLines(items) {
    const rows = [];
    const sorted = items.filter((t) => t.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5]);
    for (const item of sorted) {
      const y = item.transform[5];
      if (!rows.length || Math.abs(rows.at(-1).y - y) > 2.5) rows.push({ y, items: [] });
      rows.at(-1).items.push(item);
    }
    return rows.flatMap((row) => {
      const lines = [];
      let line = '';
      for (const item of row.items.sort((a, b) => a.transform[4] - b.transform[4])) {
        if (moneyPattern.test(line) && datePattern.test(item.str.trim() + ' ')) {
          lines.push(line);
          line = '';
        }
        line += ' ' + item.str.trim();
        line = line.trim();
      }
      return [...lines, line];
    });
  }

  async function readPdf(file, month) {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const request = pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true });
    request.onPassword = (update, reason) => {
      const password = window.prompt(reason === 2 ? 'Senha incorreta. Digite novamente a senha do PDF.' : 'Digite a senha deste PDF.');
      if (password === null) {
        update(new Error('Leitura cancelada.'));
        return;
      }
      update(password);
    };
    const pdf = await request.promise;
    const rows = [];
    let skipped = 0;
    let futureSection = false;
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const { items } = await page.getTextContent();
        let pending = '';
        for (const text of pageLines(items)) {
          const heading = normalize(text);
          if (/^(comprasparceladasproximasfaturas|parcelasdasproximasfaturas|parcelamentosfuturos|lancamentosfuturos|comprasparaasproximasfaturas|proximasfaturas)/.test(heading)) {
            futureSection = true;
            pending = '';
          } else if (/^(lancamentosatuais|lancamentosdestafatura|lancamentoscomprasesaques|detalhamentodafatura|transacoesdoperiodo)/.test(heading)) {
            futureSection = false;
          }
          if (futureSection) continue;
          const starts = datePattern.test(text + ' ');
          if (starts && pending) {
            skipped++;
            pending = '';
          }
          if (!starts && !pending) continue;
          const line = pending ? pending + ' ' + text : text;
          if (!moneyPattern.test(line) && line.length < 240 && (starts || pending)) {
            pending = line;
            continue;
          }
          pending = '';
          const row = parsePdfLine(line, month);
          if (row) rows.push(row);
          else skipped++;
        }
        if (pending) skipped++;
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }
    return { rows, skipped };
  }

  async function read(file, month) {
    const name = String(file?.name || '').toLowerCase();
    const type = String(file?.type || '').toLowerCase();
    if (name.endsWith('.csv') || type.includes('csv') || type === 'text/plain') {
      const text = await file.text();
      return parseCsvText(text, month);
    }
    return readPdf(file, month);
  }

  function baseSignature(cardId, month, row) {
    const norm = normalize(row.description);
    const idx = Math.max(1, Math.floor(row.index || 1));
    const cnt = Math.max(idx, Math.floor(row.count || 1));
    const cents = Math.round(Number(row.cents) || 0);
    return `${cardId}|${month}|${row.date}|${norm}|${cents}|${idx}/${cnt}`;
  }

  function assignKeys(cardId, month, rows) {
    const counts = new Map();
    return rows.map((row) => {
      const base = baseSignature(cardId, month, row);
      const occ = (counts.get(base) || 0) + 1;
      counts.set(base, occ);
      return {
        ...row,
        baseSignature: base,
        occurrenceIndex: occ,
        importKey: `${base}#${occ}`,
      };
    });
  }

  function reconcileIncremental(existingMonthSlices, cardId, month, parsedRows) {
    const existingExactKeys = new Map();
    const existingByBase = new Map();
    const existingInstallmentLoose = new Map();

    for (const slice of existingMonthSlices) {
      const base = baseSignature(cardId, month, {
        date: slice.date,
        description: slice.description,
        cents: slice.fullCents,
        index: slice.installmentNumber,
        count: slice.installmentsTotal,
      });
      const list = existingByBase.get(base) || [];
      list.push(slice.purchaseId);
      existingByBase.set(base, list);

      const computedKey = `${base}#${list.length}`;
      existingExactKeys.set(computedKey, slice.purchaseId);
      if (slice.importKey) existingExactKeys.set(slice.importKey, slice.purchaseId);

      if (slice.installmentsTotal > 1) {
        const looseKey = `${cardId}|${month}|${normalize(slice.description)}|${slice.fullCents}|${slice.installmentNumber}/${slice.installmentsTotal}`;
        const looseList = existingInstallmentLoose.get(looseKey) || [];
        looseList.push(slice.purchaseId);
        existingInstallmentLoose.set(looseKey, looseList);
      }
    }

    const keyed = assignKeys(cardId, month, parsedRows);
    const consumed = new Set();
    const items = [];

    for (const row of keyed) {
      let matchedId = null;

      const exact = existingExactKeys.get(row.importKey);
      if (exact && !consumed.has(exact)) matchedId = exact;

      if (!matchedId) {
        const pool = existingByBase.get(row.baseSignature) || [];
        const free = pool.find((id) => !consumed.has(id));
        if (free) matchedId = free;
      }

      if (!matchedId && row.count > 1) {
        const looseKey = `${cardId}|${month}|${normalize(row.description)}|${row.cents}|${row.index}/${row.count}`;
        const pool = existingInstallmentLoose.get(looseKey) || [];
        const free = pool.find((id) => !consumed.has(id));
        if (free) matchedId = free;
      }

      if (matchedId) {
        consumed.add(matchedId);
        items.push({ ...row, duplicate: true, matchedPurchaseId: matchedId });
      } else {
        items.push({ ...row, duplicate: false, matchedPurchaseId: null });
      }
    }

    return {
      items,
      newItems: items.filter((i) => !i.duplicate),
      duplicateItems: items.filter((i) => i.duplicate),
    };
  }

  return {
    read,
    parseCsvText,
    normalize,
    inferCategory,
    baseSignature,
    assignKeys,
    reconcileIncremental,
  };
})();

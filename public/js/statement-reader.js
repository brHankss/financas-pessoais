// Read selectable statement text locally. Keep date, installment number and money in distinct fields.
window.StatementReader = (() => {
  const months = 'jan fev mar abr mai jun jul ago set out nov dez'.split(' ');
  const datePattern = /^(\d{1,2})(?:\s*[/.-]\s*|\s+)(\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s*[/.-]\s*(\d{4}|\d{2}))?\.?\s+/i;
  const moneyPattern = /(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*([CD+-])?$/i;
  const installmentPattern = /(?:\b(?:parc(?:ela)?\.?)\s*)?\b(\d{1,2})\s*(?:\/|\bde\b)\s*(\d{1,2})\b/i;
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function parse(line, month) {
    const date = line.match(datePattern);
    if (!date) return null;
    const body = line.slice(date[0].length).trim();
    const money = body.match(moneyPattern);
    if (!money) return null;
    let description = body.slice(0, money.index).trim();
    if (/^-|^\(|[-(]\s*(?:R\$)?\s*$/.test(description) || /[-C]/i.test(money[2] || '') || /-/.test(money[1]) ||
        /^(pagamento (?:recebido|de fatura|efetuado)|estorno|saldo anterior|total\b|cr[eé]dito de)/i.test(description)) return null;
    const part = description.match(installmentPattern);
    const index = part ? Number(part[1]) : 1;
    const count = part ? Number(part[2]) : 1;
    if (!index || count < index || count > 99) return null;
    if (part) description = description.replace(part[0], '').replace(/[\s(\-–]+$|^\s*\)\s*|\(\s*\)/g, '').trim();
    const cents = Number(money[1].replace(/[^0-9]/g, ''));
    if (!description || !Number.isSafeInteger(cents) || cents <= 0) return null;
    const m = Number(date[2]) || months.indexOf(date[2].toLowerCase()) + 1;
    const year = date[3] ? Number(date[3].length === 2 ? '20' + date[3] : date[3]) : Number(month.slice(0, 4)) - Number(m > Number(month.slice(5)));
    const day = Number(date[1]);
    if (m < 1 || m > 12 || !day || day > new Date(year, m, 0).getDate()) return null;
    return {description, date: [year, String(m).padStart(2, '0'), String(day).padStart(2, '0')].join('-'), cents, index, count};
  }

  function pageLines(items) {
    const rows = [];
    const sorted = items.filter(t => t.str?.trim()).sort((a,b) => b.transform[5] - a.transform[5]);
    for (const item of sorted) {
      const y = item.transform[5];
      if (!rows.length || Math.abs(rows.at(-1).y - y) > 2.5) rows.push({y, items: []});
      rows.at(-1).items.push(item);
    }
    return rows.flatMap(row => {
      const lines = [];
      let line = '';
      for (const item of row.items.sort((a,b) => a.transform[4] - b.transform[4])) {
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

  async function read(file, month) {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const request = pdfjs.getDocument({data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true});
    request.onPassword = (update, reason) => {
      const password = window.prompt(reason === 2 ? 'Senha incorreta. Digite novamente a senha do PDF.' : 'Digite a senha deste PDF.');
      if (password === null) { update(new Error('Leitura cancelada.')); return; }
      update(password);
    };
    const pdf = await request.promise;
    const rows = [];
    let skipped = 0;
    let futureSection = false;
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const {items} = await page.getTextContent();
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
          if (starts && pending) { skipped++; pending = ''; }
          if (!starts && !pending) continue;
          const line = pending ? pending + ' ' + text : text;
          if (!moneyPattern.test(line) && line.length < 240 && (starts || pending)) {
            pending = line;
            continue;
          }
          pending = '';
          const row = parse(line, month);
          if (row) rows.push(row);
          else skipped++;
        }
        if (pending) skipped++;
        page.cleanup();
      }
    } finally { await pdf.destroy(); }
    return {rows, skipped};
  }
  return {read, normalize};
})();

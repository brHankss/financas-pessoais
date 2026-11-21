// Read selectable statement text locally. Keep date, installment number and money in distinct fields.
window.StatementReader = (() => {
  const months = 'jan fev mar abr mai jun jul ago set out nov dez'.split(' ');
  const datePattern = /^(\d{1,2})(?:\s*[/.-]\s*|\s+)(\d{1,2}|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s*[/.-]\s*(\d{4}|\d{2}))?\.?\s+/i;
  const moneyPattern = /(?:R\$\s*)?(-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})\s*([CD+-])?$/i;
  const installmentPattern = /(?:\b(?:parc(?:ela)?\.?)\s*)?\b(\d{1,2})\s*(?:\/|\bde\b)\s*(\d{1,2})\b/i;
  const unaccent = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalize = s => unaccent(s).replace(/[^a-z0-9]/g, '');
  const maskedNumber = /(?<!\d)(?:\d{4,6}[\s.\p{Pd}\u2212\u00ad]*)?(?:[*x•●◦∙·][\s.\p{Pd}\u2212\u00ad]*){2,}\d{4}(?!\d)/iu;
  const fullNumber = /(?<!\d)(?:\d[\s.\p{Pd}\u2212\u00ad]*){12,18}\d(?![\s.\p{Pd}\u2212\u00ad]*\d)/u;
  const allFullNumbers = new RegExp(fullNumber.source, 'gu');
  const finalNumber = /\b(?:final(?:\s+do cart[aã]o)?|terminad[oa](?:\s+em)?|[úu]ltimos\s+4\s+d[ií]gitos)\s*[:#-]?\s*(\d{4})(?!\d)/i;
  const nonCardNumber = /\b(?:cpf|cnpj|conta(?: corrente| digital)?|agencia|pedido|documento|contrato|protocolo|identificador|codigo)\b(?:\s*(?=[(:#]|\d|\*|x{2})|\s+(?:final|numero)\b)/;
  const rolePattern = /^(?:adicional|dependente|titular|principal|virtual|f[ií]sico)\b/i;
  const cardPrefix = /^(?:(?:compras|lan[cç]amentos|transa[cç][oõ]es)\s+(?:(?:do|no)\s+)?)?(?:(?:fatura\s+d[oe]\s+)?cart[aã]o(?:\s+de cr[eé]dito)?)(?=\s|[:#-]|$)\s*[:#-]?\s*/i;
  const coverPrefix = /^fatura\s+d[oe]\s+cart[aã]o\b/i;
  const personName = /^[\p{L}][\p{L}'.-]+(?:\s+[\p{L}'.-]+)+$/u;
  const networks = [
    [/\bmaster\s*card\b/i, 'Mastercard'], [/\bvisa\b/i, 'Visa'], [/\belo\b/i, 'Elo'],
    [/\b(?:american express|amex)\b/i, 'American Express'], [/\bhipercard\b/i, 'Hipercard'],
    [/\bdiners(?: club)?\b/i, 'Diners Club'], [/\bdiscover\b/i, 'Discover']
  ];
  const issuers = [
    [/\bnubank\b/i, 'Nubank'], [/\bitau(?:card)?\b/i, 'Itaú'], [/\bbradesco\b/i, 'Bradesco'],
    [/\bsantander\b/i, 'Santander'], [/\bbanco do brasil\b/i, 'Banco do Brasil'], [/\b(?:caixa economica federal|caixa)\b/i, 'Caixa'],
    [/\b(?:banco )?inter\b/i, 'Inter'], [/\bc6(?: bank)?\b/i, 'C6 Bank'], [/\bsicredi\b/i, 'Sicredi'],
    [/\bsicoob\b/i, 'Sicoob'], [/\b(?:porto bank|porto seguro)\b/i, 'Porto Bank'], [/\bbtg pactual\b/i, 'BTG Pactual'],
    [/\bneon\b/i, 'Neon'], [/\bmercado pago\b/i, 'Mercado Pago'], [/\bpicpay\b/i, 'PicPay'],
    [/\bwill bank\b/i, 'will bank'], [/\bbanco pan\b/i, 'Banco PAN'], [/\b(?:xp investimentos|banco xp)\b/i, 'XP']
  ];
  const fieldPatterns = {
    name: 'nome (?:d[oe] |no )?cartao|produto do cartao',
    number: '(?:numero|n[º°]|num\\.?) (?:de |do )?cartao|cartao (?:numero|n[º°]|num\\.?)|final (?:do cartao|cartao)|ultimos 4 digitos',
    final: 'final|terminad[oa] em',
    brand: 'bandeira(?: do cartao)?',
    institution: '(?:banco|instituicao) emissor[a]?|instituicao(?: financeira)?|emissor(?: do cartao)?|banco',
    statementHolder: '(?:nome do )?titular da fatura',
    holderName: '(?:nome (?:do|da) )?(?:titular|portador[a]?|titularidade)(?: do cartao)?',
    due: '(?:data |dia )(?:de |do )?vencimento(?: da fatura)?|vencimento(?: da fatura)?|vence em',
    close: '(?:data |dia )(?:de |do )?fechamento(?: da fatura)?|fechamento(?: da fatura)?',
    limit: 'limite(?: de credito| total(?: de credito)?)?(?: do cartao)?',
    period: 'periodo(?: desta fatura| da fatura| de compras| dos lancamentos)?',
    reference: '(?:mes de )?referencia(?: da fatura)?|fatura de'
  };
  const fieldMatchers = Object.entries(fieldPatterns).map(([field, pattern]) => [field, new RegExp('^(?:' + pattern + ')$')]);
  const fieldNames = Object.values(fieldPatterns).join('|');
  const leadingField = new RegExp('^(' + fieldNames + ')(?=\\s|:|$)\\s*:?\\s*');
  const inlineField = new RegExp('\\s+(' + fieldNames + ')\\s*:\\s*', 'g');
  const statementDate = /\b(\d{1,2})\s*(?:[/.\-]\s*|\s+de\s+|\s+)(\d{1,2}|jan(?:eiro)?|fev(?:ereiro)?|mar(?:co)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)(?:\s*[/.-]\s*|\s+de\s+|\s+)?(\d{4}|\d{2})?\b/g;
  const futureHeading = /^(?:comprasparceladas(?:paraas)?proximasfaturas|parcelasdasproximasfaturas|parcelamentosfuturos|lancamentosfuturos|comprasparaasproximasfaturas|proximasfaturas)/;
  const currentHeading = /^(?:lancamentos$|lancamentosatuais|lancamentosdestafatura|lancamentoscomprasesaques|detalhamentodafatura|transacoesdoperiodo)/;
  const summaryHeading = /^(?:resumodoscartoes|resumoporcartao|resumodecartoes|resumodafaturaporcartao)/;

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
    description = description.replace(allFullNumbers, '').trim();
    if (!description) return null;
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
    for (const row of rows) row.items.sort((a,b) => a.transform[4] - b.transform[4]);
    const lines = [];
    for (const [index, row] of rows.entries()) {
      const stacked = stackedFields(row, rows[index + 1]);
      if (stacked.length) {
        lines.push(...stacked);
        rows[index + 1].items = [];
        continue;
      }
      let line = '';
      let previousEnd = 0;
      for (const item of row.items) {
        const value = item.str.trim();
        const isNewPurchase = moneyPattern.test(line) && datePattern.test(value + ' ');
        const isNewField = item.transform[4] - previousEnd > 18 && !datePattern.test(line + ' ') &&
          (leadingField.test(unaccent(value)) || cardPrefix.test(value));
        if (line && (isNewPurchase || isNewField)) {
          lines.push(line);
          line = '';
        }
        line = line ? line + ' ' + value : value;
        previousEnd = item.transform[4] + item.width;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function stackedFields(row, next) {
    if (!row.items.length || !next || row.y - next.y > 28) return [];
    const columns = row.items.map(item => {
      const label = item.str.trim();
      const match = unaccent(label).match(leadingField);
      return {...item, label, field: match && match[0].length === label.length ? fieldType(match[1]) : null};
    });
    if (columns.some(column => !column.field) || !next.items.length) return [];
    const values = columns.map((column, index) => {
      const left = column.transform[4] - 20;
      const right = (columns[index + 1]?.transform[4] ?? Infinity) - 20;
      return next.items.filter(item => item.transform[4] >= left && item.transform[4] < right)
        .map(item => item.str.trim()).join(' ');
    });
    if (next.items[0].transform[4] < columns[0].transform[4] - 20 ||
        values.some((value, index) => !validFieldValue(columns[index].field, value))) return [];
    return columns.map((column, index) => column.label.replace(/:\s*$/, '') + ': ' + values[index]);
  }

  function validFieldValue(field, value) {
    if (!value || leadingField.test(unaccent(value))) return false;
    if (field === 'due' || field === 'close') {
      return !moneyPattern.test(value) && Boolean(calendarDay(value).day);
    }
    if (field === 'limit') return moneyPattern.test(value) && creditLimit(value) !== undefined;
    if (field === 'number' || field === 'final') return !moneyPattern.test(value) && Boolean(lastDigits(value, true));
    if (field === 'period' || field === 'reference') return !moneyPattern.test(value) && !cardPrefix.test(value);
    return !moneyPattern.test(value) && !datePattern.test(value + ' ') && !cardPrefix.test(value);
  }

  function recognized(value, options) {
    return options.find(([pattern]) => pattern.test(unaccent(value)))?.[1];
  }

  function safeLabel(value) {
    return value.replace(allFullNumbers, '')
      .replace(maskedNumber, '').replace(finalNumber, '').replace(/\(\s*\)/g, '')
      .replace(/^[\s:|–—-]+|[\s:|–—-]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function lastDigits(value, explicit = false) {
    const final = value.match(finalNumber);
    if (final) return final[1];
    const masked = value.match(maskedNumber);
    if (masked) return masked[0].slice(-4);
    if (explicit) {
      const number = value.match(fullNumber);
      if (number) return number[0].replace(/\D/g, '').slice(-4);
      return value.match(/(?:^|[^\d/.,-])(?:\(\s*)?(\d{4})\s*\)?\s*$/)?.[1];
    }
  }

  function cardHeading(text) {
    const prefix = text.match(cardPrefix);
    const value = text.slice(prefix?.[0].length || 0);
    const roleLabel = prefix && value.match(rolePattern)?.[0];
    const roleText = roleLabel && unaccent(roleLabel);
    const role = /^(?:titular|principal)$/.test(roleText) ? 'primary'
      : /^(?:adicional|dependente)$/.test(roleText) ? 'additional' : roleText || undefined;
    if (nonCardNumber.test(unaccent(value))) return null;
    const brand = recognized(value, networks);
    const institution = recognized(value, issuers);
    const namedProduct = brand && networks.some(([pattern]) => value.match(pattern)?.index === 0) ||
      institution && issuers.some(([pattern]) => unaccent(value).match(pattern)?.index === 0);
    const mask = value.match(maskedNumber);
    const bareMask = !prefix && mask?.[0] === value;
    const namedHolder = !prefix && !namedProduct && holderFromHeading(value, mask);
    const number = lastDigits(value, Boolean(prefix || namedProduct || namedHolder));
    if (!prefix && !bareMask && !(number && (namedProduct || namedHolder))) return null;
    if (prefix && !role && !number && !brand && !institution) return null;
    if (moneyPattern.test(value) && !number) return null;
    const name = safeLabel(value.slice(roleLabel?.length || 0)).replace(/\(?\s*\b\d{4}\)?\s*$/, '').trim();
    return {
      ...(number && {last4: number}),
      ...(name && !/^(?:com|de|n[º°])$/i.test(name) && !namedHolder && {name}),
      ...(role && {role}),
      ...(brand && {brand}),
      ...(namedHolder && {holderName: namedHolder}),
      institution
    };
  }

  function holderFromHeading(value, mask) {
    const parenthetical = value.match(/^(.+?)\s*\(\s*(?:final\s*)?\d{4}\s*\)$/i)?.[1];
    const beforeMask = mask && !value.slice(mask.index + mask[0].length).trim() &&
      value.slice(0, mask.index).replace(/[\s–—|-]+$/, '');
    const name = parenthetical || beforeMask;
    if (name && personName.test(name)) return safeLabel(name);
  }

  function fields(text) {
    const searchable = unaccent(text);
    const first = searchable.match(leadingField);
    const matches = [...(first ? [first] : []), ...searchable.matchAll(inlineField)];
    return {
      title: text.slice(0, matches[0]?.index ?? text.length).trim().replace(/[|:]\s*$/, '').trim(),
      values: matches.map((match, index) => [
        fieldType(match[1]),
        text.slice(match.index + match[0].length, matches[index + 1]?.index).trim()
      ])
    };
  }

  function fieldType(label) {
    return fieldMatchers.find(([, pattern]) => pattern.test(label))?.[0];
  }

  function calendarDates(value) {
    return [...unaccent(value).matchAll(statementDate)].map(([,d,m,y]) => {
      const month = Number(m) || months.indexOf(m.slice(0, 3)) + 1;
      const day = Number(d);
      const year = y ? Number(y.length === 2 ? '20' + y : y) : undefined;
      if (month < 1 || month > 12 || day < 1 || day > new Date(year ?? 2000, month, 0).getDate()) return null;
      return {day, month: year >= 1900 && year <= 2200 ? year + '-' + String(month).padStart(2, '0') : undefined};
    }).filter(Boolean);
  }

  function calendarDay(value) {
    const dates = calendarDates(value);
    if (dates.length) return dates[0];
    const day = Number(unaccent(value).match(/^(?:dia\s+)?(\d{1,2})(?:\s+de cada mes)?$/)?.[1]);
    return day >= 1 && day <= 31 ? {day} : {};
  }

  function creditLimit(value) {
    const match = value.match(/^(?:R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?)(?:\s|$)/i);
    if (!match) return;
    const limit = Number(match[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isSafeInteger(Math.round(limit * 100))) return limit;
  }

  function cardDetails(text) {
    const {title, values} = fields(text);
    const heading = cardHeading(title);
    const data = {...heading};
    let statementHolder;
    let contextualLast4;
    let explicitName;
    let dueMonth;
    let periodMonth;
    for (const [field, value] of values) {
      const label = safeLabel(value);
      if (field === 'name' && label) {
        data.name = explicitName = label;
        data.last4 ||= lastDigits(value) || value.match(fullNumber)?.[0].replace(/\D/g, '').slice(-4);
        data.brand ||= recognized(label, networks);
        data.institution ||= recognized(label, issuers);
      }
      if (field === 'number') data.last4 ||= lastDigits(value, true);
      if (field === 'final') {
        if (cardPrefix.test(title)) data.last4 ||= lastDigits(value, true);
        else contextualLast4 ||= lastDigits(value, true);
      }
      if (field === 'brand') data.brand ||= recognized(label, networks);
      if (field === 'institution' && /\p{L}/u.test(label) && !moneyPattern.test(label)) data.institution ||= recognized(label, issuers) || label;
      if ((field === 'holderName' || field === 'statementHolder') && /^[\p{L}][\p{L}'. -]+$/u.test(label)) {
        if (field === 'statementHolder') statementHolder = label;
        else data.holderName = label;
      }
      if (field === 'due') {
        const date = calendarDay(value);
        data.dueDay ||= date.day;
        dueMonth ||= date.month;
      }
      if (field === 'close') data.closeDay ||= calendarDay(value).day;
      if (field === 'limit') data.limit ??= creditLimit(value);
      if (field === 'period' || field === 'reference') {
        periodMonth ||= calendarDates(value).at(-1)?.month;
        const monthYear = unaccent(value).match(/^([a-z]{3,9})(?:\s+de)?\s+(\d{4})\b/);
        const month = monthYear && months.indexOf(monthYear[1].slice(0, 3)) + 1;
        if (month) periodMonth ||= monthYear[2] + '-' + String(month).padStart(2, '0');
      }
    }
    const startCard = Boolean(heading || data.last4);
    const cardHint = Boolean(data.name || data.brand || data.last4);
    return {
      data, startCard, cardHint, statementHolder, contextualLast4, explicitName, dueMonth, periodMonth,
      isCover: coverPrefix.test(title),
      isField: Boolean(heading || values.length)
    };
  }

  function mergeDetails(target, details) {
    for (const [field, value] of Object.entries(details)) {
      if (value !== undefined && target[field] === undefined) target[field] = value;
    }
  }

  function followingHolder(pages, pageIndex, lineIndex) {
    for (let page = pageIndex; page < pages.length; page++) {
      for (let line = page === pageIndex ? lineIndex + 1 : 0; line < pages[page].length; line++) {
        const text = pages[page][line];
        const heading = normalize(text);
        if (datePattern.test(text + ' ') || futureHeading.test(heading) ||
            currentHeading.test(heading) || summaryHeading.test(heading)) return;
        const {data, startCard} = cardDetails(text);
        if (startCard) return;
        if (data.holderName) return data.holderName;
      }
    }
  }

  function selectCard(cards, current, details, assigned) {
    const compatible = card => {
      if (!['brand', 'institution', 'holderName', 'role'].every(field =>
        !card[field] || !details[field] || normalize(card[field]) === normalize(details[field]))) return false;
      const oldName = normalize(card.name || '');
      const newName = normalize(details.name || '');
      return oldName.includes(newName) || newName.includes(oldName);
    };
    const candidates = details.last4 ? cards.filter(card => card.last4 === details.last4 && compatible(card)) : [];
    const matchingName = details.name ? candidates.filter(card => normalize(card.name || '') === normalize(details.name)) : [];
    if (matchingName.length === 1) return matchingName[0];
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return candidates.includes(current) ? current : null;
    if (current && !current.last4 && !assigned.has(current.key) && compatible(current)) return current;
    const card = {key: 'card-' + (cards.length + 1)};
    cards.push(card);
    return card;
  }

  function readLines(pages, fallbackMonth) {
    const cards = [];
    const statement = {};
    const purchases = [];
    const assigned = new Set();
    let dueMonth;
    let periodMonth;
    let active = null;
    let skipped = 0;
    let futureSection = false;
    let summarySection = false;

    for (const [pageIndex, lines] of pages.entries()) {
      let pending = '';
      let metadataCard = active;
      let inCover = false;
      let sawPurchase = false;
      for (const [lineIndex, text] of lines.entries()) {
        const heading = normalize(text);
        if (futureHeading.test(heading)) {
          futureSection = true;
          pending = '';
        } else if (currentHeading.test(heading)) {
          futureSection = false;
          if (summarySection) active = metadataCard = null;
          summarySection = false;
        } else if (summaryHeading.test(heading)) {
          summarySection = true;
          active = metadataCard = null;
          inCover = false;
        }
        if (futureSection) continue;
        const starts = datePattern.test(text + ' ');
        if (!starts) {
          if (!statement.institution && !active && !pending && !purchases.length) {
            const banner = unaccent(text);
            statement.institution = issuers.find(([pattern]) => banner.match(pattern)?.[0] === banner)?.[1];
          }
          const {
            data, startCard, cardHint, statementHolder, contextualLast4, explicitName,
            dueMonth: foundDue, periodMonth: foundPeriod, isField, isCover
          } = cardDetails(text);
          if (isField && !(pending && !startCard && moneyPattern.test(text))) {
            dueMonth ||= foundDue;
            periodMonth ||= foundPeriod;
            statement.holderName ||= statementHolder;
            if (contextualLast4 && metadataCard) data.last4 ||= contextualLast4;
            if (startCard || (cardHint && !metadataCard) || (data.last4 && !metadataCard?.last4)) {
              if (data.last4 && !data.holderName) {
                data.holderName = followingHolder(pages, pageIndex, lineIndex);
              }
              const count = cards.length;
              metadataCard = selectCard(cards, metadataCard, data, assigned);
              const repeatedCover = pageIndex > 0 && isCover && !sawPurchase && cards.length === count;
              if (!repeatedCover || !active) active = metadataCard;
              inCover = isCover && !sawPurchase;
            }
            if (metadataCard) {
              if (explicitName) metadataCard.name = explicitName;
              mergeDetails(metadataCard, data);
              if (inCover) mergeDetails(statement, {dueDay: data.dueDay, closeDay: data.closeDay});
            }
            else if (!startCard && !cardHint) mergeDetails(statement, data);
            if (pending) { skipped++; pending = ''; }
            continue;
          }
        }
        if (starts && pending) { skipped++; pending = ''; }
        if (!starts && !pending) continue;
        const line = pending ? pending + ' ' + text : text;
        if (!moneyPattern.test(line) && line.length < 240) {
          pending = line;
          continue;
        }
        pending = '';
        const cardKey = summarySection ? null : active?.key ?? null;
        if (cardKey) assigned.add(cardKey);
        purchases.push({line, cardKey});
        metadataCard = active;
        sawPurchase = true;
        inCover = false;
      }
      if (pending) skipped++;
    }

    if (!cards.length && (statement.institution || statement.limit !== undefined)) cards.push({key: 'card-1'});
    const primary = cards.find(card => card.role === 'primary') || (cards.length === 1 && cards[0].role !== 'additional' ? cards[0] : undefined);
    const holderName = statement.holderName || primary?.holderName;
    const resultCards = cards.map(({role, ...card}) => {
      mergeDetails(card, {
        institution: statement.institution,
        holderName: role === 'primary' || cards.length === 1 && role !== 'additional' ? holderName : undefined,
        dueDay: statement.dueDay,
        closeDay: statement.closeDay,
        limit: cards.length === 1 ? statement.limit : undefined
      });
      return card;
    });
    const month = dueMonth || periodMonth || fallbackMonth;
    const rows = [];
    for (const {line, cardKey} of purchases) {
      const row = parse(line, month);
      if (row) rows.push({...row, cardKey: cardKey ?? (cards.length === 1 ? cards[0].key : null)});
      else skipped++;
    }
    return {rows, cards: resultCards, skipped, month, ...(holderName && {holderName})};
  }

  async function read(file, fallbackMonth) {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const request = pdfjs.getDocument({data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true});
    request.onPassword = (update, reason) => {
      const password = window.prompt(reason === 2 ? 'Senha incorreta. Digite novamente a senha do PDF.' : 'Digite a senha deste PDF.');
      if (password === null) { update(new Error('Leitura cancelada.')); return; }
      update(password);
    };
    const pdf = await request.promise;
    const pages = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const {items} = await page.getTextContent();
        pages.push(pageLines(items));
        page.cleanup();
      }
    } finally { await pdf.destroy(); }
    return readLines(pages, fallbackMonth);
  }
  return {read, normalize};
})();

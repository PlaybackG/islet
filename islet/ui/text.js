// Локальные преобразования текста и мелкие форматтеры.
const TextTools = (() => {
  const EN = "`qwertyuiop[]asdfghjkl;'zxcvbnm,./~QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?@#$^&";
  const RU = 'ёйцукенгшщзхъфывапролджэячсмитьбю.ЁЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,"№;:?';
  const toRu = new Map(), toEn = new Map();
  for (let i = 0; i < EN.length; i++) {
    toRu.set(EN[i], RU[i]);
    if (/[а-яё]/i.test(RU[i])) toEn.set(RU[i], EN[i]); // знаки препинания в русском тексте не трогаем
  }

  // Набрано не в той раскладке: определяем направление по буквам.
  function layout(s) {
    const lat = (s.match(/[a-z]/gi) || []).length;
    const cyr = (s.match(/[а-яё]/gi) || []).length;
    const map = lat >= cyr ? toRu : toEn;
    return [...s].map((c) => map.get(c) ?? c).join('');
  }

  const TR = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
    н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  function translit(s) {
    return [...s].map((c) => {
      const low = c.toLowerCase();
      if (!(low in TR)) return c;
      const t = TR[low];
      return c === low ? t : t.charAt(0).toUpperCase() + t.slice(1);
    }).join('');
  }

  const title = (s) => s.toLowerCase().replace(/(^|[\s\-«"(])([a-zа-яё])/g, (m, a, b) => a + b.toUpperCase());
  const sentence = (s) => s.toLowerCase().replace(/(^\s*|[.!?…]\s+)([a-zа-яё])/g, (m, a, b) => a + b.toUpperCase());
  const spaces = (s) => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  function apply(kind, s) {
    switch (kind) {
      case 'layout': return layout(s);
      case 'upper': return s.toUpperCase();
      case 'lower': return s.toLowerCase();
      case 'title': return title(s);
      case 'sentence': return sentence(s);
      case 'translit': return translit(s);
      case 'spaces': return spaces(s);
      case 'breaks': return s.replace(/\s*\r?\n\s*/g, ' ').trim();
      case 'json-pretty': return JSON.stringify(JSON.parse(s), null, 2);
      case 'json-line': return JSON.stringify(JSON.parse(s));
      case 'b64-enc': { let b = ''; for (const x of new TextEncoder().encode(s)) b += String.fromCharCode(x); return btoa(b); }
      case 'b64-dec': return new TextDecoder().decode(Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0)));
    }
    return s;
  }

  const AI = {
    'ai-translate': 'Переведи текст: если он на русском — на английский, иначе — на русский. Верни только перевод, без пояснений.',
    'ai-fix': 'Исправь орфографию, пунктуацию и грамматику, сохрани смысл, язык и стиль. Верни только исправленный текст.',
    'ai-short': 'Сократи текст, сохранив главное. Верни только результат.',
    'ai-formal': 'Перепиши текст в вежливом официально-деловом стиле на том же языке. Верни только результат.',
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Мини-markdown для ответов ИИ: блоки кода, `код`, **жирный**, списки, ссылки. Всё экранируется.
  function md(src) {
    const parts = String(src).split(/```/);
    return parts.map((p, i) => {
      if (i % 2) {
        const nl = p.indexOf('\n');
        const code = nl >= 0 && /^[\w+-]*$/.test(p.slice(0, nl).trim()) ? p.slice(nl + 1) : p;
        return `<pre><button class="code-copy" title="Копировать">${icon('copy', 14)}</button><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
      }
      let h = esc(p);
      h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/^#{1,4} (.+)$/gm, '<b>$1</b>')
        .replace(/^\s*[-*•] (.+)$/gm, '<span class="li">$1</span>')
        .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="#" data-url="$1">$1</a>')
        .replace(/\n?(<span class="li">[^\n]*<\/span>)\n?/g, '$1') // пункт списка — уже блок, лишний перенос не нужен
        .replace(/\n/g, '<br>');
      return h;
    }).join('');
  }

  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0'), ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function size(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1024 ** 2) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' КБ';
    if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' МБ';
    return (n / 1024 ** 3).toFixed(2) + ' ГБ';
  }

  function ago(ms) {
    const d = (Date.now() - ms) / 1000;
    if (d < 60) return 'только что';
    if (d < 3600) return Math.floor(d / 60) + ' мин';
    if (d < 86400) return Math.floor(d / 3600) + ' ч';
    if (d < 30 * 86400) return Math.floor(d / 86400) + ' дн';
    return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  return { apply, AI, esc, md, clock, size, ago };
})();

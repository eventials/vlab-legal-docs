// Destaque de alterações para os previews de PR.
//
// Compara os blocos (parágrafos, títulos, listas...) do documento publicado com os do
// documento novo. Blocos parecidos recebem diff palavra a palavra; os demais aparecem
// inteiros como adicionados/removidos. As marcas são caracteres sentinela inseridos no
// markdown e convertidos em <ins>/<del> depois que o HTML final é gerado.

import { diffArrays, diffWordsWithSpace } from 'diff';

const INS_OPEN = '';
const INS_CLOSE = '';
const DEL_OPEN = '';
const DEL_CLOSE = '';
const SENTINELS = /[-]/g;

// Blocos em que o diff palavra a palavra é seguro (tabelas e código são trocados inteiros).
const WORD_DIFFABLE = new Set(['paragraph', 'heading', 'list', 'blockquote', 'text']);
const MIN_SIMILARITY = 0.4;

// Sintaxe de início de linha que precisa ficar fora das marcas para o markdown continuar válido.
const LINE_PREFIX = /^(\s*(?:[-*+]|\d+[.)])\s+|\s*#{1,6}\s+|\s*>\s?)/;

function wrap(text, open, close, atLineStart) {
  return text
    .split('\n')
    .map((line, i) => {
      if (!line.trim()) return line;
      let prefix = '';
      if (i > 0 || atLineStart) {
        const m = line.match(LINE_PREFIX);
        if (m) {
          prefix = m[0];
          line = line.slice(prefix.length);
        }
      }
      const lead = line.match(/^\s*/)[0];
      const trail = line.match(/\s*$/)[0];
      const core = line.slice(lead.length, line.length - trail.length);
      return core ? `${prefix}${lead}${open}${core}${close}${trail}` : prefix + line;
    })
    .join('\n');
}

/** Destinos resolvidos (já com links de referência) de todos os links/imagens de um token. */
function hrefs(token) {
  const out = [];
  const walk = (t) => {
    if (!t || typeof t !== 'object') return;
    if ((t.type === 'link' || t.type === 'image') && t.href) out.push(t.href);
    for (const k of ['tokens', 'items', 'header', 'rows']) {
      const v = t[k];
      if (Array.isArray(v)) v.flat().forEach(walk);
    }
  };
  walk(token);
  return out.join('\n');
}

function similarity(a, b) {
  let common = 0;
  for (const p of diffWordsWithSpace(a, b)) if (!p.added && !p.removed) common += p.value.length;
  return (2 * common) / (a.length + b.length || 1);
}

function markupBlock(oldRaw, newRaw) {
  let out = '';
  for (const p of diffWordsWithSpace(oldRaw, newRaw)) {
    const atLineStart = out === '' || out.endsWith('\n');
    if (p.added) out += wrap(p.value, INS_OPEN, INS_CLOSE, atLineStart);
    else if (p.removed) out += wrap(p.value, DEL_OPEN, DEL_CLOSE, atLineStart);
    else out += p.value;
  }
  return out;
}

const html = (text) => ({ type: 'html', block: true, pre: false, raw: text, text });
const blocks = (tokens) => tokens.filter((t) => t.type !== 'space');

/**
 * Mescla os tokens antigo e novo num único fluxo de tokens marcado.
 * @param lex       markdown -> tokens (mesmo lexer/links de referência do documento novo)
 * @param renderOld markdown -> HTML, para blocos removidos (com os links de referência antigos)
 */
export function diffTokens(oldTokens, newTokens, lex, renderOld) {
  const oldB = blocks(oldTokens);
  const newB = blocks(newTokens);
  const src = (t) => t.raw.trim();
  // A chave inclui os destinos resolvidos: mudar só a definição de um link de referência também conta.
  const key = (t) => `${src(t)}\u0000${hrefs(t)}`;
  const out = [];
  let changes = 0;
  let oi = 0;
  let ni = 0;
  let rem = [];
  let add = [];

  const anchor = () => out.push(html(`<span class="diff-anchor" id="alteracao-${++changes}"></span>`));

  // Blocos sem par são agrupados: primeiro tudo o que saiu, depois tudo o que entrou
  // (ex.: uma seção inteira substituída), cada grupo contando como uma alteração.
  let delRun = [];
  let insRun = [];
  const flushRuns = () => {
    if (delRun.length) {
      anchor();
      out.push(html(`<div class="diff-block diff-del">${delRun.map((r) => renderOld(r.raw)).join('')}</div>`));
    }
    if (insRun.length) {
      anchor();
      out.push(html('<div class="diff-block diff-ins">'), ...insRun, html('</div>'));
    }
    delRun = [];
    insRun = [];
  };

  const flush = () => {
    for (let k = 0; k < Math.max(rem.length, add.length); k++) {
      const r = rem[k];
      const a = add[k];
      if (
        r &&
        a &&
        r.type === a.type &&
        WORD_DIFFABLE.has(a.type) &&
        // se um destino de link muda, o bloco é trocado inteiro (marcas dentro de uma URL a quebrariam)
        hrefs(r) === hrefs(a) &&
        similarity(src(r), src(a)) >= MIN_SIMILARITY
      ) {
        flushRuns();
        anchor();
        out.push(...blocks(lex(markupBlock(src(r), src(a)))));
        continue;
      }
      if (r) delRun.push(r);
      if (a) insRun.push(a);
    }
    flushRuns();
    rem = [];
    add = [];
  };

  for (const part of diffArrays(oldB.map(key), newB.map(key))) {
    if (part.removed) rem.push(...oldB.slice(oi, (oi += part.count)));
    else if (part.added) add.push(...newB.slice(ni, (ni += part.count)));
    else {
      flush();
      out.push(...newB.slice(ni, (ni += part.count)));
      oi += part.count;
    }
  }
  flush();
  return { tokens: out, changes };
}

/** Texto para sumário/slug: descarta trechos removidos e as marcas. */
export function cleanMarkers(text) {
  return text.replace(/[^]*/g, '').replace(SENTINELS, '');
}

/** Converte as marcas em <ins>/<del>, fechando e reabrindo em cada tag para manter o HTML válido. */
export function applyMarkers(input) {
  let state = null;
  let out = '';
  for (const seg of input.split(/(<[^>]*>)/)) {
    if (seg.startsWith('<')) {
      const tag = seg.replace(SENTINELS, '');
      out += state ? `</${state}>${tag}<${state} class="diff">` : tag;
      continue;
    }
    for (const ch of seg) {
      if (ch === INS_OPEN || ch === DEL_OPEN) {
        if (state) out += `</${state}>`;
        state = ch === INS_OPEN ? 'ins' : 'del';
        out += `<${state} class="diff">`;
      } else if (ch === INS_CLOSE || ch === DEL_CLOSE) {
        if (state) out += `</${state}>`;
        state = null;
      } else out += ch;
    }
  }
  return out.replace(/<(ins|del) class="diff">(\s*)<\/\1>/g, '$2');
}

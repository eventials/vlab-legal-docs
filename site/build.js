// Gera o site estático dos documentos jurídicos a partir dos .md do repositório.
//
// Convenções:
//   <grupo>/<produto>/<documento>.md                 -> versão vigente
//   <grupo>/<produto>/archive/<documento>/<rótulo>.md -> versões anteriores
//   README.md                                        -> documentação interna (não publicada,
//                                                       mas o título/1º parágrafo nomeiam grupos e produtos)
//
// Frontmatter opcional no topo do .md:
//   ---
//   title: Política de Privacidade
//   version: 2.0
//   effective_date: 2026-11-16
//   status: draft            # "draft" não é publicado
//   ---
//
// Variáveis de ambiente:
//   BASE_PATH  prefixo público do site (padrão "legal" -> /legal/...)
//   SITE_URL   link "voltar ao site" no cabeçalho (padrão "/")
//   SRC_DIR    raiz dos documentos (padrão: raiz do repositório)
//   DIFF_BASE  ref do git a comparar (ex.: origin/master). Quando definido, gera uma
//              prévia de revisão com as alterações destacadas (usado nos PRs).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Marked, Lexer } from 'marked';
import { layout, escapeHtml, formatDate } from './template.js';
import { diffTokens, applyMarkers, cleanMarkers } from './diff.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.env.SRC_DIR || ROOT);
const DIST = join(ROOT, 'dist');
const BASE_SEG = (process.env.BASE_PATH ?? 'legal').replace(/^\/+|\/+$/g, '');
const BASE = BASE_SEG ? `/${BASE_SEG}` : '';
const OUT = join(DIST, BASE_SEG);
const SITE_URL = process.env.SITE_URL || '/';
const DIFF_BASE = process.env.DIFF_BASE || '';
const PREVIEW = Boolean(DIFF_BASE);

if (PREVIEW) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${DIFF_BASE}^{commit}`], { cwd: SRC, stdio: 'ignore' });
  } catch {
    console.error(`✘ DIFF_BASE "${DIFF_BASE}" não existe neste repositório (rode "git fetch origin").`);
    process.exit(1);
  }
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'site', 'worker', 'archive']);

// ---------- utilidades ----------

const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const subdirs = (p) =>
  readdirSync(p)
    .filter((n) => !n.startsWith('.') && !IGNORED_DIRS.has(n) && isDir(join(p, n)))
    .sort();
const mdFiles = (p) =>
  readdirSync(p)
    .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md' && !isDir(join(p, n)))
    .sort();

function parseFrontmatter(src) {
  const m = src.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    const quoted = raw.match(/^(["'])(.*?)\1(?:\s+#.*)?$/);
    const val = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim(); // ignora "# comentário"
    if (key) data[key] = val;
  }
  return { data, body: src.slice(m[0].length) };
}

function slugify(text) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/&[a-z]+;|&#\d+;/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'secao'
  );
}

const stripTags = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Data (AAAA-MM-DD) do último commit que alterou o arquivo, ou null fora do git. */
function gitDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relative(SRC, file)], {
      cwd: SRC,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim() || null;
  } catch {
    return null;
  }
}

/** Título (H1) e primeiro parágrafo de um README, usados para nomear grupos e produtos. */
function readmeInfo(dir, fallback) {
  const file = join(dir, 'README.md');
  if (!existsSync(file)) return { title: fallback, description: '' };
  const tokens = new Marked().lexer(readFileSync(file, 'utf8'));
  const h1 = tokens.find((t) => t.type === 'heading' && t.depth === 1);
  const p = tokens.find((t) => t.type === 'paragraph');
  return { title: h1?.text ?? fallback, description: p ? p.text.replace(/\s+/g, ' ') : '' };
}

/** Conteúdo do arquivo em DIFF_BASE, ou null se ele não existia lá. */
function gitShow(file) {
  try {
    const rel = relative(SRC, file).split('\\').join('/');
    return execFileSync('git', ['show', `${DIFF_BASE}:${rel}`], {
      cwd: SRC,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    return null;
  }
}

// ---------- renderização de markdown ----------

/** Separa o primeiro H1 (vira o título da página e não se repete no corpo). */
function takeTitle(tokens) {
  const i = tokens.findIndex((t) => t.type !== 'space');
  if (i >= 0 && tokens[i].type === 'heading' && tokens[i].depth === 1) return tokens.splice(i, 1)[0].text;
  return null;
}

function renderMarkdown(src, baseSrc = null) {
  const { data, body } = parseFrontmatter(src);
  const toc = [];
  const usedIds = new Set();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const plain = cleanMarkers(stripTags(inner));
        const base = slugify(plain);
        let id = base;
        for (let n = 1; usedIds.has(id); n++) id = `${base}-${n}`;
        usedIds.add(id);
        if (depth === 2) toc.push({ id, text: plain });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
    },
  });

  let tokens = marked.lexer(body);
  const h1 = takeTitle(tokens);
  const title = data.title ?? (h1 ? stripTags(marked.parseInline(h1)) : null);

  let diff = null;
  if (baseSrc !== null) {
    const base = parseFrontmatter(baseSrc);
    const baseTokens = marked.lexer(base.body);
    const baseH1 = takeTitle(baseTokens);
    const oldTitle = base.data.title ?? (baseH1 ? stripTags(marked.parseInline(baseH1)) : null);
    const plain = new Marked({ gfm: true });
    // Blocos reprocessados isoladamente precisam dos links de referência ([x]: url) do seu lado.
    const lexWith = (links) => (md) => {
      const lexer = new Lexer({ gfm: true });
      Object.assign(lexer.tokens.links, links);
      return lexer.lex(md);
    };
    const result = diffTokens(
      baseTokens,
      tokens,
      lexWith(tokens.links),
      (md) => plain.parser(lexWith(baseTokens.links)(md))
    );
    tokens = result.tokens;
    diff = { changes: result.changes, oldData: base.data, oldTitle };
  }

  // envolve tabelas para permitir rolagem horizontal no celular
  let html = marked
    .parser(tokens)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
  if (diff) html = applyMarkers(html);
  return { data, title, html, toc, diff };
}

// ---------- coleta ----------

function loadDoc(file, urlPath, { compare = false } = {}) {
  const baseSrc = compare && PREVIEW ? gitShow(file) : null;
  const { data, title, html, toc, diff } = renderMarkdown(readFileSync(file, 'utf8'), baseSrc);
  let review = null;
  if (compare && PREVIEW) {
    review = baseSrc === null ? { status: 'new' } : { status: diff.changes ? 'changed' : 'unchanged', ...diff };
    const metaChanged =
      diff &&
      ((diff.oldData.version || '') !== (data.version || '') ||
        (diff.oldData.effective_date || '') !== (data.effective_date || '') ||
        (diff.oldTitle || '') !== (title || ''));
    if (review.status === 'unchanged' && metaChanged) {
      review.status = 'changed';
    }
  }
  return {
    review,
    file,
    url: urlPath,
    slug: basename(file, '.md'),
    title: title || basename(file, '.md'),
    version: data.version || null,
    effectiveDate: data.effective_date || null,
    updated: gitDate(file),
    draft: (data.status || '').toLowerCase() === 'draft',
    html,
    toc,
  };
}

function collect() {
  const groups = [];
  for (const g of subdirs(SRC)) {
    const gDir = join(SRC, g);
    const group = { slug: g, url: `${BASE}/${g}/`, ...readmeInfo(gDir, g.toUpperCase()), products: [] };
    for (const p of subdirs(gDir)) {
      const pDir = join(gDir, p);
      const product = { slug: p, url: `${BASE}/${g}/${p}/`, ...readmeInfo(pDir, p), docs: [] };
      for (const f of mdFiles(pDir)) {
        const slug = basename(f, '.md');
        const doc = loadDoc(join(pDir, f), `${product.url}${slug}/`, { compare: true });
        if (doc.draft) continue;
        const archDir = join(pDir, 'archive', slug);
        doc.archive = isDir(archDir)
          ? mdFiles(archDir)
              .map((af) => loadDoc(join(archDir, af), `${doc.url}${basename(af, '.md')}/`))
              .filter((a) => !a.draft)
              .sort((a, b) => (b.effectiveDate || b.slug).localeCompare(a.effectiveDate || a.slug))
          : [];
        product.docs.push(doc);
      }
      if (product.docs.length) group.products.push(product);
    }
    if (group.products.length) groups.push(group);
  }
  return groups;
}

// ---------- páginas ----------

function metaLine(doc) {
  const parts = [];
  if (doc.version) parts.push(`Versão ${escapeHtml(doc.version)}`);
  if (doc.effectiveDate) parts.push(`Vigente desde ${formatDate(doc.effectiveDate)}`);
  if (doc.updated) parts.push(`Atualizado em ${formatDate(doc.updated)}`);
  return parts.join(' · ');
}

function docList(docs) {
  return `<ul class="doc-list">${docs
    .map(
      (d) => `<li><span><a href="${d.url}">${escapeHtml(d.title)}</a>${reviewBadge(d)}</span>${
        metaLine(d) ? `<span class="meta">${metaLine(d)}</span>` : ''
      }</li>`
    )
    .join('')}</ul>`;
}

function reviewBadge(doc) {
  if (doc.review?.status === 'new') return ' <span class="badge badge-new">novo</span>';
  if (doc.review?.status === 'changed') return ' <span class="badge badge-changed">alterado</span>';
  return '';
}

function reviewPanel(doc) {
  const r = doc.review;
  if (!r) return '';
  if (r.status === 'new') return '<div class="review" role="note"><strong>Documento novo.</strong> Ainda não existe na versão publicada.</div>';
  if (r.status === 'unchanged') return '<div class="review review-none" role="note">Sem alterações em relação à versão publicada.</div>';

  const meta = [];
  const from = r.oldData;
  if ((r.oldTitle || '') !== (doc.title || '')) meta.push(`Título: ${escapeHtml(r.oldTitle || '—')} → ${escapeHtml(doc.title)}`);
  if ((from.version || '') !== (doc.version || '')) meta.push(`Versão: ${escapeHtml(from.version || '—')} → ${escapeHtml(doc.version || '—')}`);
  if ((from.effective_date || '') !== (doc.effectiveDate || ''))
    meta.push(`Vigência: ${from.effective_date ? formatDate(from.effective_date) : '—'} → ${doc.effectiveDate ? formatDate(doc.effectiveDate) : '—'}`);
  const links = Array.from({ length: r.changes }, (_, i) => `<a href="#alteracao-${i + 1}">${i + 1}</a>`).join(' ');
  return `<div class="review" role="note">
    <p>${
      r.changes
        ? `<strong>${r.changes} ${r.changes === 1 ? 'alteração' : 'alterações'}</strong> em relação à versão publicada: <span class="review-links">${links}</span>`
        : '<strong>Texto sem alterações.</strong> Mudaram apenas os dados do documento:'
    }</p>
    ${meta.length ? `<p>${meta.join('<br>')}</p>` : ''}
    <p class="review-legend"><ins class="diff">texto adicionado</ins> <del class="diff">texto removido</del>
    <button type="button" class="review-toggle" data-toggle-diff>Ocultar alterações</button></p>
  </div>`;
}

function tocHtml(toc) {
  if (toc.length < 2) return ''; // mesmo critério de hasToc
  return `<nav class="toc" aria-label="Sumário"><p class="toc-title">Nesta página</p><ol>${toc
    .map((t) => `<li><a href="#${t.id}">${escapeHtml(t.text)}</a></li>`)
    .join('')}</ol></nav>`;
}

function docPage(doc, group, product, current = null) {
  const crumbs = [
    { label: 'Documentos jurídicos', url: `${BASE}/` },
    { label: group.title, url: group.url },
    { label: product.title, url: product.url },
  ];
  if (current) crumbs.push({ label: current.title, url: current.url });
  crumbs.push({ label: current ? `Versão ${doc.version || doc.slug}` : doc.title, url: doc.url });

  const banner = current
    ? `<div class="notice" role="note">Esta é uma <strong>versão anterior</strong> e não está mais vigente. <a href="${current.url}">Ver versão vigente</a>.</div>`
    : '';
  const history =
    !current && doc.archive.length
      ? `<section class="history"><h2>Versões anteriores</h2>${docList(doc.archive)}</section>`
      : '';

  return layout({
    base: BASE,
    siteUrl: SITE_URL,
    preview: PREVIEW,
    assets: ASSETS,
    title: doc.title,
    description: `${doc.title} — ${product.title}`,
    crumbs,
    main: `<article class="doc${hasToc(doc) ? ' has-toc' : ''}">
      <header class="doc-header">
        <h1>${escapeHtml(doc.title)}</h1>
        ${metaLine(doc) ? `<p class="meta">${metaLine(doc)}</p>` : ''}
        ${banner}
        ${current ? '' : reviewPanel(doc)}
      </header>
      ${tocHtml(doc.toc)}
      <div class="prose">${doc.html}${history}</div>
    </article>`,
  });
}
const hasToc = (doc) => doc.toc.length >= 2;

function productPage(group, product) {
  return layout({
    base: BASE,
    siteUrl: SITE_URL,
    preview: PREVIEW,
    assets: ASSETS,
    title: product.title,
    description: product.description,
    crumbs: [
      { label: 'Documentos jurídicos', url: `${BASE}/` },
      { label: group.title, url: group.url },
      { label: product.title, url: product.url },
    ],
    main: `<div class="listing"><h1>${escapeHtml(product.title)}</h1>${docList(product.docs)}</div>`,
  });
}

function groupSection(group, headingLevel) {
  const h = headingLevel;
  return group.products
    .map(
      (p) => `<section class="product"><h${h}><a href="${p.url}">${escapeHtml(p.title)}</a></h${h}>${docList(p.docs)}</section>`
    )
    .join('');
}

function groupPage(group) {
  return layout({
    base: BASE,
    siteUrl: SITE_URL,
    preview: PREVIEW,
    assets: ASSETS,
    title: group.title,
    description: group.description,
    crumbs: [
      { label: 'Documentos jurídicos', url: `${BASE}/` },
      { label: group.title, url: group.url },
    ],
    main: `<div class="listing"><h1>${escapeHtml(group.title)}</h1>${
      group.description ? `<p class="lead">${escapeHtml(group.description)}</p>` : ''
    }${groupSection(group, 2)}</div>`,
  });
}

function indexPage(groups) {
  const body = groups.length
    ? groups
        .map(
          (g) => `<section class="group"><h2><a href="${g.url}">${escapeHtml(g.title)}</a></h2>${groupSection(g, 3)}</section>`
        )
        .join('')
    : '<p class="empty">Nenhum documento publicado no momento.</p>';
  return layout({
    base: BASE,
    siteUrl: SITE_URL,
    preview: PREVIEW,
    assets: ASSETS,
    title: 'Documentos jurídicos',
    description: 'Termos de uso, políticas de privacidade e demais documentos jurídicos da V-Lab.',
    crumbs: [],
    main: `<div class="listing"><h1>Documentos jurídicos</h1><p class="lead">Termos de uso, políticas de privacidade e demais documentos que regem os produtos e serviços da V-Lab.</p>${body}</div>`,
  });
}

function notFoundPage() {
  return layout({
    base: BASE,
    siteUrl: SITE_URL,
    preview: PREVIEW,
    assets: ASSETS,
    title: 'Página não encontrada',
    description: '',
    crumbs: [{ label: 'Documentos jurídicos', url: `${BASE}/` }],
    main: `<div class="listing"><h1>Página não encontrada</h1><p class="lead">O documento procurado não existe ou mudou de endereço.</p><p><a href="${BASE}/">Ver todos os documentos</a></p></div>`,
  });
}

// ---------- escrita ----------

function write(urlPath, html) {
  const rel = urlPath.slice(BASE.length).replace(/^\/+/, '');
  const file = join(OUT, rel, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

function copyAssets() {
  const srcDir = join(ROOT, 'site', 'assets');
  const outDir = join(OUT, 'assets');
  mkdirSync(outDir, { recursive: true });
  const map = {};
  for (const name of readdirSync(srcDir)) {
    const content = readFileSync(join(srcDir, name));
    const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
    writeFileSync(join(outDir, name), content);
    map[name] = `${BASE}/assets/${name}?v=${hash}`;
  }
  return map;
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const ASSETS = copyAssets();

const groups = collect();
write(`${BASE}/`, indexPage(groups));
let count = 0;
for (const g of groups) {
  write(g.url, groupPage(g));
  for (const p of g.products) {
    write(p.url, productPage(g, p));
    for (const d of p.docs) {
      write(d.url, docPage(d, g, p));
      count++;
      for (const a of d.archive) write(a.url, docPage(a, g, p, d));
    }
  }
}

writeFileSync(join(DIST, '404.html'), notFoundPage());
if (BASE) writeFileSync(join(DIST, '_redirects'), `/ ${BASE}/ 302\n`);
writeFileSync(
  join(DIST, '_headers'),
  `${BASE}/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n`
);

console.log(`✓ ${count} documento(s) publicado(s) em dist${BASE}/${PREVIEW ? ` (prévia comparando com ${DIFF_BASE})` : ''}`);

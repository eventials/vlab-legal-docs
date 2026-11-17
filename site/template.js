export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-11-16" -> "16 de novembro de 2026" (sem passar por Date, para não sofrer com fuso). */
export function formatDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return escapeHtml(iso);
  return `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}`;
}

export function layout({ base, siteUrl, preview = false, assets, title, description, crumbs, main }) {
  const breadcrumb = crumbs.length
    ? `<nav class="breadcrumb" aria-label="Navegação estrutural"><ol>${crumbs
        .map((c, i) =>
          i === crumbs.length - 1
            ? `<li aria-current="page">${escapeHtml(c.label)}</li>`
            : `<li><a href="${c.url}">${escapeHtml(c.label)}</a></li>`
        )
        .join('')}</ol></nav>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · V-Lab</title>
${description ? `<meta name="description" content="${escapeHtml(description)}">` : ''}
${preview ? '<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="stylesheet" href="${assets['style.css']}">
<script src="${assets['site.js']}" defer></script>
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>
${preview ? '<div class="preview-bar">Prévia para revisão — não é a versão publicada</div>' : ''}
<header class="site-header">
  <div class="container">
    <a class="brand" href="${base}/">V-Lab <span>Documentos jurídicos</span></a>
    <a class="back" href="${escapeHtml(siteUrl)}">Voltar ao site</a>
  </div>
</header>
<main id="conteudo" class="container">
${breadcrumb}
${main}
</main>
<footer class="site-footer">
  <div class="container">© ${new Date().getFullYear()} V-Lab. Todos os direitos reservados.</div>
</footer>
</body>
</html>
`;
}

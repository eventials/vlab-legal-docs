// Destaca no sumário a seção que está sendo lida. Opcional: o site funciona sem JS.
(() => {
  const links = new Map(
    [...document.querySelectorAll('.toc a[href^="#"]')].map((a) => [decodeURIComponent(a.hash.slice(1)), a])
  );
  if (!links.size || !('IntersectionObserver' in window)) return;

  let current = null;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        current?.classList.remove('active');
        current = links.get(e.target.id);
        current?.classList.add('active');
      }
    },
    { rootMargin: '0px 0px -75% 0px' }
  );
  for (const id of links.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
})();

// Prévia de revisão: alterna entre ver as alterações e o texto final limpo.
document.querySelectorAll('[data-toggle-diff]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('hide-diff');
    document.querySelectorAll('[data-toggle-diff]').forEach((b) => {
      b.textContent = hidden ? 'Mostrar alterações' : 'Ocultar alterações';
    });
  });
});

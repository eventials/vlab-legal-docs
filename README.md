# Documentos Jurídicos V-Lab

Repositório oficial para gestão e versionamento dos documentos
jurídicos dos produtos e serviços da V-Lab.

## Finalidade

Este repositório oferece uma fonte centralizada, rastreável e
versionada da documentação jurídica, incluindo:

- Termos de Uso
- Políticas de Privacidade
- Acordos de Tratamento de Dados
- Acordos de Nível de Serviço
- Outros documentos jurídicos aplicáveis

## Estrutura

Os documentos jurídicos são organizados por público e produto.

### Business-to-Business (B2B)

Documentação jurídica para organizações de saúde, clínicas,
hospitais, médicos e demais clientes corporativos.

- [Plataforma de Gravação](b2b/recording-platform/)
- [Portal de Resultados](b2b/results-portal/)

### Business-to-Consumer (B2C)

Documentação jurídica para pacientes e usuários individuais.

- [Aplicativo V-Baby](b2c/vbaby-app/)
- [Baby Shower](b2c/baby-shower/)

## Gestão de Documentos

Cada produto mantém a documentação jurídica que lhe é aplicável.

Os documentos devem conter:

- Título do documento
- Identificador de versão
- Data de vigência
- Data de publicação, quando disponível
- Status do documento

Documentos substituídos devem ser preservados para fins de
referência histórica e auditabilidade.

## Versionamento

Cada documento jurídico é versionado de forma independente.

O histórico do Git fornece a rastreabilidade das alterações,
enquanto as versões do documento identificam os termos aplicáveis
em um determinado período.

## Governança

Alterações em documentos jurídicos devem ser revisadas e aprovadas
pelas partes interessadas autorizadas antes da publicação.

O repositório é a fonte da verdade para o conteúdo jurídico aprovado.

## Idioma

A estrutura do repositório e os nomes de arquivos e diretórios são
mantidos em inglês.

A documentação técnica (arquivos README) é mantida em português
do Brasil.

Os documentos jurídicos podem ser redigidos em português ou em
outros idiomas, conforme o público a que se destinam.

## Publicação

Todo merge na `master` publica automaticamente os documentos em
`/legal` do site institucional (GitHub Actions → Cloudflare Workers).
Pull requests geram uma URL de preview para revisão antes do merge.

### Como publicar ou atualizar um documento

1. No Google Docs, resolver todas as sugestões e comentários pendentes.
2. Exportar em **Arquivo → Fazer download → Markdown (.md)**.
3. Se já existir uma versão vigente, movê-la para
   `<produto>/archive/<documento>/<data-de-vigência>.md`.
4. Salvar o novo arquivo como `<produto>/<documento>.md`
   (ex.: `b2c/vbaby-app/privacy-policy.md`) e adicionar o cabeçalho:

   ```markdown
   ---
   version: 2.0
   effective_date: 2026-11-16
   ---
   ```

5. Abrir um pull request, revisar o preview e, após aprovação, fazer o merge.

O link de preview é comentado automaticamente no pull request. Nele, as
alterações em relação à versão publicada aparecem destacadas (texto
adicionado em verde, removido em vermelho), com navegação entre as
alterações e um botão para ver o texto final sem marcações. Para gerar
essa prévia localmente: `DIFF_BASE=origin/master npm run serve`.

Observações:

- O nome do arquivo define a URL e não deve mudar depois de publicado.
- O primeiro título (`# ...`) do documento vira o título da página; os
  títulos de nível 2 (`## ...`) formam o sumário lateral.
- `status: draft` no cabeçalho impede a publicação do arquivo.
- Arquivos `README.md` não são publicados.

### Desenvolvimento local

```bash
npm install
npm run serve   # http://localhost:4000/legal/
```

### Infraestrutura

- `site/`: gerador do site (Node + `marked`), template, CSS e JS.
- `wrangler.toml`: Cloudflare Worker com static assets que serve o
  conteúdo de `dist/` e responde em `/legal/*` do domínio institucional.
- `.github/workflows/publish.yml`: build e deploy do Worker
  (secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`).

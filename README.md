# SnipStashi

Extensão Chrome para salvar e reutilizar textos, fórmulas e trechos de código.

Os dados ficam em `chrome.storage.local` neste aparelho. Em **Configurações** você pode:

- **Google Drive (opcional)** — sincronizar snips entre aparelhos no Drive da pessoa
- **Exportar / importar backup** — arquivo JSON local (sempre disponível)

Sem conectar o Drive, nada sai do Chrome.

## Instalar (desenvolvimento / GitHub)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. **Carregar sem compactação** → esta pasta (`SnipStashi`)
4. (Opcional) Hot-reload: na raiz do repo, rode `npm run watch`

ID estável da extensão (chave no `manifest.json`): `ldpfoicanhfekcjlgeafppffcebapchb`

## Sync com Google Drive

1. Em **Configurações → Google Drive**, toque em **Conectar Google Drive**
2. Autorize o Google (OAuth)
3. A extensão cria `Meu Drive / Chrome Extensions / SnipStashi / snipstashi-sync.json`
4. Sync em background (ao salvar, ao abrir o popup, e a cada ~15 min)

Merge por `id` + `updatedAt` (com tombstones para exclusões). O storage local continua como cache rápido.

### Configurar OAuth (obrigatório uma vez, por projeto Google Cloud)

1. [Google Cloud Console](https://console.cloud.google.com/) → projeto
2. Ative a **Google Drive API**
3. Tela de consentimento OAuth (Externo) + **Usuários de teste**
4. Credenciais → ID do cliente OAuth → tipo **Extensão do Chrome**
   - ID do item: `ldpfoicanhfekcjlgeafppffcebapchb`
5. Cole o Client ID em `manifest.json` → `oauth2.client_id`
6. Recarregue a extensão

Escopo `drive.file`: só arquivos criados pela própria extensão.

## Pacote para a Chrome Web Store (opcional)

```bash
npm run pack
```

Gera:

- `dist/snipstashi/` — pasta limpa (sem localhost / hot-reload)
- `dist/snipstashi.zip` — upload na [Developer Dashboard](https://chrome.google.com/webstore/devconsole)

A loja exige taxa única de desenvolvedor (US$ 5) e URL pública de privacidade (`docs/privacy.html`).

## Privacidade

Ver `docs/privacy.html`.

## Dados e migração

- Não renomeie a chave `fichario_data_v1` sem migração
- Mudanças de esquema passam por `migrateData()` em `storage.js`
- Antes de reinstalar / limpar o Chrome: exporte backup (ou use Drive sync)

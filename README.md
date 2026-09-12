<img width="300" height="300" alt="full-logo (4)" src="https://github.com/user-attachments/assets/54a429e6-6897-4a3f-ba57-279dd1bd123c" />


# SnipStashi

Extensão Chrome para salvar e reutilizar textos, fórmulas, trechos de código e qualquer outro texto que você sempre precise retilizar.

Os dados ficam em `chrome.storage.local` neste aparelho. Em **Configurações** você pode:

- **Google Drive (opcional)** — sincronizar snips entre aparelhos no Drive da pessoa
- **Exportar / importar backup** — arquivo JSON local (sempre disponível)

## Instalar (desenvolvimento / GitHub)

1. Abra `chrome://extensions`
2. Ative **Modo do desenvolvedor**
3. **Carregar sem compactação** → esta pasta (`SnipStashi`)
4. (Opcional) Hot-reload: na raiz do repo, rode `npm run watch`

## Sync com Google Drive

1. Em **Configurações → Google Drive**, toque em **Conectar Google Drive**
2. Autorize o Google (OAuth)
3. A extensão cria `Meu Drive / Chrome Extensions / SnipStashi / snipstashi-sync.json`
4. Sync em background (ao salvar, ao abrir o popup, e a cada ~15 min)

importScripts("storage.js", "drive-sync.js");

const MENU_ID = "fichario-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Salvar "%s" no SnipStashi',
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = (info.selectionText || "").trim();
  if (!text) return;

  const data = await loadData();
  const defaultTagId = data.settings.defaultTagId;
  const item = await addItem({
    text,
    tagIds: defaultTagId ? [defaultTagId] : []
  });

  notify(item);
});

function notify(item) {
  const preview = item.text.length > 60 ? item.text.slice(0, 60) + "…" : item.text;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Salvo no SnipStashi",
    message: preview
  });
}

initDriveSyncListeners();

/* Dev hot-reload — só carrega se o arquivo existir (desenvolvimento local). */
try {
  importScripts("dev-reload.js");
} catch (_) {
  // pacote de produção não inclui dev-reload.js
}

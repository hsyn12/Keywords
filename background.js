const STORAGE_KEY = 'tabMatchCounts_session';

// Yardımcı fonksiyon: Storage'dan tüm sayaçları almak için
async function getStoredCounts() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    return result[STORAGE_KEY] || {};
  } catch (error) {
    console.error("[BG] Error getting counts from session storage:", error);
    return {};
  }
}

async function getCount(tabId) {
  const storedCounts = await getStoredCounts();
  return storedCounts[tabId] || 0;
}

async function saveCount(tabId, count) {
  const storedCounts = await getStoredCounts();
  storedCounts[tabId] = count;
  await saveCountsToStorage(storedCounts);
}

// Yardımcı fonksiyon: Storage'a tüm sayaçları kaydetmek için
async function saveCountsToStorage(counts) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: counts });
    // console.log("[BG] Counts saved to session storage:", counts); // Debug için
    return true;
  } catch (error) {
    console.error("[BG] Error saving counts to session storage:", error);
    return false;
  }
}

// Listen for extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed or updated');
  // Initialize default settings if not already set
  chrome.storage.local.get(['keywords', 'highlightColor', 'isActive'], (result) => {
    if (!result.keywords) {
      chrome.storage.local.set({
        keywords: ['Fun'],
        highlightColor: '#ffeb3b',
        isActive: true
      });
    }
  });

  chrome.storage.session.remove(STORAGE_KEY);
});

function getState(sendResponse) {
  const response = {};
  chrome.storage.local.get(['keywords', 'highlightColor', 'isActive'], (result) => {
    response.keywords = result.keywords || []
    response.highlightColor = result.highlightColor || '#ffeb3b'
    response.isActive = typeof result.isActive !== 'undefined' ? result.isActive : true
    sendResponse(response);
  });
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Check if runtime has any error
  if (chrome.runtime.lastError) {
    console.error('Runtime error:', chrome.runtime.lastError.message);
    return;
  }

  // Handle messages from popup
  if (message.type === 'GET_STATE') {
    getState(sendResponse);
    return true; // Required for async response
  }
  else if (message.type === 'UPDATE_MATCH_COUNT' && sender.tab) {
    (async () => {
      try {
        await saveCount(sender.tab.id, message.count);
        await updateBadge(sender.tab.id);
        sendResponse({ success: true }); // Send response back to content script
      } catch (error) {
        console.error('[BG] Error handling match count update:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep the message port open for async response
  }
  console.log('No handler found for message type:', message.type);
});

// updateBadge fonksiyonunu storage kullanacak şekilde güncelle
async function updateBadge(tabId) {
  if (!tabId) {
    // Aktif sekmeyi bulup onun ID'sini kullanabiliriz ama onActivated zaten ID veriyor.
    // Belki başlangıç durumu için?
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id) {
      tabId = activeTab.id;
    } else return; // ID yoksa çık

  }
  const count = await getCount(tabId);
  try {
    await chrome.action.setBadgeText({ text: count.toString(), tabId: tabId });
    await chrome.action.setBadgeBackgroundColor({
      color: count > 0 ? '#4CAF50' : '#FFF59D',
      tabId: tabId
    });
  } catch (error) {
    // Özellikle sekme kapandıysa veya ID geçersizse bu hata olabilir.
    if (!error.message.includes("No tab with id")) { // Sık görülen hatayı göz ardı et
      console.error(`[BG] Error setting badge in updateBadge for tab ${tabId}:`, error);
    } else {
      // console.log(`[BG] Ignoring badge error for likely closed tab ${tabId}`);
      // Kapandıysa storage'dan temizle
      removeCountFromStorage(tabId);
    }
  }
}

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removeCountFromStorage(tabId);
});

// Update count when tab is updated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') { // Trigger when tab update is complete
    removeCountFromStorage(tabId);
    
    // Delay the rehighlight message slightly to ensure content script is ready
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'REHIGHLIGHT_TAB' }, response => {
        const lastError = chrome.runtime.lastError;
        if (lastError && 
            !lastError.message.includes('receiving end does not exist') &&
            !lastError.message.includes('context invalidated')) {
          console.error('Error sending rehighlight message:', lastError);
        }
      });
    }, 250);
  }
});

// Update badge when switching tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateBadge(activeInfo.tabId);
});

async function removeCountFromStorage(tabId) {
  const storedCounts = await getStoredCounts();
  if (storedCounts[tabId]) {
    delete storedCounts[tabId];
    saveCountsToStorage(storedCounts);
  }
}
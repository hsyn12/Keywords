const STORAGE_KEY = 'tabKeywordCounts_session'; // Renamed key for clarity

// Helper function: Get all keyword count objects from storage
async function getStoredKeywordCounts() {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    // Ensure we return an object, even if storage is empty or corrupt
    return typeof result[STORAGE_KEY] === 'object' && result[STORAGE_KEY] !== null ? result[STORAGE_KEY] : {};
  } catch (error) {
    console.error("[BG] Error getting keyword counts from session storage:", error);
    return {}; // Return empty object on error
  }
}

// Get the TOTAL count for the badge by summing individual keyword counts
async function getTotalCountForBadge(tabId) {
  const storedKeywordCounts = await getStoredKeywordCounts();
  const tabCounts = storedKeywordCounts[tabId]; // This is the object like { "keyword1": 2, "keyword2": 5 }
  if (tabCounts && typeof tabCounts === 'object') {
    // Sum the values of the counts object
    return Object.values(tabCounts).reduce((sum, count) => sum + (Number(count) || 0), 0);
  }
  return 0; // Return 0 if no counts found for the tab
}

// Get the detailed keyword counts object for a specific tab
async function getKeywordCountsForTab(tabId) {
    const storedKeywordCounts = await getStoredKeywordCounts();
    return storedKeywordCounts[tabId] || {}; // Return the object or an empty one
}


// Save the keyword counts object for a specific tab
async function saveKeywordCounts(tabId, keywordCountsObject) {
  if (!tabId) {
      console.warn("[BG] Attempted to save counts without a tabId.");
      return;
  }
  const allStoredCounts = await getStoredKeywordCounts();
  allStoredCounts[tabId] = keywordCountsObject; // Store the object directly
  await saveAllCountsToStorage(allStoredCounts);
}

// Helper function: Save the entire counts object (all tabs) to storage
async function saveAllCountsToStorage(allCounts) {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: allCounts });
    // console.log("[BG] Keyword counts saved to session storage:", allCounts); // Debug for keyword counts
    return true;
  } catch (error) {
    console.error("[BG] Error saving keyword counts to session storage:", error);
    return false;
  }
}

// Clear storage for the specific key on installation/update

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
  // Clear the specific storage key used by this version
  chrome.storage.session.remove(STORAGE_KEY, () => {
      if (chrome.runtime.lastError) {
          console.error("[BG] Error clearing session storage on install:", chrome.runtime.lastError);
      } else {
          console.log("[BG] Session storage cleared for key:", STORAGE_KEY);
      }
  });
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
    return true; // Required for async response for GET_STATE
  }
  else if (message.type === 'UPDATE_MATCH_COUNT' && sender.tab?.id) {
    // Now expects message.counts (the object)
    (async () => {
      try {
        // Validate that message.counts is an object
        if (typeof message.counts === 'object' && message.counts !== null) {
          await saveKeywordCounts(sender.tab.id, message.counts); // Save the object
          await updateBadge(sender.tab.id); // Update badge based on total
          sendResponse({ success: true });
        } else {
          console.warn('[BG] Received invalid counts data type:', typeof message.counts);
          sendResponse({ success: false, error: 'Invalid counts data received' });
        }
      } catch (error) {
        console.error('[BG] Error handling keyword counts update:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep the message port open for async response
  }
  // New handler for popup to get counts for the active tab
  else if (message.type === 'GET_KEYWORD_COUNTS' && message.tabId) {
    (async () => {
        try {
            const counts = await getKeywordCountsForTab(message.tabId);
            sendResponse({ success: true, counts: counts });
        } catch (error) {
            console.error(`[BG] Error getting keyword counts for tab ${message.tabId}:`, error);
            sendResponse({ success: false, error: error.message });
        }
    })();
    return true; // Async response
  }
  // Optional: Log unhandled messages for debugging
  // else {
  //   console.log('[BG] No handler found for message type:', message.type, 'from:', sender.tab ? `Tab ${sender.tab.id}` : 'Popup/Other');
  // }
});


// updateBadge fonksiyonunu storage kullanacak şekilde güncelle
async function updateBadge(tabId) {
  if (!tabId) {
    // Aktif sekmeyi bulup onun ID'sini kullanabiliriz ama onActivated zaten ID veriyor.
    // Belki başlangıç durumu için?
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.id) {
      tabId = activeTab.id;
    } else {
        // console.warn("[BG] updateBadge called without tabId and couldn't find active tab.");
        return; // ID yoksa çık
    }
  }
  // Get the total count calculated from the stored object
  const totalCount = await getTotalCountForBadge(tabId);
  // console.log(`[BG] Updating badge for tab ${tabId} with total count: ${totalCount}`); // Debug badge update
  try {
    // Ensure count is a string for setBadgeText
    const badgeText = totalCount > 0 ? String(totalCount) : ''; // Show empty string for 0
    await chrome.action.setBadgeText({ text: badgeText, tabId: tabId });
    // Set background color based on whether there are *any* matches
    await chrome.action.setBadgeBackgroundColor({
      color: totalCount > 0 ? '#4CAF50' : '#9E9E9E', // Green if matches, Grey if none
      tabId: tabId
    });
  } catch (error) {
    // Handle errors, especially if the tab was closed
    if (error.message.includes("Invalid tab ID") || error.message.includes("No tab with id")) {
      // console.log(`[BG] Ignoring badge error for likely closed tab ${tabId}`);
      // Clean up storage if the tab is gone
      removeCountsFromStorage(tabId);
    } else {
      console.error(`[BG] Error setting badge in updateBadge for tab ${tabId}:`, error);
    }
  }
}

// Clean up storage when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  // console.log(`[BG] Tab ${tabId} removed, cleaning up storage.`);
  removeCountsFromStorage(tabId);
});

// Handle tab updates (e.g., navigation within the same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // We only care about status changes, particularly 'loading' or 'complete'
  // 'loading' is a good time to clear old counts for the tab
  if (changeInfo.status === 'loading') {
    // console.log(`[BG] Tab ${tabId} started loading, clearing old counts.`);
    removeCountsFromStorage(tabId);
    // Reset badge immediately on navigation start
    try {
        chrome.action.setBadgeText({ text: '', tabId: tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#9E9E9E', tabId: tabId });
    } catch (error) {
        // Ignore errors if tab closed quickly
        if (!error.message.includes("Invalid tab ID") && !error.message.includes("No tab with id")) {
            console.error(`[BG] Error resetting badge on loading for tab ${tabId}:`, error);
        }
    }
  }
  // When loading is complete, ask content script to re-highlight
  else if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    // console.log(`[BG] Tab ${tabId} finished loading, requesting rehighlight.`);
    // No need to remove counts here again, done at 'loading'
    // Delay slightly to ensure content script is ready
    setTimeout(() => {
      // Check if the tab still exists before sending the message
      chrome.tabs.get(tabId, (existingTab) => {
        if (chrome.runtime.lastError || !existingTab) {
          // console.log(`[BG] Tab ${tabId} closed before rehighlight message could be sent.`);
          return; // Tab closed, do nothing
        }
        // Send message if tab still exists
        chrome.tabs.sendMessage(tabId, { type: 'REHIGHLIGHT_TAB' }, response => {
          const lastError = chrome.runtime.lastError;
          if (lastError &&
              !lastError.message.includes('Receiving end does not exist') && // Common benign error
              !lastError.message.includes('Could not establish connection') && // Another common one
              !lastError.message.includes('context invalidated') &&
              !lastError.message.includes('The message port closed before a response was received')) { // Ignore this error too
            console.error(`[BG] Error sending REHIGHLIGHT_TAB to tab ${tabId}:`, lastError.message);
          } else if (response && response.success === false) {
            console.warn(`[BG] Content script reported failure on rehighlight for tab ${tabId}:`, response.error);
          }
          // else { console.log(`[BG] Rehighlight message sent to tab ${tabId}.`); } // Optional success log
        });
      });
    }, 300); // Slightly increased delay
  }
  // Also update badge if title changes, as this might indicate SPA navigation
  // without a full page load, though content script observer should handle DOM changes.
  // else if (changeInfo.title) {
  //    updateBadge(tabId);
  // }
});

// Update badge when switching tabs
chrome.tabs.onActivated.addListener(activeInfo => {
  // console.log(`[BG] Tab ${activeInfo.tabId} activated.`);
  updateBadge(activeInfo.tabId);
});

// Remove the counts object for a specific tab from storage
async function removeCountsFromStorage(tabId) {
  if (!tabId) return;
  const allStoredCounts = await getStoredKeywordCounts();
  if (allStoredCounts.hasOwnProperty(tabId)) {
    // console.log(`[BG] Removing counts for tab ${tabId} from storage.`);
    delete allStoredCounts[tabId];
    await saveAllCountsToStorage(allStoredCounts);
  } else {
    // console.log(`[BG] No counts found in storage for tab ${tabId} to remove.`);
  }
}

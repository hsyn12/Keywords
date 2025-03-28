// Store DOM elements
const keywordInput = document.getElementById('keywordInput');
const addButton = document.getElementById('addKeyword');
const keywordList = document.getElementById('keywordList');
const highlightColor = document.getElementById('highlightColor');
const activeToggle = document.getElementById('activeToggle');
let activeTabId = null; // To store the active tab ID

// --- Helper Functions ---
// Function to get the active tab ID
async function getActiveTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  } catch (error) {
    console.error("Error getting active tab:", error);
    return null;
  }
}

// Function to request and update keyword counts
async function fetchAndUpdateCounts() {
  if (!activeTabId) {
    activeTabId = await getActiveTabId();
  }
  if (!activeTabId) {
    console.warn("Could not get active tab ID to fetch counts.");
    // Optionally clear existing counts in UI
    updateKeywordCountsUI({});
    return;
  }

  // console.log(`[POPUP] Requesting counts for tab ${activeTabId}`);
  chrome.runtime.sendMessage({ type: 'GET_KEYWORD_COUNTS', tabId: activeTabId }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting keyword counts:', chrome.runtime.lastError.message);
      updateKeywordCountsUI({}); // Clear counts on error
      return;
    }
    if (response && response.success) {
      // console.log("[POPUP] Received counts:", response.counts);
      updateKeywordCountsUI(response.counts || {});
    } else {
      console.error("Failed to get keyword counts:", response?.error);
      updateKeywordCountsUI({}); // Clear counts on failure
    }
  });
}

// --- Initialization ---
// Get initial state (keywords, color, active status) and then fetch counts
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Error getting initial state:', chrome.runtime.lastError.message);
    // Still try to fetch counts even if state fails? Maybe not.
    return;
  }

  // Populate UI with saved settings
  if (response.keywords) {
    // Clear existing list before adding, just in case
    keywordList.innerHTML = '';
    response.keywords.forEach(keyword => addKeywordToList(keyword));
  }
  if (response.highlightColor) {
    highlightColor.value = response.highlightColor;
  }
  if (typeof response.isActive !== 'undefined') {
    activeToggle.checked = response.isActive;
  }

  // After setting up the keyword list, fetch the counts for the active tab
  fetchAndUpdateCounts();
});


// --- Event Listeners ---
// Add keyword when button is clicked or Enter is pressed
addButton.addEventListener('click', handleAddKeyword);
keywordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleAddKeyword();
  }
});

// Handle color changes
highlightColor.addEventListener('change', () => {
  chrome.storage.local.set({ highlightColor: highlightColor.value }, () => {
      if (chrome.runtime.lastError) {
          console.error("Error saving color:", chrome.runtime.lastError);
      } else {
          // Color change doesn't require re-fetching counts, just re-highlighting
          triggerContentUpdate();
      }
  });
});

// Handle toggle changes
activeToggle.addEventListener('change', () => {
  chrome.storage.local.set({ isActive: activeToggle.checked }, () => {
      if (chrome.runtime.lastError) {
          console.error("Error saving active state:", chrome.runtime.lastError);
      } else {
          // Toggle change requires re-highlighting (or clearing)
          triggerContentUpdate();
      }
  });
});


// --- UI Update Functions ---
function handleAddKeyword() {
  const keyword = keywordInput.value.trim();
  // Prevent adding duplicates (case-insensitive check)
  const existingKeywords = Array.from(keywordList.querySelectorAll('.keyword-text')).map(span => span.textContent.toLowerCase());
  if (keyword && !existingKeywords.includes(keyword.toLowerCase())) {
    addKeywordToList(keyword); // Add visually
    saveKeywordsAndUpdate(); // Save and trigger content update
    keywordInput.value = '';
  } else if (existingKeywords.includes(keyword.toLowerCase())) {
      // Optional: Provide feedback that keyword already exists
      console.log(`Keyword "${keyword}" already exists.`);
      keywordInput.select(); // Highlight input for easy replacement
  } else {
      // Optional: Feedback for empty input
      console.log("Keyword cannot be empty.");
  }
}

function addKeywordToList(keyword) {
  const item = document.createElement('div');
  item.className = 'keyword-item';
  // Add data attribute to easily find the item later
  item.dataset.keyword = keyword;
  item.innerHTML = `
    <span title="${keyword}" class="keyword-text">${keyword}</span>
    <div class="controls">
      <span class="keyword-count">--</span>
      <button class="remove-keyword" title="Remove keyword">&times;</button>
    </div>
  `;

  item.querySelector('.remove-keyword').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent triggering other listeners if any
    item.remove();
    saveKeywordsAndUpdate(); // Save and trigger update after removal
  });

  keywordList.appendChild(item);
}

// Updates the count display next to each keyword
function updateKeywordCountsUI(counts) {
  // console.log("[POPUP] Updating UI with counts:", counts);
  const items = keywordList.querySelectorAll('.keyword-item');
  items.forEach(item => {
    const keyword = item.dataset.keyword;
    const countSpan = item.querySelector('.keyword-count');
    if (countSpan) {
      // Use Number() to handle potential non-number values gracefully
      const count = Number(counts[keyword]) || 0;
      countSpan.textContent = count;
      // Optional: Add styling based on count
      countSpan.style.fontWeight = count > 0 ? 'bold' : 'normal';
      countSpan.style.color = count > 0 ? '#007bff' : '#6c757d'; // Blue if > 0, grey otherwise
    }
  });
}


// --- Data Saving and Content Script Update ---
// Saves keywords to storage and notifies content script
function saveKeywordsAndUpdate() {
  const keywords = Array.from(keywordList.querySelectorAll('.keyword-text'))
    .map(span => span.textContent);

  chrome.storage.local.set({ keywords }, () => {
    if (chrome.runtime.lastError) {
        console.error("Error saving keywords:", chrome.runtime.lastError);
        return;
    }
    // console.log("[POPUP] Keywords saved:", keywords);
    // After saving, trigger content script update and re-fetch counts
    triggerContentUpdate();
    // Re-fetch counts as the keyword list changed
    fetchAndUpdateCounts();
  });
}

// Sends message to content script to update highlights
async function triggerContentUpdate() {
    if (!activeTabId) {
        activeTabId = await getActiveTabId();
    }
    if (!activeTabId) {
        console.warn("Cannot trigger content update, no active tab ID.");
        return;
    }

    const keywords = Array.from(keywordList.querySelectorAll('.keyword-text'))
                      .map(span => span.textContent);
    const color = highlightColor.value;
    const isActive = activeToggle.checked;

    // console.log(`[POPUP] Sending UPDATE_KEYWORDS to tab ${activeTabId}`);
    chrome.tabs.sendMessage(activeTabId, {
        type: 'UPDATE_KEYWORDS',
        keywords,
        color,
        isActive
    }, response => {
        if (chrome.runtime.lastError) {
            // Handle common errors gracefully (e.g., content script not ready yet)
            if (!chrome.runtime.lastError.message.includes("Receiving end does not exist") &&
                !chrome.runtime.lastError.message.includes("Could not establish connection")) {
                console.error('Error sending update to content script:', chrome.runtime.lastError.message);
            }
        } else if (response && response.success === false) {
            console.warn("Content script reported failure on update:", response.error);
        }
        // Optional: Log success
        // else { console.log("[POPUP] Content script acknowledged update."); }
    });
}


// --- Initial Setup ---
// Ensure activeTabId is fetched early if possible
(async () => {
    activeTabId = await getActiveTabId();
    // If the popup is opened *before* the initial state message returns,
    // we might already have the tab ID needed for fetchAndUpdateCounts.
    // If fetchAndUpdateCounts was already called by the GET_STATE callback,
    // this won't hurt.
    if (keywordList.children.length > 0 && !document.querySelector('.keyword-count').textContent.match(/\d/)) {
       // If list is populated but counts look default ('--'), try fetching again.
       // console.log("[POPUP] Re-fetching counts on initial load check.");
       // fetchAndUpdateCounts(); // Might be redundant if GET_STATE is fast
      }
    // Removed extra }); } here
})();

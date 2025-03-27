// Store DOM elements
const keywordInput = document.getElementById('keywordInput');
const addButton = document.getElementById('addKeyword');
const keywordList = document.getElementById('keywordList');
const highlightColor = document.getElementById('highlightColor');
const activeToggle = document.getElementById('activeToggle');

// Request initial state from background script
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Error getting state:', chrome.runtime.lastError);
    return;
  }
  
  if (response.keywords) {
    response.keywords.forEach(keyword => addKeywordToList(keyword));
  }
  if (response.highlightColor) {
    highlightColor.value = response.highlightColor;
  }
  if (typeof response.isActive !== 'undefined') {
    activeToggle.checked = response.isActive;
  }
});

// Add keyword when button is clicked or Enter is pressed
addButton.addEventListener('click', addKeyword);
keywordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addKeyword();
  }
});

function addKeyword() {
  const keyword = keywordInput.value.trim();
  if (keyword) {
    addKeywordToList(keyword);
    saveKeywords();
    keywordInput.value = '';
  }
}

function addKeywordToList(keyword) {
  const item = document.createElement('div');
  item.className = 'keyword-item';
  item.innerHTML = `
    <span>${keyword}</span>
    <button class="remove-keyword">Remove</button>
  `;

  item.querySelector('.remove-keyword').addEventListener('click', () => {
    item.remove();
    saveKeywords();
  });

  keywordList.appendChild(item);
}

function saveKeywords() {
  const keywords = Array.from(keywordList.querySelectorAll('.keyword-item span'))
    .map(span => span.textContent);
  
  chrome.storage.local.set({ keywords }, () => {
    // Notify content script to update highlights
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'UPDATE_KEYWORDS',
          keywords,
          color: highlightColor.value,
          isActive: activeToggle.checked
        });
      }
    });
  });
}

// Handle color changes
highlightColor.addEventListener('change', () => {
  chrome.storage.local.set({ highlightColor: highlightColor.value });
  saveKeywords(); // This will trigger a highlight update
});

// Handle toggle changes
activeToggle.addEventListener('change', () => {
  chrome.storage.local.set({ isActive: activeToggle.checked });
  saveKeywords(); // This will trigger a highlight update
});
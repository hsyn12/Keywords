// Initialize variables to store settings
let keywords = [];
let highlightColor = '#ffeb3b';
let isActive = true;
let observer; // Added global observer declaration
let initialHighlightComplete = false; // Added initial highlight flag
let observerDebounceTimer = null; // Added global debounce timer
const log = console.log;

// Load saved settings when content script starts
chrome.storage.local.get(['keywords', 'highlightColor', 'isActive'], (result) => {
  if (result.keywords) keywords = result.keywords;
  if (result.highlightColor) highlightColor = result.highlightColor;
  if (typeof result.isActive !== 'undefined') isActive = result.isActive;
  
  // Initial highlight
  if (isActive) highlightKeywords();
  initialHighlightComplete = true;
  setupObserver(); // Added call to initialize the observer on page load
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === 'UPDATE_KEYWORDS') {
      keywords = message.keywords;
      highlightColor = message.color;
      isActive = message.isActive;
      
      // Remove existing highlights
      removeHighlights();
      
      // Apply new highlights if active
      if (isActive) highlightKeywords();
    } else if (message.type === 'REHIGHLIGHT_TAB') {
      if (!chrome.runtime?.id) {
        console.warn('Ignoring rehighlight request - extension context invalid');
        return;
      }
      removeHighlights();
      if (isActive) highlightKeywords();
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

// Function to highlight keywords
function highlightKeywords() {
  try {
    // Get all text nodes in the body
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      // Skip if node is in a script, style, or already highlighted element
      if (!isInSkippableElement(node)) {
        textNodes.push(node);
      }
    }

    let totalMatches = 0;

    // Process each text node
    textNodes.forEach(node => {
      let text = node.textContent;
      let matches = false;

      // Try each keyword/regex pattern
      for (const keyword of keywords) {
        try {
          const regex = new RegExp(keyword, 'gi');
          const matchResult = text.match(regex);
          if (matchResult) {
            matches = true;
            totalMatches += matchResult.length;
            text = text.replace(regex, match => 
              `<mark class="keyword-highlight" style="background-color: ${highlightColor}">${match}</mark>`
            );
          }
        } catch (e) {
          console.error('Invalid regex pattern:', keyword);
        }
      }

      // If we found matches, replace the text node with highlighted HTML
      if (matches) {
        const span = document.createElement('span');
        span.innerHTML = text;
        node.parentNode.replaceChild(span, node);
      }
    });

    // Send total matches count to background script with retry
    const MAX_RETRIES = 3;
    const sendMatchCount = async (retryCount = 0) => {
      try {
        if (!chrome.runtime?.id) {
          throw new Error('Extension context invalidated');
        }
        
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'UPDATE_MATCH_COUNT', count: totalMatches },
            response => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(response);
              }
            }
          );
        });
      } catch (error) {
        if (retryCount < MAX_RETRIES && !error.message.includes('Extension context invalidated')) {
          await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
          return sendMatchCount(retryCount + 1);
        }
        throw error;
      }
    };

    sendMatchCount().catch(error => {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('Extension context invalid - page reload may be required');
      } else {
        console.error('Failed to send match count:', error);
      }
    });

  } catch (error) {
    console.error('Error in highlightKeywords:', error);
  }
}

// Function to check if node is in an element we should skip
function isInSkippableElement(node) {
  let parent = node.parentNode;
  while (parent) {
    const tagName = parent.tagName?.toLowerCase();
    if (tagName === 'script' || tagName === 'style' || tagName === 'mark') {
      return true;
    }
    parent = parent.parentNode;
  }
  return false;
}

// Function to remove existing highlights
function removeHighlights() {
  const highlights = document.querySelectorAll('.keyword-highlight');
  highlights.forEach(highlight => {
    const text = document.createTextNode(highlight.textContent);
    highlight.parentNode.replaceChild(text, highlight);
  });
}

// Function to setup or disconnect the observer
function setupObserver() {
  if (!observer) {
      log('[CONTENT] Setting up MutationObserver.');
      observer = new MutationObserver((mutations) => {
          // Silent observer - just watching for future use
      });
  }
  // Start observing
  observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
  });
}

function disconnectObserver() {
  if (observer) {
      log('[CONTENT] Disconnecting MutationObserver.');
      observer.disconnect();
      // Optionally set observer = null; if you might re-setup later
  }
}
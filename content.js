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

    let keywordCounts = {}; // Object to store counts for each keyword
    keywords.forEach(kw => keywordCounts[kw] = 0); // Initialize counts to 0

    // Process each text node
    textNodes.forEach(node => {
      let text = node.textContent;
      let matches = false;

      // Try each keyword/regex pattern
      for (const keyword of keywords) {
        try {
          const regex = new RegExp(keyword, 'gi');
          let matchResult;
          let processedText = '';
          let lastIndex = 0;

          while ((matchResult = regex.exec(text)) !== null) {
            matches = true;
            keywordCounts[keyword]++; // Increment count for this specific keyword
            processedText += text.substring(lastIndex, matchResult.index);
            processedText += `<mark class="keyword-highlight" style="background-color: ${highlightColor}">${matchResult[0]}</mark>`;
            lastIndex = regex.lastIndex;
          }
          // Append the rest of the text after the last match (or the whole text if no match)
          processedText += text.substring(lastIndex);
          text = processedText; // Update text with highlights for this keyword

        } catch (e) {
          console.error('Invalid regex pattern:', keyword);
        }
      }

      // If we found matches, replace the text node with highlighted HTML
      if (matches) {
        // Create a temporary div to parse the HTML string
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = text; // text now contains the <mark> tags

        // Create a document fragment to hold the new nodes
        const fragment = document.createDocumentFragment();
        while (tempDiv.firstChild) {
          fragment.appendChild(tempDiv.firstChild);
        }

        // Replace the original text node with the fragment
        // Check if node.parentNode exists before replacing
        if (node.parentNode) {
          node.parentNode.replaceChild(fragment, node);
        } else {
          // Handle cases where the node might have been removed from the DOM
          // console.warn("Parent node not found for text node:", node.textContent.substring(0, 50) + "...");
        }
      } // <-- Add missing closing brace for 'if (matches)'
    });

    // Send keyword counts object to background script with retry
    const MAX_RETRIES = 3;
    const sendKeywordCounts = async (retryCount = 0) => {
      try {
        if (!chrome.runtime?.id) {
          throw new Error('Extension context invalidated');
        }
        
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'UPDATE_MATCH_COUNT', counts: keywordCounts }, // Send the object
            response => {
              if (chrome.runtime.lastError) {
                // Check for specific errors that indicate the background script might not be ready
                if (chrome.runtime.lastError.message.includes("Could not establish connection") ||
                    chrome.runtime.lastError.message.includes("Receiving end does not exist")) {
                   // console.warn(`[CONTENT] Connection error sending counts (retry ${retryCount}): ${chrome.runtime.lastError.message}`);
                   reject(new Error("Connection error")); // Use a generic error for retry logic
                } else {
                   reject(chrome.runtime.lastError); // Reject other errors immediately
                }
              } else if (response && response.success) {
                resolve(response);
              } else {
                // Handle cases where the background script reports an error
                reject(new Error(response?.error || 'Background script reported failure'));
              }
            }
          );
        });
      } catch (error) {
        // Retry only on connection errors or specific background failures if desired
        if (retryCount < MAX_RETRIES && (error.message === "Connection error" || error.message.includes("specific background error"))) {
          await new Promise(resolve => setTimeout(resolve, 150 * Math.pow(2, retryCount))); // Slightly longer delay
          return sendKeywordCounts(retryCount + 1);
        }
        // Don't retry if context is invalidated
        if (error.message.includes('Extension context invalidated')) {
           throw error; // Re-throw invalid context error
        }
        // Log other errors but potentially don't re-throw to avoid console spam if retries fail
        console.error(`[CONTENT] Failed to send counts after ${retryCount} retries:`, error);
        // Optionally throw error; // Decide if final failure should throw
        return; // Exit gracefully after final retry fails
      }
    };

    sendKeywordCounts().catch(error => {
      // Specific handling for invalid context error
      if (error.message.includes('Extension context invalidated')) {
        console.warn('[CONTENT] Extension context invalid - cannot send counts. Page reload may be required.');
      // Error handling for other failures is now inside sendKeywordCounts
      // } else {
      //   console.error('[CONTENT] Final error sending keyword counts:', error);
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

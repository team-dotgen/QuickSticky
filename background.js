/**
 * Background Service Worker for DotNCue
 * Handles extension lifecycle events and message passing
 */

// Initialize extension on installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('DotNCue installed successfully');
    
    // Initialize storage structure if needed
    chrome.storage.local.get(null, (data) => {
      if (!data.notes_index) {
        chrome.storage.local.set({
          notes_index: {} // Will store context_key -> notes[] mapping
        });
      }
    });
  } else if (details.reason === 'update') {
    console.log('DotNCue updated to version ' + chrome.runtime.getManifest().version);
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any background tasks if needed
  if (request.action === 'ping') {
    sendResponse({ status: 'ok' });
  }
  
  return true; // Keep message channel open for async response
});

// Keep service worker alive if needed
chrome.runtime.onStartup.addListener(() => {
  console.log('DotNCue service worker started');
});


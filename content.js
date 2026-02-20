/**
 * Content Script for Context Buddy
 * Detects page context, extracts metadata, and manages sidebar UI
 */

// Global state
let currentContext = null;
let sidebarInjected = false;
let sidebarOpen = false;
let toggleButton = null;
let sidebarSide = 'right'; // 'left' or 'right'

/**
 * Initialize the extension when page loads
 */
function initialize() {
  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}

async function init() {
  // Detect current page context
  currentContext = detectContext();
  
  if (!currentContext) {
    console.log('Context Buddy: Unsupported page');
    return;
  }
  
  console.log('Context Buddy: Detected context', currentContext);
  
  // Load sidebar side preference
  const savedSide = localStorage.getItem('context-buddy-side');
  if (savedSide === 'left' || savedSide === 'right') {
    sidebarSide = savedSide;
  }
  
  // Create toggle button
  createToggleButton();
  
  // Listen for messages from sidebar
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SWITCH_SIDE') {
      switchSide();
    } else if (event.data && event.data.type === 'CLOSE_SIDEBAR') {
      closeSidebar();
    } else if (event.data && event.data.type === 'GET_PAGE_CONTENT') {
      // Extract page content and send back to sidebar
      const pageContent = extractPageContent();
      const iframe = document.getElementById('context-buddy-iframe');
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          type: 'PAGE_CONTENT',
          content: pageContent
        }, '*');
      }
    }
  });
  
  // Check if notes exist for this context
  const hasNotes = await checkForNotes(currentContext.key);
  
  if (hasNotes) {
    // Auto-open sidebar if notes exist
    openSidebar();
  }
  
  // Listen for URL changes (for SPAs like Gmail, YouTube)
  observeUrlChanges();
}

/**
 * Detect page context based on current URL and page content
 */
function detectContext() {
  const url = window.location.href;
  const hostname = window.location.hostname;
  
  // Gmail detection
  if (hostname === 'mail.google.com') {
    return detectGmailContext();
  }
  
  // Google Meet detection
  if (hostname === 'meet.google.com') {
    return detectMeetContext();
  }
  
  // Google Docs detection
  if (hostname === 'docs.google.com') {
    return detectDocsContext();
  }
  
  // Google Calendar detection
  if (hostname === 'calendar.google.com') {
    return detectCalendarContext();
  }
  
  // YouTube detection
  if (hostname === 'www.youtube.com') {
    return detectYouTubeContext();
  }
  
  return null;
}

/**
 * Detect Gmail context (email subject, sender, thread)
 */
function detectGmailContext() {
  // Try to extract email subject from various Gmail UI elements
  let title = '';
  let sender = '';
  let threadId = '';
  
  // Get subject from email view
  const subjectElement = document.querySelector('h2.hP') || 
                         document.querySelector('[data-legacy-thread-id]');
  
  if (subjectElement) {
    title = subjectElement.textContent?.trim() || '';
    
    // Get thread ID from URL
    const threadMatch = window.location.href.match(/\/mail\/u\/\d+\/#[^\/]+\/([a-zA-Z0-9]+)/);
    if (threadMatch) {
      threadId = threadMatch[1];
    }
  }
  
  // Try to get sender email
  const senderElement = document.querySelector('span.go[email]');
  if (senderElement) {
    sender = senderElement.getAttribute('email') || '';
  }
  
  // Fallback: use page title
  if (!title) {
    title = document.title.replace(' - Gmail', '').trim();
  }
  
  // Create context key
  const key = sender ? `gmail:${sender}` : `gmail:${title}`;
  
  return {
    app: 'gmail',
    title: title || 'Gmail',
    sender: sender,
    participants: sender ? [sender] : [],
    threadId: threadId,
    url: window.location.href,
    key: key
  };
}

/**
 * Detect Google Meet context (meeting title, participants)
 */
function detectMeetContext() {
  let title = '';
  let participants = [];
  
  // Try to get meeting title
  const titleElement = document.querySelector('[data-meeting-title]') ||
                       document.querySelector('div[jsname="rQC7Ie"]');
  
  if (titleElement) {
    title = titleElement.textContent?.trim() || '';
  }
  
  // Fallback to page title
  if (!title) {
    title = document.title.replace(' - Google Meet', '').trim();
  }
  
  // Try to get participant names from participant list
  const participantElements = document.querySelectorAll('[data-participant-id]');
  participants = Array.from(participantElements)
    .map(el => el.textContent?.trim())
    .filter(name => name && name.length > 0);
  
  const key = `meet:${title}`;
  
  return {
    app: 'meet',
    title: title || 'Google Meet',
    participants: participants,
    url: window.location.href,
    key: key
  };
}

/**
 * Detect Google Docs context (document title)
 */
function detectDocsContext() {
  let title = '';
  
  // Get document title from the docs UI
  const titleElement = document.querySelector('.docs-title-input') ||
                       document.querySelector('[aria-label*="Document"]');
  
  if (titleElement) {
    title = titleElement.textContent?.trim() || titleElement.value?.trim() || '';
  }
  
  // Fallback to page title
  if (!title) {
    title = document.title.replace(' - Google Docs', '').trim();
  }
  
  const key = `doc:${title}`;
  
  return {
    app: 'docs',
    title: title || 'Google Docs',
    url: window.location.href,
    key: key
  };
}

/**
 * Detect Google Calendar context (event title if open)
 */
function detectCalendarContext() {
  let title = '';
  
  // Try to get event title from event detail view
  const eventElement = document.querySelector('[data-eventid] [data-title]') ||
                       document.querySelector('div[role="dialog"] input[aria-label*="Title"]');
  
  if (eventElement) {
    title = eventElement.getAttribute('data-title') || 
            eventElement.value?.trim() || 
            eventElement.textContent?.trim() || '';
  }
  
  // Fallback
  if (!title) {
    title = 'Google Calendar';
  }
  
  const key = title !== 'Google Calendar' ? `calendar:${title}` : 'calendar:general';
  
  return {
    app: 'calendar',
    title: title,
    url: window.location.href,
    key: key
  };
}

/**
 * Detect YouTube context (video title, channel)
 */
function detectYouTubeContext() {
  let title = '';
  let channel = '';
  const url = window.location.href;
  
  console.log('Context Buddy: detectYouTubeContext called for URL:', url);
  console.log('Context Buddy: Current document.title:', document.title);
  
  // Check if we're on the homepage specifically
  if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') {
    return {
      app: 'youtube',
      title: 'Home Page',
      channel: '',
      participants: [],
      url: url,
      key: 'youtube:Home Page'
    };
  }
  
  // Check if we're on a video page
  const isVideoPage = url.includes('watch?v=');
  
  if (isVideoPage) {
    // Get video title - Updated selectors for current YouTube structure
    const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                         document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string') ||
                         document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
                         document.querySelector('h1.style-scope.ytd-watch-metadata') ||
                         document.querySelector('h1 yt-formatted-string');
    
    if (titleElement) {
      title = titleElement.textContent?.trim() || '';
      console.log('Context Buddy: Title from DOM element:', title);
    }
    
    // If no title found via selectors, try getting from page title
    if (!title || title === 'YouTube') {
      // Force re-read of document.title (don't use cached value)
      const pageTitle = document.querySelector('title')?.textContent || document.title;
      console.log('Context Buddy: Title from document.title:', pageTitle);
      
      // YouTube video titles are in format "Video Title - YouTube"
      if (pageTitle && pageTitle !== 'YouTube' && !pageTitle.includes('watch?v=')) {
        title = pageTitle.replace(' - YouTube', '').trim();
        console.log('Context Buddy: Extracted title:', title);
      }
    }
    
    // Get channel name - Updated selectors
    const channelElement = document.querySelector('ytd-channel-name#channel-name a') ||
                          document.querySelector('ytd-video-owner-renderer ytd-channel-name a') ||
                          document.querySelector('#owner-name a') ||
                          document.querySelector('ytd-channel-name a');
    
    if (channelElement) {
      channel = channelElement.textContent?.trim() || '';
    }
  } else {
    // For other YouTube pages, determine based on URL path
    const path = window.location.pathname;
    
    if (path.includes('/results')) {
      // Search results page
      const query = new URLSearchParams(window.location.search).get('search_query');
      title = query ? `Search: ${query}` : 'YouTube Search';
    } else if (path.includes('/channel/') || path.includes('/@')) {
      // Channel page - try to get channel name
      const channelNameElement = document.querySelector('ytd-channel-name yt-formatted-string') ||
                                 document.querySelector('#channel-name yt-formatted-string');
      if (channelNameElement) {
        title = channelNameElement.textContent?.trim() || 'YouTube Channel';
      } else {
        title = 'YouTube Channel';
      }
    } else if (path.includes('/feed/subscriptions')) {
      title = 'Subscriptions';
    } else if (path.includes('/feed/trending')) {
      title = 'Trending';
    } else if (path.includes('/feed/library')) {
      title = 'Library';
    } else if (path.includes('/feed/history')) {
      title = 'History';
    } else {
      // Default for other YouTube pages
      title = 'YouTube';
    }
  }
  
  console.log('Context Buddy: Final detected title:', title);
  
  const key = `youtube:${title}`;
  
  return {
    app: 'youtube',
    title: title || 'YouTube',
    channel: channel,
    participants: channel ? [channel] : [],
    url: url,
    key: key
  };
}

/**
 * Check if notes exist for the given context key
 */
async function checkForNotes(contextKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get([contextKey], (result) => {
      const notes = result[contextKey];
      resolve(notes && notes.length > 0);
    });
  });
}

/**
 * Create side arrow toggle button
 */
function createToggleButton() {
  if (toggleButton) return;
  
  toggleButton = document.createElement('div');
  toggleButton.id = 'context-buddy-toggle';
  toggleButton.className = `side-${sidebarSide}`;
  toggleButton.innerHTML = sidebarSide === 'right' ? '◀' : '▶';
  toggleButton.title = 'Notes';
  
  toggleButton.addEventListener('click', () => {
    if (sidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  
  document.body.appendChild(toggleButton);
}

/**
 * Switch sidebar between left and right side
 */
function switchSide() {
  // Close sidebar if open
  const wasOpen = sidebarOpen;
  if (sidebarOpen) {
    closeSidebar();
  }
  
  // Switch side
  sidebarSide = sidebarSide === 'right' ? 'left' : 'right';
  localStorage.setItem('context-buddy-side', sidebarSide);
  
  // Update toggle button arrow
  if (toggleButton) {
    toggleButton.className = `side-${sidebarSide}`;
    toggleButton.innerHTML = sidebarSide === 'right' ? '◀' : '▶';
  }
  
  // Update sidebar if it exists
  const sidebar = document.getElementById('context-buddy-sidebar');
  if (sidebar) {
    sidebar.className = `side-${sidebarSide}`;
  }
  
  // Reopen if it was open
  if (wasOpen) {
    setTimeout(() => openSidebar(), 100);
  }
}

/**
 * Open sidebar
 */
function openSidebar() {
  if (!sidebarInjected) {
    injectSidebar();
  }
  
  const sidebar = document.getElementById('context-buddy-sidebar');
  if (sidebar) {
    sidebar.classList.add('open');
    sidebarOpen = true;
    
    // Send context to sidebar
    const iframe = sidebar.querySelector('iframe');
    if (iframe && iframe.contentWindow) {
      // Wait for iframe to load
      const sendContext = () => {
        iframe.contentWindow.postMessage({
          type: 'CONTEXT_UPDATE',
          context: currentContext
        }, '*');
      };
      
      // If iframe is already loaded, send immediately
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        setTimeout(sendContext, 100);
      } else {
        // Otherwise wait for load event
        iframe.addEventListener('load', () => {
          setTimeout(sendContext, 100);
        }, { once: true });
      }
    }
  }
  
  // Update toggle button
  if (toggleButton) {
    toggleButton.style.display = 'none';
  }
}

/**
 * Close sidebar
 */
function closeSidebar() {
  const sidebar = document.getElementById('context-buddy-sidebar');
  if (sidebar) {
    sidebar.classList.remove('open');
    sidebarOpen = false;
  }
  
  // Show toggle button
  if (toggleButton) {
    toggleButton.style.display = 'flex';
  }
}

/**
 * Inject sidebar HTML into page
 */
function injectSidebar() {
  if (sidebarInjected) return;
  
  const sidebarContainer = document.createElement('div');
  sidebarContainer.id = 'context-buddy-sidebar';
  sidebarContainer.className = `side-${sidebarSide}`;
  
  // Create iframe for isolated environment
  const iframe = document.createElement('iframe');
  iframe.src = chrome.runtime.getURL('sidebar.html');
  iframe.id = 'context-buddy-iframe';
  
  sidebarContainer.appendChild(iframe);
  document.body.appendChild(sidebarContainer);
  
  sidebarInjected = true;
}

/**
 * Observe URL changes for single-page applications
 */
function observeUrlChanges() {
  let lastUrl = window.location.href;
  let lastTitle = document.title;
  
  // Use MutationObserver to detect URL changes
  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    
    // Check for URL change
    if (lastUrl !== currentUrl) {
      console.log('Context Buddy: URL changed from', lastUrl, 'to', currentUrl);
      lastUrl = currentUrl;
      lastTitle = currentTitle;
      
      // Re-detect context with retry mechanism for dynamic content
      waitForContextAndUpdate();
    }
    // Check for title change (important for YouTube video pages)
    else if (lastTitle !== currentTitle && currentUrl.includes('watch?v=')) {
      console.log('Context Buddy: Title changed from', lastTitle, 'to', currentTitle);
      lastTitle = currentTitle;
      
      // Title changed on video page, update context
      waitForContextAndUpdate();
    }
  });
  
  observer.observe(document, {
    subtree: true,
    childList: true
  });
  
  // Watch for title changes specifically
  const titleObserver = new MutationObserver(() => {
    const currentTitle = document.title;
    if (lastTitle !== currentTitle && window.location.href.includes('watch?v=')) {
      console.log('Context Buddy: Document title changed to', currentTitle);
      lastTitle = currentTitle;
      waitForContextAndUpdate();
    }
  });
  
  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  
  // Also listen for pushState/replaceState (for YouTube specifically)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function() {
    originalPushState.apply(this, arguments);
    console.log('Context Buddy: pushState detected');
    // Force update for navigation
    waitForContextAndUpdate(true);
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(this, arguments);
    console.log('Context Buddy: replaceState detected');
    // Force update for navigation
    waitForContextAndUpdate(true);
  };
  
  // Listen for popstate (back/forward button)
  window.addEventListener('popstate', () => {
    console.log('Context Buddy: popstate detected (back/forward button)');
    lastUrl = window.location.href;
    lastTitle = document.title;
    // Force update immediately for back/forward navigation with lenient timing
    waitForContextAndUpdate(true);
  });
  
  // Listen for YouTube's navigation events
  window.addEventListener('yt-navigate-finish', () => {
    console.log('Context Buddy: yt-navigate-finish detected');
    lastUrl = window.location.href;
    lastTitle = document.title;
    // Force update for YouTube navigation
    waitForContextAndUpdate(true);
  });
  
  window.addEventListener('yt-navigate-start', () => {
    console.log('Context Buddy: yt-navigate-start detected');
  });
  
  window.addEventListener('yt-page-data-updated', () => {
    console.log('Context Buddy: yt-page-data-updated detected');
    waitForContextAndUpdate();
  });
  
  // Additional event for page visibility (when user comes back to tab)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.location.href !== lastUrl) {
      console.log('Context Buddy: Page visible and URL changed');
      lastUrl = window.location.href;
      lastTitle = document.title;
      // Force update when returning to tab
      waitForContextAndUpdate(true);
    }
  });
}

/**
 * Wait for context elements to load and update sidebar
 */
function waitForContextAndUpdate(forceUpdate = false) {
  const url = window.location.href;
  
  // Immediately send loading state to sidebar
  if (sidebarOpen) {
    const iframe = document.getElementById('context-buddy-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'CONTEXT_UPDATE',
        context: {
          app: 'youtube',
          title: 'Loading...',
          url: url,
          key: 'youtube:loading',
          isLoading: true
        }
      }, '*');
    }
  }
  
  console.log('Context Buddy: URL changed to', url, '- waiting for title to update...');
  
  // Wait for page to fully update (2 seconds)
  setTimeout(() => {
    console.log('Context Buddy: Starting context detection, current document.title:', document.title);
    
    let attempts = 0;
    const maxAttempts = 25; // Try for up to 5 seconds after initial wait
    let lastSeenTitle = document.title;
    
    const checkAndUpdate = () => {
      attempts++;
      const currentDocTitle = document.title;
      
      // Check if title changed since last check
      if (currentDocTitle !== lastSeenTitle) {
        console.log('Context Buddy: Title changed from', lastSeenTitle, 'to', currentDocTitle);
        lastSeenTitle = currentDocTitle;
      }
      
      const newContext = detectContext();
      
      if (!newContext) {
        if (attempts < maxAttempts) {
          setTimeout(checkAndUpdate, 200);
        }
        return;
      }
      
      // For YouTube homepage, update immediately
      if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') {
        console.log('Context Buddy: Homepage detected');
        updateContext(newContext);
        return;
      }
      
      // For YouTube video pages, wait for actual video title
      const isYouTubeVideoPage = newContext.app === 'youtube' && url.includes('watch?v=');
      
      if (isYouTubeVideoPage) {
        // Check if we have a real video title (not just default/fallback)
        const hasRealTitle = newContext.title && 
                            newContext.title !== 'YouTube' &&
                            newContext.title !== 'Loading...' &&
                            newContext.title.length > 0 &&
                            !newContext.title.includes('watch?v=');
        
        console.log('Context Buddy: Video page - Title:', newContext.title, 'Valid:', hasRealTitle);
        
        // Update if we have a real title or exhausted attempts
        if (hasRealTitle || attempts >= maxAttempts) {
          updateContext(newContext);
        } else {
          // Keep trying
          setTimeout(checkAndUpdate, 200);
        }
      } else {
        // For other pages (search, channel, etc.), update immediately
        updateContext(newContext);
      }
    };
    
    function updateContext(newContext) {
      const previousUrl = currentContext?.url;
      const previousTitle = currentContext?.title;
      currentContext = newContext;
      
      // Send update to sidebar if it's open
      if (sidebarOpen) {
        const iframe = document.getElementById('context-buddy-iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({
            type: 'CONTEXT_UPDATE',
            context: currentContext
          }, '*');
        }
      }
      
      // Log the update
      console.log('Context Buddy: ✓ Context FINALIZED');
      console.log('  Previous:', previousTitle, '('+previousUrl+')');
      console.log('  Current:', currentContext.title, '('+currentContext.url+')');
    }
    
    // Start checking immediately (after initial delay)
    checkAndUpdate();
  }, 2000); // 2 second initial delay
}

/**
 * Extract meaningful text content from the current page
 */
function extractPageContent() {
  const hostname = window.location.hostname;
  let content = '';
  
  // Gmail specific extraction
  if (hostname === 'mail.google.com') {
    const subject = document.querySelector('h2.hP')?.textContent || '';
    const emailBody = document.querySelector('.a3s.aiL')?.textContent || '';
    content = `Subject: ${subject}\n\n${emailBody}`.substring(0, 3000);
  }
  // YouTube specific extraction
  else if (hostname === 'www.youtube.com') {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent || 
                  document.querySelector('h1 yt-formatted-string')?.textContent || '';
    const description = document.querySelector('#description yt-formatted-string')?.textContent || '';
    content = `Title: ${title}\n\nDescription: ${description}`.substring(0, 3000);
  }
  // Google Docs specific extraction
  else if (hostname === 'docs.google.com') {
    const docTitle = document.querySelector('.docs-title-input')?.textContent || '';
    const docContent = document.querySelector('.kix-page')?.textContent || '';
    content = `Title: ${docTitle}\n\n${docContent}`.substring(0, 3000);
  }
  // Generic extraction for other pages
  else {
    const title = document.title;
    const mainContent = document.querySelector('main')?.textContent || 
                       document.querySelector('article')?.textContent ||
                       document.body.textContent;
    
    // Clean up the content
    const cleaned = mainContent
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim()
      .substring(0, 3000);
    
    content = `Title: ${title}\n\n${cleaned}`;
  }
  
  return content || 'Unable to extract page content';
}

// Start the extension
initialize();

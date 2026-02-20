/**
 * Sidebar Logic for Context Buddy
 * Handles note storage, retrieval, and UI updates
 */

// Global state
let currentContext = null;
let currentNotes = [];
let relatedNotes = [];
let allNotes = [];
let currentView = 'current'; // 'current' or 'all'
let appFilter = 'all';
let sortOrder = 'newest';

/**
 * Initialize sidebar when loaded
 */
function initialize() {
  setupEventListeners();
  setupMessageListener();
}

/**
 * Setup form and button event listeners
 */
function setupEventListeners() {
  // Add note form submission
  const form = document.getElementById('addNoteForm');
  form.addEventListener('submit', handleAddNote);
  
  // Auto-resize textarea
  const textarea = document.getElementById('noteInput');
  textarea.addEventListener('input', autoResizeTextarea);
  
  // Tab navigation
  const tabCurrent = document.getElementById('tabCurrent');
  const tabAll = document.getElementById('tabAll');
  
  tabCurrent.addEventListener('click', () => switchView('current'));
  tabAll.addEventListener('click', () => switchView('all'));
  
  // Filters and sort
  const appFilterSelect = document.getElementById('appFilter');
  const sortOrderSelect = document.getElementById('sortOrder');
  
  appFilterSelect.addEventListener('change', (e) => {
    appFilter = e.target.value;
    renderAllNotes();
  });
  
  sortOrderSelect.addEventListener('change', (e) => {
    sortOrder = e.target.value;
    renderAllNotes();
  });
}

/**
 * Listen for messages from content script
 */
function setupMessageListener() {
  window.addEventListener('message', (event) => {
    // Make sure message is from our extension
    if (event.data && event.data.type === 'CONTEXT_UPDATE') {
      const newContext = event.data.context;
      console.log('Context Buddy Sidebar: Received context update', newContext);
      
      // Check if this is a loading state
      if (newContext.isLoading) {
        console.log('Context Buddy Sidebar: Showing loading state');
        currentContext = newContext;
        showLoadingState();
        return;
      }
      
      // Store previous URL to detect changes
      const previousUrl = currentContext?.url;
      const previousTitle = currentContext?.title;
      currentContext = newContext;
      
      // Check if URL actually changed (always reload on URL change)
      const urlChanged = previousUrl && previousUrl !== currentContext?.url;
      
      if (urlChanged || !previousUrl || previousTitle === 'Loading...') {
        console.log('Context Buddy Sidebar: URL changed or loading complete, triggering full reload');
        console.log('  Previous:', previousTitle, '-', previousUrl);
        console.log('  Current:', currentContext.title, '-', currentContext.url);
        
        // Full reload when URL changes or first load or after loading state
        reloadExtension();
      } else {
        console.log('Context Buddy Sidebar: Same URL, just updating display');
        // Just update display if same URL (title might have changed)
        updateContextDisplay();
      }
    }
  });
}

/**
 * Fully reload the extension with new context
 */
function reloadExtension() {
  console.log('Context Buddy Sidebar: Starting full reload for context', currentContext);
  
  // Show loading state
  showLoadingState();
  
  // Clear textarea
  const textarea = document.getElementById('noteInput');
  if (textarea) {
    textarea.value = '';
    textarea.style.height = 'auto';
  }
  
  // Switch to current view if in all view (user is navigating, show context-specific notes)
  if (currentView === 'all') {
    switchView('current');
  }
  
  // Update all UI elements with a slight delay for smooth transition
  setTimeout(() => {
    updateContextDisplay();
    loadNotes();
    findRelatedNotes();
    hideLoadingState();
    
    // Log completion
    console.log('Context Buddy Sidebar: Reload complete');
  }, 100);
}

/**
 * Show loading state
 */
function showLoadingState() {
  const titleElement = document.getElementById('contextTitle');
  const notesList = document.getElementById('notesList');
  const relatedSection = document.getElementById('relatedNotesSection');
  
  if (titleElement) {
    titleElement.style.opacity = '0.5';
    titleElement.textContent = '⏳ Loading new context...';
  }
  
  // Clear current notes immediately to prevent showing old content
  if (notesList) {
    notesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-text">Loading...</div>
      </div>
    `;
  }
  
  // Hide related notes
  if (relatedSection) {
    relatedSection.style.display = 'none';
  }
  
  console.log('Context Buddy Sidebar: Loading state displayed');
}

/**
 * Hide loading state
 */
function hideLoadingState() {
  const titleElement = document.getElementById('contextTitle');
  if (titleElement) {
    titleElement.style.opacity = '1';
  }
}

/**
 * Update the context display in the header
 */
function updateContextDisplay() {
  if (!currentContext) return;
  
  const appElement = document.getElementById('contextApp');
  const titleElement = document.getElementById('contextTitle');
  
  // Update app badge
  appElement.textContent = currentContext.app;
  
  // Update context title with appropriate emoji
  let emoji = '📄';
  
  // First check by app type
  switch (currentContext.app) {
    case 'gmail':
      emoji = '📧';
      break;
    case 'meet':
      emoji = '🎥';
      break;
    case 'docs':
      emoji = '📝';
      break;
    case 'calendar':
      emoji = '📅';
      break;
    case 'youtube':
      // For YouTube, choose emoji based on page type
      if (currentContext.title === 'Home Page') {
        emoji = '🏠';
      } else if (currentContext.title?.startsWith('Search:')) {
        emoji = '🔍';
      } else if (currentContext.title === 'Subscriptions') {
        emoji = '📺';
      } else if (currentContext.title === 'History') {
        emoji = '🕒';
      } else if (currentContext.title === 'Library') {
        emoji = '📚';
      } else if (currentContext.title === 'Trending') {
        emoji = '🔥';
      } else {
        emoji = '▶️'; // Video page
      }
      break;
  }
  
  titleElement.textContent = `${emoji} ${currentContext.title}`;
  
  console.log('Context Buddy Sidebar: Display updated to', currentContext.title);
}

/**
 * Load notes for current context from storage
 */
async function loadNotes() {
  if (!currentContext) return;
  
  const key = currentContext.key;
  
  chrome.storage.local.get([key], (result) => {
    currentNotes = result[key] || [];
    renderNotes();
  });
}

/**
 * Render notes in the UI
 */
function renderNotes() {
  const notesList = document.getElementById('notesList');
  
  // Clear current list
  notesList.innerHTML = '';
  
  if (currentNotes.length === 0) {
    // Show empty state
    notesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">No notes yet. Add your first note below!</div>
      </div>
    `;
    return;
  }
  
  // Render each note (newest first)
  const sortedNotes = [...currentNotes].reverse();
  sortedNotes.forEach((note, index) => {
    const noteItem = createNoteElement(note, currentNotes.length - 1 - index);
    notesList.appendChild(noteItem);
  });
}

/**
 * Create a note element
 */
function createNoteElement(note, index, isRelated = false) {
  const li = document.createElement('li');
  li.className = isRelated ? 'note-item related-note-item' : 'note-item';
  
  const noteText = document.createElement('div');
  noteText.className = 'note-text';
  noteText.textContent = note.text;
  
  const noteMeta = document.createElement('div');
  noteMeta.className = 'note-meta';
  
  const noteDate = document.createElement('span');
  noteDate.className = 'note-date';
  noteDate.textContent = formatDate(note.timestamp);
  
  const deleteButton = document.createElement('button');
  deleteButton.className = 'note-delete';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = () => handleDeleteNote(index, isRelated ? note.contextKey : null);
  
  noteMeta.appendChild(noteDate);
  if (!isRelated) {
    noteMeta.appendChild(deleteButton);
  } else {
    // Show context info for related notes
    const contextInfo = document.createElement('div');
    contextInfo.style.display = 'flex';
    contextInfo.style.flexDirection = 'column';
    contextInfo.style.gap = '2px';
    contextInfo.style.marginTop = '4px';
    
    const contextApp = document.createElement('span');
    contextApp.style.fontSize = '10px';
    contextApp.style.color = '#666';
    contextApp.style.fontWeight = '500';
    contextApp.textContent = note.contextKey?.split(':')[0] || '';
    
    const contextTitle = document.createElement('span');
    contextTitle.style.fontSize = '11px';
    contextTitle.style.color = '#888';
    contextTitle.textContent = note.contextTitle || '';
    
    contextInfo.appendChild(contextApp);
    if (note.contextTitle) {
      contextInfo.appendChild(contextTitle);
    }
    
    noteMeta.appendChild(contextInfo);
  }
  
  li.appendChild(noteText);
  li.appendChild(noteMeta);
  
  return li;
}

/**
 * Format timestamp to readable date
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) {
    return 'Just now';
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  
  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  
  // Format as date
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Handle adding a new note
 */
async function handleAddNote(event) {
  event.preventDefault();
  
  const textarea = document.getElementById('noteInput');
  const noteText = textarea.value.trim();
  
  if (!noteText || !currentContext) {
    return;
  }
  
  // Create note object
  const note = {
    text: noteText,
    timestamp: Date.now(),
    context: currentContext
  };
  
  // Add to current notes array
  currentNotes.push(note);
  
  // Save to storage
  const key = currentContext.key;
  chrome.storage.local.set({ [key]: currentNotes }, () => {
    // Clear textarea
    textarea.value = '';
    
    // Re-render notes
    renderNotes();
    
    // Update related notes
    findRelatedNotes();
    
    // If we're in all view, reload all notes
    if (currentView === 'all') {
      loadAllNotes();
    }
  });
}

/**
 * Handle deleting a note
 */
function handleDeleteNote(index, relatedContextKey = null, fromAllView = false) {
  if (!confirm('Delete this note?')) {
    return;
  }
  
  if (relatedContextKey || fromAllView) {
    // Deleting a note from another context or from all view
    const contextKey = relatedContextKey;
    chrome.storage.local.get([contextKey], (result) => {
      const notes = result[contextKey] || [];
      notes.splice(index, 1);
      
      chrome.storage.local.set({ [contextKey]: notes }, () => {
        if (fromAllView) {
          // Refresh all notes view
          loadAllNotes();
        } else {
          // Refresh related notes
          findRelatedNotes();
        }
      });
    });
  } else {
    // Deleting a current context note
    currentNotes.splice(index, 1);
    
    const key = currentContext.key;
    chrome.storage.local.set({ [key]: currentNotes }, () => {
      renderNotes();
    });
  }
}

/**
 * Find and display related notes based on title similarity
 */
function findRelatedNotes() {
  if (!currentContext) return;
  
  const currentKey = currentContext.key;
  const currentTitle = currentContext.title.toLowerCase();
  
  // Get all stored notes
  chrome.storage.local.get(null, (allData) => {
    relatedNotes = [];
    
    // Search through all stored context keys
    Object.keys(allData).forEach(key => {
      // Skip current context
      if (key === currentKey) return;
      
      // Skip non-note keys
      if (!key.includes(':')) return;
      
      const notes = allData[key];
      if (!Array.isArray(notes) || notes.length === 0) return;
      
      // Extract title from key (format: "app:title")
      const keyTitle = key.split(':')[1]?.toLowerCase() || '';
      
      // Simple string matching for related contexts
      // Check if titles share common words or substrings
      if (isSimilarTitle(currentTitle, keyTitle)) {
        // Add notes from this context as related
        notes.forEach((note, index) => {
          relatedNotes.push({
            ...note,
            contextKey: key,
            index: index
          });
        });
      }
    });
    
    renderRelatedNotes();
  });
}

/**
 * Check if two titles are similar (simple word matching)
 */
function isSimilarTitle(title1, title2) {
  if (!title1 || !title2) return false;
  if (title1 === title2) return false; // Exact match is current context
  
  // Split into words and filter out common words
  const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'];
  
  const words1 = title1.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));
  const words2 = title2.split(/\s+/).filter(w => w.length > 2 && !commonWords.includes(w));
  
  // Check for common words
  const commonCount = words1.filter(w => words2.includes(w)).length;
  
  // If at least 1 word in common, consider it related
  return commonCount > 0;
}

/**
 * Render related notes
 */
function renderRelatedNotes() {
  const relatedSection = document.getElementById('relatedNotesSection');
  const relatedList = document.getElementById('relatedNotesList');
  
  if (relatedNotes.length === 0) {
    relatedSection.style.display = 'none';
    return;
  }
  
  relatedSection.style.display = 'block';
  relatedList.innerHTML = '';
  
  // Show up to 5 most recent related notes
  const recentRelated = relatedNotes
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5);
  
  recentRelated.forEach(note => {
    const noteItem = createNoteElement(note, note.index, true);
    relatedList.appendChild(noteItem);
  });
}

/**
 * Auto-resize textarea as user types
 */
function autoResizeTextarea(event) {
  const textarea = event.target;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

/**
 * Switch between Current and All Notes views
 */
function switchView(view) {
  currentView = view;
  
  // Update tab buttons
  document.getElementById('tabCurrent').classList.toggle('active', view === 'current');
  document.getElementById('tabAll').classList.toggle('active', view === 'all');
  
  // Show/hide views
  document.getElementById('currentView').style.display = view === 'current' ? 'block' : 'none';
  document.getElementById('allView').style.display = view === 'all' ? 'block' : 'none';
  
  // Show/hide controls
  document.getElementById('controls').style.display = view === 'all' ? 'block' : 'none';
  document.getElementById('contextInfo').style.display = view === 'current' ? 'block' : 'none';
  
  // Load appropriate data
  if (view === 'all') {
    loadAllNotes();
  }
}

/**
 * Load all notes from storage
 */
function loadAllNotes() {
  chrome.storage.local.get(null, (allData) => {
    allNotes = [];
    
    // Collect all notes from all contexts
    Object.keys(allData).forEach(key => {
      // Skip non-note keys
      if (!key.includes(':')) return;
      
      const notes = allData[key];
      if (!Array.isArray(notes) || notes.length === 0) return;
      
      // Parse context from key (format: "app:title")
      const [app, ...titleParts] = key.split(':');
      const title = titleParts.join(':');
      
      // Add each note with context info
      notes.forEach((note, index) => {
        allNotes.push({
          ...note,
          app: app,
          contextTitle: title,
          contextKey: key,
          index: index
        });
      });
    });
    
    renderAllNotes();
  });
}

/**
 * Render all notes with filtering and sorting
 */
function renderAllNotes() {
  const allNotesList = document.getElementById('allNotesList');
  const statsBar = document.getElementById('statsBar');
  
  // Filter notes
  let filteredNotes = allNotes;
  if (appFilter !== 'all') {
    filteredNotes = allNotes.filter(note => note.app === appFilter);
  }
  
  // Sort notes
  filteredNotes.sort((a, b) => {
    if (sortOrder === 'newest') {
      return b.timestamp - a.timestamp;
    } else {
      return a.timestamp - b.timestamp;
    }
  });
  
  // Update stats
  const uniqueApps = new Set(filteredNotes.map(note => note.app));
  document.getElementById('noteCount').textContent = `${filteredNotes.length} note${filteredNotes.length !== 1 ? 's' : ''}`;
  document.getElementById('appCount').textContent = `${uniqueApps.size} app${uniqueApps.size !== 1 ? 's' : ''}`;
  
  // Clear and render
  allNotesList.innerHTML = '';
  
  if (filteredNotes.length === 0) {
    allNotesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">No notes found!</div>
      </div>
    `;
    return;
  }
  
  filteredNotes.forEach(note => {
    const noteItem = createAllNotesElement(note);
    allNotesList.appendChild(noteItem);
  });
}

/**
 * Create a note element for All Notes view
 */
function createAllNotesElement(note) {
  const li = document.createElement('li');
  li.className = 'note-item';
  
  // Note header with app badge and context
  const noteHeader = document.createElement('div');
  noteHeader.className = 'note-header';
  
  const leftInfo = document.createElement('div');
  leftInfo.style.display = 'flex';
  leftInfo.style.flexDirection = 'column';
  leftInfo.style.gap = '4px';
  leftInfo.style.flex = '1';
  leftInfo.style.minWidth = '0';
  
  const badge = document.createElement('span');
  badge.className = 'note-badge';
  const emoji = getAppEmoji(note.app);
  badge.innerHTML = `<span>${emoji}</span><span>${note.app.toUpperCase()}</span>`;
  
  const contextTitle = document.createElement('div');
  contextTitle.className = 'note-context-title';
  contextTitle.textContent = note.contextTitle || 'Unknown context';
  
  leftInfo.appendChild(badge);
  leftInfo.appendChild(contextTitle);
  
  noteHeader.appendChild(leftInfo);
  
  // Note text
  const noteText = document.createElement('div');
  noteText.className = 'note-text';
  noteText.textContent = note.text;
  
  // Note meta
  const noteMeta = document.createElement('div');
  noteMeta.className = 'note-meta';
  
  const noteDate = document.createElement('span');
  noteDate.className = 'note-date';
  noteDate.textContent = formatDate(note.timestamp);
  
  const deleteButton = document.createElement('button');
  deleteButton.className = 'note-delete';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = () => handleDeleteNote(note.index, note.contextKey, true);
  
  noteMeta.appendChild(noteDate);
  noteMeta.appendChild(deleteButton);
  
  li.appendChild(noteHeader);
  li.appendChild(noteText);
  li.appendChild(noteMeta);
  
  return li;
}

/**
 * Get emoji for app
 */
function getAppEmoji(app) {
  const emojis = {
    'gmail': '📧',
    'meet': '🎥',
    'docs': '📝',
    'calendar': '📅',
    'youtube': '▶️'
  };
  return emojis[app] || '📄';
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}

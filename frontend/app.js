/**
 * Frontend app logic for HAS_URL shortener.
 * Interacts with the Cloudflare Worker API.
 */

// CONFIGURATION: Set this to your deployed Cloudflare Worker API URL if they run on different domains.
// By default, it detects localhost for development, and falls back to window.location.origin for production.
const API_BASE = window.location.origin.startsWith('file://')
  ? 'http://localhost:8788'
  : window.location.origin; 

// DOM Elements
const shortenForm = document.getElementById('shorten-form');
const longUrlInput = document.getElementById('long-url');
const customAliasInput = document.getElementById('custom-alias');
const submitBtn = document.getElementById('submit-btn');
const resultSection = document.getElementById('result-section');
const shortenedLink = document.getElementById('shortened-link');
const copyBtn = document.getElementById('copy-btn');
const copyBtnText = copyBtn.querySelector('.copy-btn-text');
const toast = document.getElementById('toast');
const logList = document.getElementById('log-list');
const refreshBtn = document.getElementById('refresh-btn');

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  fetchRecentLinks();
});

// Refresh button event
refreshBtn.addEventListener('click', () => {
  fetchRecentLinks();
});

// Form Submission
shortenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  resetErrors();

  const longUrl = longUrlInput.value.trim();
  const customAlias = customAliasInput.value.trim();

  // Validate Long URL exists
  if (!longUrl) {
    showError(longUrlInput, 'Destination URL is required.');
    return;
  }

  // Validate URL protocol
  try {
    const urlObj = new URL(longUrl);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      showError(longUrlInput, 'URL protocol must be http:// or https://');
      return;
    }
  } catch (err) {
    showError(longUrlInput, 'Please enter a valid URL (including https://).');
    return;
  }

  // Validate Alias format if provided
  if (customAlias) {
    const aliasRegex = /^[a-zA-Z0-9\-_]{1,30}$/;
    if (!aliasRegex.test(customAlias)) {
      showError(customAliasInput, 'Must be alphanumeric, dashes, or underscores (1-30 chars).');
      return;
    }
  }

  // Submit URL to API
  try {
    setLoadingState(true);
    
    const response = await fetch(`${API_BASE}/api/shorten`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: longUrl,
        alias: customAlias || undefined
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 409) {
        showError(customAliasInput, data.error || 'Alias is already in use.');
      } else {
        alert(data.error || 'Failed to shorten URL. Server error.');
      }
      return;
    }

    // Success: Show results
    displayResult(data);
    fetchRecentLinks(); // Update logs sidebar

    // Optional: Clear input fields
    longUrlInput.value = '';
    customAliasInput.value = '';

  } catch (err) {
    console.error('API Error:', err);
    alert('Could not connect to the API server. Make sure your worker is running.');
  } finally {
    setLoadingState(false);
  }
});

// Copy to Clipboard
copyBtn.addEventListener('click', async () => {
  const linkText = shortenedLink.href;
  try {
    await navigator.clipboard.writeText(linkText);
    showToast();
  } catch (err) {
    console.error('Clipboard copy failed:', err);
    // Fallback copy method
    const tempInput = document.createElement('input');
    tempInput.value = linkText;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showToast();
  }
});

// Helper Functions
function showError(inputElement, message) {
  inputElement.classList.add('invalid');
  inputElement.placeholder = message;
  // If user clicks or types, remove invalid styling
  const cleanUp = () => {
    inputElement.classList.remove('invalid');
    inputElement.removeEventListener('input', cleanUp);
    inputElement.removeEventListener('focus', cleanUp);
  };
  inputElement.addEventListener('input', cleanUp);
  inputElement.addEventListener('focus', cleanUp);
  inputElement.focus();
}

function resetErrors() {
  longUrlInput.classList.remove('invalid');
  customAliasInput.classList.remove('invalid');
}

function setLoadingState(isLoading) {
  if (isLoading) {
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').innerText = 'GENERATING SHORT URL...';
  } else {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-text').innerText = 'SHORTEN URL';
  }
}

function displayResult(data) {
  // Make shortened URL clean and clickable
  shortenedLink.href = data.shortUrl;
  shortenedLink.innerText = data.shortUrl.replace(/^https?:\/\//, '');

  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showToast() {
  toast.classList.remove('hidden');
  copyBtnText.innerText = 'COPIED!';
  copyBtn.style.borderColor = 'var(--success-color)';

  setTimeout(() => {
    toast.classList.add('hidden');
    copyBtnText.innerText = 'COPY TO CLIPBOARD';
    copyBtn.style.borderColor = 'var(--border-color)';
  }, 2000);
}

// Fetch recent redirects from Worker API
async function fetchRecentLinks() {
  try {
    const response = await fetch(`${API_BASE}/api/recent`);
    if (!response.ok) {
      throw new Error('API returned error response');
    }
    const data = await response.json();
    renderRecentLogs(data);
  } catch (err) {
    console.error('Failed to load recent links:', err);
    logList.innerHTML = `
      <div class="log-row placeholder-row">
        <span class="log-col text-dim">COULD NOT CONNECT TO SYSTEM LOGS</span>
      </div>
    `;
  }
}

// Render list items in the sidebar
function renderRecentLogs(items) {
  if (!items || items.length === 0) {
    logList.innerHTML = `
      <div class="log-row placeholder-row">
        <span class="log-col text-dim">LOG_FILE: EMPTY</span>
      </div>
    `;
    return;
  }

  logList.innerHTML = '';
  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.style.animationDelay = `${index * 50}ms`; // staggered fade-in

    // Format destination URL (truncate if needed)
    const cleanDestUrl = item.url.replace(/^https?:\/\//, '');
    
    // Construct link alias display
    // Make it clickable so users can test it easily
    const redirectUrl = `${API_BASE}/${item.alias}`;

    row.innerHTML = `
      <div class="log-col col-alias">
        <a href="${redirectUrl}" target="_blank" style="color: inherit; text-decoration: none;">/${item.alias}</a>
      </div>
      <div class="log-col col-url">
        <a href="${item.url}" target="_blank" title="${item.url}">${cleanDestUrl}</a>
      </div>
      <div class="log-col col-hits">
        ${item.hits} hit${item.hits === 1 ? '' : 's'}
      </div>
    `;

    logList.appendChild(row);
  });
}

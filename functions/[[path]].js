const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// Response helper for JSON
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders
    }
  });
}

// Response helper for clean HTML pages
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders
    }
  });
}

// Random short code generator
function generateRandomCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  // Bind KV check
  if (!env.URL_KV) {
    return jsonResponse({ error: 'KV Namespace (URL_KV) is not bound.' }, 500);
  }

  // 1. API: Shorten a URL
  if (path === '/api/shorten' && method === 'POST') {
    try {
      const body = await request.json();
      let targetUrl = body.url ? body.url.trim() : null;
      let alias = body.alias ? body.alias.trim() : null;

      // Validation: Target URL must exist
      if (!targetUrl) {
        return jsonResponse({ error: 'Destination URL is required.' }, 400);
      }

      // Validation: Format of Target URL
      try {
        const parsed = new URL(targetUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return jsonResponse({ error: 'Invalid URL. Only http:// and https:// protocols are supported.' }, 400);
        }
      } catch (e) {
        return jsonResponse({ error: 'Invalid URL. Please enter a valid fully qualified URL.' }, 400);
      }

      // Validation & generation of alias
      if (alias) {
        const aliasRegex = /^[a-zA-Z0-9\-_]{1,30}$/;
        if (!aliasRegex.test(alias)) {
          return jsonResponse({
            error: 'Invalid alias. Must be alphanumeric, dashes, or underscores, and between 1 to 30 characters.'
          }, 400);
        }

        // Reserved keywords checking
        const reserved = ['api', 'favicon.ico', 'robots.txt', 'index.html', 'style.css', 'app.js'];
        if (reserved.includes(alias.toLowerCase())) {
          return jsonResponse({ error: 'This alias is a reserved keyword.' }, 400);
        }

        // Duplicate checking
        const exists = await env.URL_KV.get(alias);
        if (exists) {
          return jsonResponse({ error: 'Alias already in use. Please select a different custom alias.' }, 409);
        }
      } else {
        // Generate a unique 6-character random code
        let retries = 0;
        let foundUnique = false;
        while (!foundUnique && retries < 10) {
          const candidate = generateRandomCode(6);
          const exists = await env.URL_KV.get(candidate);
          if (!exists) {
            alias = candidate;
            foundUnique = true;
          }
          retries++;
        }
        if (!foundUnique) {
          return jsonResponse({ error: 'Failed to generate a unique short link. Please try again.' }, 500);
        }
      }

      // Store the URL data in KV
      const linkData = {
        url: targetUrl,
        hits: 0,
        created: new Date().toISOString()
      };
      await env.URL_KV.put(alias, JSON.stringify(linkData));

      // Update the list of recent links
      try {
        const recentStr = await env.URL_KV.get('system:recent');
        let recent = recentStr ? JSON.parse(recentStr) : [];
        recent = [alias, ...recent.filter(item => item !== alias)].slice(0, 10);
        await env.URL_KV.put('system:recent', JSON.stringify(recent));
      } catch (err) {
        console.error('Error updating system:recent', err);
      }

      const shortUrl = `${url.origin}/${alias}`;
      return jsonResponse({
        alias,
        shortUrl,
        url: targetUrl,
        created: linkData.created,
        hits: 0
      }, 201);

    } catch (err) {
      return jsonResponse({ error: `Server error processing request: ${err.message}` }, 500);
    }
  }

  // 2. API: Get Recent Links
  if (path === '/api/recent' && method === 'GET') {
    try {
      const recentStr = await env.URL_KV.get('system:recent');
      const recentAliases = recentStr ? JSON.parse(recentStr) : [];
      
      const promises = recentAliases.map(async (alias) => {
        const dataStr = await env.URL_KV.get(alias);
        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            return {
              alias,
              url: parsed.url,
              hits: parsed.hits || 0,
              created: parsed.created
            };
          } catch (e) {
            return null;
          }
        }
        return null;
      });

      const rawResults = await Promise.all(promises);
      const results = rawResults.filter(item => item !== null);
      return jsonResponse(results);
    } catch (err) {
      return jsonResponse({ error: `Server error retrieving recent list: ${err.message}` }, 500);
    }
  }

  // 3. API: Get Single Link Info
  if (path.startsWith('/api/info/') && method === 'GET') {
    try {
      const alias = path.slice('/api/info/'.length).trim();
      if (!alias) {
        return jsonResponse({ error: 'Alias is required.' }, 400);
      }

      const dataStr = await env.URL_KV.get(alias);
      if (!dataStr) {
        return jsonResponse({ error: 'Short link not found.' }, 404);
      }

      const parsed = JSON.parse(dataStr);
      return jsonResponse({
        alias,
        url: parsed.url,
        hits: parsed.hits || 0,
        created: parsed.created
      });
    } catch (err) {
      return jsonResponse({ error: `Server error retrieving link details: ${err.message}` }, 500);
    }
  }

  // 4. Redirect Route (GET /:alias)
  if (method === 'GET') {
    const alias = path.slice(1);
    
    // Skip favicon.ico, robots.txt, and static files
    // If it has an extension (like style.css, app.js), fall through to assets
    if (!alias || alias === 'favicon.ico' || alias === 'robots.txt' || alias.includes('/') || alias.includes('.')) {
      return next(); // Let Pages serve the static file!
    }

    try {
      const dataStr = await env.URL_KV.get(alias);
      if (!dataStr) {
        return htmlResponse(getNotFoundHtml(alias), 404);
      }

      const data = JSON.parse(dataStr);

      // Increment hit counter
      data.hits = (data.hits || 0) + 1;
      context.waitUntil(env.URL_KV.put(alias, JSON.stringify(data)));

      return Response.redirect(data.url, 302);
    } catch (err) {
      return htmlResponse(getErrorHtml(err.message), 500);
    }
  }

  return next();
}

function getNotFoundHtml(alias) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - LINK NOT FOUND</title>
  <style>
    body {
      background-color: #050505;
      color: #ff3333;
      font-family: 'Courier New', Courier, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      overflow: hidden;
      background-image: linear-gradient(rgba(16, 16, 16, 0.5) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(16, 16, 16, 0.5) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .terminal {
      border: 1px solid #ff3333;
      background: rgba(5, 5, 5, 0.95);
      padding: 40px;
      max-width: 500px;
      box-shadow: 0 0 20px rgba(255, 51, 51, 0.15);
      text-align: left;
    }
    h1 {
      font-size: 24px;
      margin-top: 0;
      border-bottom: 1px solid #ff3333;
      padding-bottom: 10px;
    }
    p {
      color: #cccccc;
      line-height: 1.6;
    }
    .code {
      color: #ff3333;
      background: #150505;
      padding: 2px 6px;
      border-radius: 3px;
    }
    a {
      color: #ffffff;
      text-decoration: underline;
      display: inline-block;
      margin-top: 20px;
    }
    a:hover {
      color: #ff3333;
    }
  </style>
</head>
<body>
  <div class="terminal">
    <h1>[SYSTEM_ERROR: LINK_NOT_FOUND]</h1>
    <p>The short link alias <span class="code">/${alias || ''}</span> does not exist or has expired.</p>
    <p>Please check the URL or create a new short link from our dashboard.</p>
    <a href="/">Go to Home</a>
  </div>
</body>
</html>`;
}

function getErrorHtml(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>500 - SYSTEM ERROR</title>
  <style>
    body {
      background-color: #050505;
      color: #ff9900;
      font-family: 'Courier New', Courier, monospace;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background-image: linear-gradient(rgba(16, 16, 16, 0.5) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(16, 16, 16, 0.5) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .terminal {
      border: 1px solid #ff9900;
      background: rgba(5, 5, 5, 0.95);
      padding: 40px;
      max-width: 500px;
      box-shadow: 0 0 20px rgba(255, 153, 0, 0.15);
      text-align: left;
    }
    h1 {
      font-size: 24px;
      margin-top: 0;
      border-bottom: 1px solid #ff9900;
      padding-bottom: 10px;
    }
    p {
      color: #cccccc;
    }
  </style>
</head>
<body>
  <div class="terminal">
    <h1>[SYSTEM_ERROR: INTERNAL_SERVER_ERROR]</h1>
    <p>An unexpected error occurred during redirection:</p>
    <p style="color: #ff9900; background: #151000; padding: 10px; font-size: 14px;">${message}</p>
    <p>Please contact the system administrator if this persists.</p>
  </div>
</body>
</html>`;
}

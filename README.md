# URL Shortener

This is a URL shortener built for Cloudflare Pages and Cloudflare KV. The frontend is hosted on Cloudflare Pages, and the backend API and redirection logic are handled by Pages Functions on the same domain.

## Project Structure

* `frontend/` - Static HTML, CSS, and JavaScript.
* `functions/` - Serverless functions handling API endpoints and redirects.
* `wrangler.toml` - Configuration file for project settings and KV namespace binding.

## Running Locally

To run the local development server from the project root:

```bash
npx wrangler pages dev frontend --kv=URL_KV --compatibility-date=2024-03-01
```

This starts the server at http://localhost:8788.

## Deploying to Cloudflare

1. Create a KV namespace on Cloudflare:
   ```bash
   npx wrangler kv:namespace create URL_KV
   ```

2. Open `wrangler.toml` and update the `id` field under `kv_namespaces` with your new KV namespace ID.

3. Create the Pages project (only needed the first time):
   ```bash
   npx wrangler pages project create hass --production-branch main --force
   ```

4. Deploy the project:
   ```bash
   npx wrangler pages deploy
   ```

## API Endpoints

### Create a short link
* **POST** `/api/shorten`
* Request Body:
  ```json
  {
    "url": "https://example.com/long-url",
    "alias": "custom-path"
  }
  ```

### Get recent links
* **GET** `/api/recent`
  Returns the last 10 shortened links with their creation date and redirect counts.

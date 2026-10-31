# Palette

A user-scoped visual wardrobe deployed on Vercel.

The palette is now a full-screen, server-backed canvas. Items can be added, moved, resized, rotated, mirrored, and removed directly on the page. Every transform is stored in Vercel Blob.

## Routes

- `/:userId` — the user's draggable palette
- `GET /api/items` — API capability and configuration status
- `POST /api/items` — parse a product link and generate a transparent cutout
- `GET /api/palette?user_id=:userId` — read persistent palette state
- `POST /api/palette?user_id=:userId` — save a pending link/name and start background processing
- `PATCH /api/palette?user_id=:userId` — persist item transforms
- `DELETE /api/palette?user_id=:userId` — remove an item

The canonical demo route is `/441294944`.

## Intake API

`POST /api/items` accepts a retailer product URL or uploaded image, extracts the best product photograph, and sends it to the OpenAI Image API for a transparent PNG sticker cutout. Product pages are parsed from Product JSON-LD first, then Open Graph/Twitter metadata. If a retailer blocks the server or requires JavaScript, the endpoint can retry through Firecrawl.

All POST requests require a private bearer token:

```http
POST /api/items
Content-Type: application/json
Authorization: Bearer <PALETTE_API_TOKEN>

{"user_id":"441294944","url":"https://shop.example/item"}
```

For a photo, send `photo` as a PNG/JPEG/WebP data URL in JSON, or send image bytes with the correct image content type and `?user_id=441294944`.

The `201` response includes parsed product metadata, API usage, and the generated transparent PNG as a data URL. The caller can save that PNG and add the returned source metadata to the palette.

### Server configuration

Configure these as encrypted Vercel environment variables:

- `OPENAI_API_KEY` — required; charges conversion to the OpenAI API account, independently of a ChatGPT or Codex subscription.
- `PALETTE_API_TOKEN` — required; a long random secret protecting the paid endpoint.
- `FIRECRAWL_API_KEY` — optional; enables the protected/JavaScript retailer fallback.
- `OPENAI_IMAGE_MODEL` — optional; defaults to `gpt-image-2.5-sunburst`.

`GET /api/items` is public and reports whether generation, authentication, and protected-page fetching are configured without exposing secret values.

The implementation follows the [official OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [Firecrawl scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

## Background intake and editing

`POST /api/palette` accepts `{ "input": "product URL or name" }`, writes a pending item immediately, and uses Vercel `waitUntil` to process it after returning `202`. Product names are resolved with Firecrawl Search. The completed PNG and palette JSON live in Vercel Blob.

Palette mutations require a same-origin browser request, with no private edit link or token. The standalone paid `/api/items` endpoint remains bearer-protected. Production also requires the automatically provisioned `BLOB_READ_WRITE_TOKEN`.

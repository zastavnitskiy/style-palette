# Palette

A user-scoped visual wardrobe deployed on Vercel.

## Routes

- `/:userId` — the user's draggable palette
- `GET /api/items` — API capability and configuration status
- `POST /api/items` — generate a transparent sticker cutout

The canonical demo route is `/441294944`.

## Generate an item

From a product URL:

```http
POST /api/items
Content-Type: application/json

{"user_id":"441294944","url":"https://shop.example/item"}
```

From a photo, either send `photo` as a PNG/JPEG/WebP data URL in JSON, or send the image bytes directly with the correct image content type and `?user_id=441294944`.

The response contains the generated transparent WebP as a data URL. Set `OPENAI_API_KEY` in the Vercel project to enable generation. The implementation follows the [official OpenAI image generation guide](https://developers.openai.com/api/docs/guides/image-generation).

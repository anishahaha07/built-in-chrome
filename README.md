## Build and Run

1. Copy `.env.example` to create `.env` file, populate it with your credentials

```
OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GEMINI_API_KEY=your_gemini_key
```

2. Generate files:

```
node build.js
```

This produces `manifest.json` and `config.json`.

3. Load in Chrome:

- Open `chrome://extensions` → enable Developer mode → Load unpacked → select this folder.



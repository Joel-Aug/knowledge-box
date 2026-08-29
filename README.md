# Knowledge Box

Type a keyword and it grows into a tree of related concepts — headers grouping sub-keywords beneath them — so you can work your way toward expert-level knowledge of a subject.

- Start a **box** with one keyword (a subject or field).
- Click the sparkle icon on any keyword to have AI propose related sub-topics, grouped under headers.
- Add, rename, delete, or add notes to any keyword by hand.
- Everything is saved locally in your browser (no account, no server).

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.local.example` to `.env.local` and set your Anthropic API key:
   ```
   cp .env.local.example .env.local
   ```
3. Run the app:
   ```
   npm run dev
   ```

Without an API key set, you can still build boxes and add keywords manually — only the "suggest related" AI feature requires one.

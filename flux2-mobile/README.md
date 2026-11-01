# FLUX.2 Studio for your phone

A text-to-image app for **FLUX.2 [klein] 4B** that runs entirely on your phone. No computer is needed, ever.

- **Your API key is stored only on your phone.** It is never put on GitHub or any server.
- **Your gallery is stored only on your phone.** Images and prompts are saved in the app's storage on the device.
- The phone talks straight to Black Forest Labs (BFL), the company that makes FLUX, to make each image.
- Includes templates (photoreal exterior, interior render, isometric 3D floor plan, top-down colored floor plan), aspect ratios, up to 4 reference photos, and saving to your Photos.

You can do every step below on your phone.

---

## Step 1: Put the app online (one time, about 3 minutes)

The app is a web page hosted for free by GitHub Pages, straight from this repository.

1. In your phone's browser, go to **github.com/Joel-Aug/knowledge-box** and sign in.
   (The GitHub app works too, but Settings is easier on the website. If it shows the mobile view, tap your browser's "Request desktop site" option.)
2. Make sure the `flux2-mobile` folder is on the **main** branch. If it's still waiting in a pull request, open **Pull requests**, open it, tap **Merge pull request**, then **Confirm merge**.
3. Go to **Settings → Pages** (in the left menu).
4. Under **Build and deployment → Source**, choose **Deploy from a branch**. Set the branch to **main** and the folder to **/ (root)**, then tap **Save**.
   If Pages is already turned on (for example for the task-planner app), skip this step.
5. Wait 1–2 minutes, then open:

   **https://joel-aug.github.io/knowledge-box/flux2-mobile/**

Bookmark it. This is your app's address.

## Step 2: Add it to your home screen

This makes it open full-screen like a normal app. It also tells the phone to keep the gallery safe.

- **iPhone (Safari):** tap the **Share** button (square with an arrow) → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap **⋮** → **Add to Home screen** or **Install app**.

From now on, open it from the **FLUX Studio** icon.

> On iPhone, the home-screen app keeps its own storage, separate from Safari. Always use the icon so your gallery stays in one place.

## Step 3: Add your BFL API key

1. In your phone's browser, go to **dashboard.bfl.ai** and create an account.
2. Add some credits in the billing section. FLUX.2 [klein] is the cheapest FLUX.2 model; current prices are shown on the dashboard.
3. Open **API Keys**, create a key, and tap to copy it.
4. Open FLUX Studio, tap **⚙︎** (top right), paste the key into **BFL API key**, and tap **Save**.

Now pick a template or type a prompt and tap **Generate**.

## Step 4: Only if the app says "Your browser isn't allowed to talk to BFL directly"

Some services don't let a web page call them straight from a phone browser. If BFL is one of them, you'll see that message. The fix is a free "relay": a small piece of code that runs on Cloudflare and passes your requests to BFL. It stores nothing and has no key of its own.

1. On GitHub, open `flux2-mobile/relay-worker.js` in this repo, tap **Raw**, then select all the text and copy it.
2. Go to **dash.cloudflare.com** and create a free account (or sign in).
3. Go to **Workers & Pages → Create → Create Worker** (pick the "Hello World" starter if asked).
   Name it `flux-relay` and tap **Deploy**.
4. Tap **Edit code**. Delete everything in the editor, paste the code you copied, and tap **Deploy**.
5. Copy the worker's address. It looks like `https://flux-relay.YOURNAME.workers.dev`.
   (Opening it in the browser should say "FLUX.2 Studio relay is running.")
6. In FLUX Studio, tap **⚙︎**, paste that address into **Relay URL**, and tap **Save**. Generate again.

The relay only forwards to Black Forest Labs addresses, so nobody can use it for anything else. Your key travels from your phone, through the relay, to BFL with each request. It is never saved anywhere.

---

## Using the app

- **Templates:** tap one to fill in a prompt and a matching aspect ratio. The first `[bracketed]` part is selected, so type over it, then replace any other bracketed parts.
- **Reference images:** tap **＋ Add photos** to pick from your gallery or take a photo (up to 4). In the prompt, call them "image 1", "image 2" and so on, for example:
  - "Render the floor plan in image 1 as an isometric 3D cutaway"
  - "Turn the house in image 1 into a photoreal exterior at dusk"
  - "Use the materials from image 2 in the room in image 1"
- **Gallery tab:** tap an image to:
  - **Save / Share:** opens your phone's share sheet. Choose **Save Image** to put it in Photos, or send it to anyone
  - **Reuse prompt:** loads the prompt, aspect ratio and seed so you can tweak and regenerate
  - **Use as reference:** edits the result further
  - **Delete**
- **Seed** (under *Advanced*): the same prompt with the same seed gives a similar image. Leave it blank for variety.
- **Model** (in ⚙︎ Settings): klein 4B is the default and cheapest. pro, flex and max give higher quality at a higher price.

## Good to know

- **The gallery lives only on this phone.** Deleting the home-screen app, clearing website data, or switching phones erases it. Save the images you care about to Photos with **Save / Share**.
- **The app needs internet to generate**, but it opens and shows your gallery offline.
- **Updates:** when the app is changed on GitHub, your phone picks up the new version the next time you open it online.
- **Privacy:** nothing about you is in the public repository. Your key, prompts and images stay on your phone and go only to BFL (through your own relay, if you set one up).

## Troubleshooting

| Message | What to do |
|---|---|
| "Add your BFL API key to start" | Step 3 |
| "BFL rejected your API key" | Re-copy the key into ⚙︎ Settings. Check for missing characters or spaces |
| "out of credits" | Top up at dashboard.bfl.ai |
| "isn't allowed to talk to BFL directly" | Step 4 |
| "Couldn't reach your relay" | Check the Relay URL in Settings. Open it in the browser; it should say the relay is running |
| "Blocked by BFL's content filter" | Reword the prompt |
| The page at github.io says 404 | Wait a couple of minutes after Step 1. Check that Pages is on and the code is merged into main |

---

*The computer version (with optional local-GPU mode) is in [`../flux2-studio`](../flux2-studio/README.md). You don't need it for the phone app.*

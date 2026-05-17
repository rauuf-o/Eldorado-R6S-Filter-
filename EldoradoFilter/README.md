# Eldorado Order Filter Extension

This extension filters boosting orders on Eldorado.gg and suppresses notification sounds for filtered consoles.

## Important Parts Explained

- **`manifest.json`**: This is a Manifest V3 setup. It injects `content.js` onto the Eldorado.gg site and uses `chrome.storage` to persist the settings you chose in the popup UI.
- **`content.js`**: This contains the core logic:
  - **Audio Interception**: Since we cannot directly stop a website from playing an `Audio` object after a DOM node is added, we inject a script directly into the main page. This script intercepts the native `HTMLAudioElement.prototype.play` method.
  - **MutationObserver**: Constantly watches the page for dynamically added orders.
  - **Heuristic Card Detection**: We use regular expressions with word boundaries (e.g. `\bpc\b`) to detect "PC", "PlayStation", "PS4", "PS5", and "Xbox". When a console is matched and its checkbox is unselected, we hide the card and instantly message our injected script to suppress the imminent notification sound!
- **`popup.html/css/js`**: A sleek popup using modern CSS that auto-saves your preferences using `chrome.storage.sync`. 

## Exact Installation Steps for Chrome

1. Open your Google Chrome browser.
2. Go to the address bar, type `chrome://extensions/` and hit **Enter**.
3. In the top right corner of the Extensions page, turn on **Developer mode** (a toggle switch).
4. Click on the **Load unpacked** button that appears in the top left.
5. In the file explorer that pops up, navigate to the folder `g:\CODING PROJECTS\eldorado\EldoradoFilter` and click **Select Folder**.
6. The extension is now installed and active! You can click the puzzle piece icon in the top right of your Chrome window and pin the "Eldorado Order Filter" to easily access the toggles.

*Note: Whenever you make changes to the code, go back to `chrome://extensions/` and click the refresh arrow icon on the extension card to load your updates.*

# Project Structure

This document provides a detailed breakdown of the project's file structure.

```
C:\Users\anike\Desktop\code\built-in-chrome\
├───background.js
├───content.js
├───manifest.json
├───popup.html
├───popup.js
├───styles.css
├───tailwind.css
├───.git\
├───icons\
│   ├───chrome.png
│   ├───demo-chart.png
│   ├───mifi.png
│   └───setting.svg
└───lib\
    └───chart.min.js
```

## File Descriptions

- **`manifest.json`**: The manifest file for the Chrome extension. It defines the extension's name, version, permissions, and other metadata.
- **`background.js`**: The service worker for the extension. It runs in the background and handles tasks like listening for messages from other parts of the extension and managing the AI-powered receipt scanning process.
- **`content.js`**: A content script that can be injected into web pages. (Currently empty)
- **`popup.html`**: The HTML file for the extension's popup. It defines the structure of the user interface.
- **`popup.js`**: The JavaScript file for the extension's popup. It handles user interactions, displays data, and communicates with the background script.
- **`styles.css`**: A CSS file for custom styles. (Currently empty)
- **`tailwind.css`**: The Tailwind CSS library used for styling the popup.
- **`icons/`**: A directory containing all the icons used in the extension.
- **`lib/`**: A directory for third-party libraries. It contains `chart.min.js`, a library used for creating charts.

```